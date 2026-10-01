//! Shared activity history for the UI and the agent CLI.
use std::collections::HashMap;

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::{Connection, OptionalExtension, Params, params};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::tasks::{TaskCard, TaskStatus};
use crate::{items, links, notes, tasks, time};

macro_rules! activity_enum {
    ($name:ident { $($variant:ident => $value:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "lowercase")]
        pub enum $name { $($variant),+ }

        impl ToSql for $name {
            fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
                Ok(match self { $(Self::$variant => $value),+ }.into())
            }
        }

        impl FromSql for $name {
            fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
                match value.as_str()? {
                    $($value => Ok(Self::$variant)),+,
                    _ => Err(FromSqlError::InvalidType),
                }
            }
        }
    };
}

activity_enum!(Role {
    Request => "request", Plan => "plan", Implement => "implement", Test => "test",
    Review => "review", Merge => "merge", Note => "note",
});
activity_enum!(Kind { Message => "message", Status => "status", Result => "result", Link => "link" });

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub task_id: Option<String>,
    pub project_id: String,
    pub actor: String,
    pub role: Role,
    pub kind: Kind,
    pub title: String,
    pub body: String,
    pub created_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewActivity {
    pub task_id: Option<String>,
    pub project_id: String,
    pub actor: String,
    pub role: Role,
    pub kind: Kind,
    pub title: String,
    pub body: String,
}

fn validate_actor(actor: &str) -> Result<&str, AppError> {
    let actor = actor.trim();
    if actor.is_empty() || actor.chars().count() > 40 {
        return Err(AppError::Invalid("Nama aktor harus 1–40 karakter".into()));
    }
    Ok(actor)
}

fn validate_project(conn: &Connection, project_id: &str) -> Result<(), AppError> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM projects p JOIN items i ON i.id = p.item_id
         WHERE i.id = ?1 AND i.type = 'project' AND i.deleted_at IS NULL)",
        [project_id],
        |r| r.get(0),
    )?;
    if !exists {
        return Err(AppError::NotFound);
    }
    Ok(())
}

fn task_state(conn: &Connection, task_id: &str) -> Result<(Option<String>, TaskStatus), AppError> {
    conn.query_row(
        "SELECT t.project_id, t.status FROM tasks t JOIN items i ON i.id = t.item_id
         WHERE i.id = ?1 AND i.type = 'task' AND i.deleted_at IS NULL",
        [task_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?
    .ok_or(AppError::NotFound)
}

// The caller owns the transaction so compound operations can commit their history together.
fn add_in_transaction(conn: &Connection, a: &NewActivity, now: i64) -> Result<Activity, AppError> {
    let actor = validate_actor(&a.actor)?;
    if a.body.len() > 200 * 1024 {
        return Err(AppError::Invalid("Isi aktivitas maksimal 200 KB".into()));
    }
    validate_project(conn, &a.project_id)?;
    if let Some(task_id) = &a.task_id {
        let (project_id, _) = task_state(conn, task_id)?;
        if project_id.as_deref() != Some(a.project_id.as_str()) {
            return Err(AppError::Invalid("Tugas tidak berada di proyek ini".into()));
        }
    }
    let id = items::insert(conn, "activity", &a.title, &a.body, now)?;
    conn.execute(
        "INSERT INTO activities (item_id, task_id, project_id, actor, role, kind)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, a.task_id, a.project_id, actor, a.role, a.kind],
    )?;
    links::refresh(conn, &id, &a.body)?;
    Ok(Activity {
        id,
        task_id: a.task_id.clone(),
        project_id: a.project_id.clone(),
        actor: actor.into(),
        role: a.role,
        kind: a.kind,
        title: a.title.clone(),
        body: a.body.clone(),
        created_at: now,
    })
}

pub fn add(conn: &Connection, a: &NewActivity, now: i64) -> Result<Activity, AppError> {
    let tx = conn.unchecked_transaction()?;
    let activity = add_in_transaction(&tx, a, now)?;
    tx.commit()?;
    Ok(activity)
}

const LIVE_ACTIVITIES: &str = "
    FROM activities a JOIN items i ON i.id = a.item_id
    JOIN projects p ON p.item_id = a.project_id
    JOIN items pi ON pi.id = p.item_id
    LEFT JOIN tasks t ON t.item_id = a.task_id
    LEFT JOIN items ti ON ti.id = t.item_id
    WHERE i.type = 'activity' AND i.deleted_at IS NULL
      AND pi.type = 'project' AND pi.deleted_at IS NULL
      AND (a.task_id IS NULL OR (ti.type = 'task' AND ti.deleted_at IS NULL))";

fn query(conn: &Connection, clause: &str, params: impl Params) -> Result<Vec<Activity>, AppError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT i.id, a.task_id, a.project_id, a.actor, a.role, a.kind, i.title, i.body, i.created_at
         {LIVE_ACTIVITIES} AND {clause}"
    ))?;
    let rows = stmt.query_map(params, |r| {
        Ok(Activity {
            id: r.get(0)?,
            task_id: r.get(1)?,
            project_id: r.get(2)?,
            actor: r.get(3)?,
            role: r.get(4)?,
            kind: r.get(5)?,
            title: r.get(6)?,
            body: r.get(7)?,
            created_at: r.get(8)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn for_task(conn: &Connection, task_id: &str) -> Result<Vec<Activity>, AppError> {
    query(
        conn,
        "a.task_id = ?1 ORDER BY i.created_at, i.id",
        [task_id],
    )
}

pub fn for_project(
    conn: &Connection,
    project_id: &str,
    limit: usize,
) -> Result<Vec<Activity>, AppError> {
    let limit = i64::try_from(limit).unwrap_or(i64::MAX);
    query(
        conn,
        "a.project_id = ?1 ORDER BY i.created_at DESC, i.id DESC LIMIT ?2",
        params![project_id, limit],
    )
}

pub fn last_for_tasks(
    conn: &Connection,
    project_id: &str,
) -> Result<HashMap<String, (String, Role)>, AppError> {
    // Read only the latest actor and role; activity bodies can be as large as 200 KB.
    let mut stmt = conn.prepare(&format!(
        "SELECT task_id, actor, role FROM (
             SELECT a.task_id, a.actor, a.role,
                    ROW_NUMBER() OVER (PARTITION BY a.task_id ORDER BY i.created_at DESC, i.id DESC) AS rank
             {LIVE_ACTIVITIES} AND a.project_id = ?1 AND t.project_id = ?1
         ) WHERE rank = 1"
    ))?;
    let rows = stmt.query_map([project_id], |r| Ok((r.get(0)?, (r.get(1)?, r.get(2)?))))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub(crate) fn set_status_in_transaction(
    conn: &Connection,
    task_id: &str,
    status: TaskStatus,
    actor: &str,
    now: i64,
) -> Result<(), AppError> {
    let actor = validate_actor(actor)?;
    let (project_id, previous) = task_state(conn, task_id)?;
    if previous == status {
        return Ok(());
    }
    tasks::apply_status(conn, task_id, status, now)?;
    if let Some(project_id) = project_id {
        let (role, label) = match status {
            TaskStatus::Plan => (Role::Plan, "Rencana"),
            TaskStatus::Doing => (Role::Implement, "Dikerjakan"),
            TaskStatus::Test => (Role::Test, "Tes"),
            TaskStatus::Review => (Role::Review, "Review"),
            TaskStatus::Done => (Role::Merge, "Selesai"),
        };
        add_in_transaction(
            conn,
            &NewActivity {
                task_id: Some(task_id.into()),
                project_id,
                actor: actor.into(),
                role,
                kind: Kind::Status,
                title: format!("{actor} memindahkan ke {label}"),
                body: String::new(),
            },
            now,
        )?;
    }
    Ok(())
}

pub fn set_status(
    conn: &Connection,
    task_id: &str,
    status: TaskStatus,
    actor: &str,
    now: i64,
) -> Result<(), AppError> {
    let tx = conn.unchecked_transaction()?;
    set_status_in_transaction(&tx, task_id, status, actor, now)?;
    tx.commit()?;
    Ok(())
}

pub fn inbox(conn: &Connection, project_id: Option<&str>) -> Result<Vec<TaskCard>, AppError> {
    tasks::card_query(
        conn,
        "
        t.status = 'plan'
        AND (?1 IS NULL OR t.project_id = ?1)
        AND EXISTS (SELECT 1 FROM projects p JOIN items pi ON pi.id = p.item_id
                    WHERE p.item_id = t.project_id AND p.agent = 1 AND pi.deleted_at IS NULL)
        AND EXISTS (SELECT 1 FROM activities a JOIN items ai ON ai.id = a.item_id
                    WHERE a.task_id = i.id AND a.project_id = t.project_id
                      AND a.role = 'request' AND ai.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM activities a JOIN items ai ON ai.id = a.item_id
                        WHERE a.task_id = i.id AND a.project_id = t.project_id
                          AND a.role != 'request' AND ai.deleted_at IS NULL)
        ORDER BY i.created_at, i.id",
        [project_id],
        time::now_ms(),
        &jiff::tz::TimeZone::system(),
    )
}

pub fn save_plan(
    conn: &Connection,
    task_id: &str,
    actor: &str,
    markdown: &str,
    now: i64,
) -> Result<Activity, AppError> {
    let tx = conn.unchecked_transaction()?;
    let (project_id, _) = task_state(&tx, task_id)?;
    let project_id =
        project_id.ok_or_else(|| AppError::Invalid("Tugas harus berada di proyek".into()))?;
    let task = items::get(&tx, task_id)?;
    let project = items::get(&tx, &project_id)?;
    let activity = add_in_transaction(
        &tx,
        &NewActivity {
            task_id: Some(task_id.into()),
            project_id,
            actor: actor.into(),
            role: Role::Plan,
            kind: Kind::Result,
            title: format!("Rencana {}", task.title),
            body: markdown.into(),
        },
        now,
    )?;
    let parent_title = format!("Rencana {}", project.title);
    let parent_id: Option<String> = tx
        .query_row(
            "SELECT id FROM items WHERE title = ?1 AND type = 'page' AND deleted_at IS NULL
         ORDER BY created_at, id LIMIT 1",
            [&parent_title],
            |r| r.get(0),
        )
        .optional()?;
    let parent_id = match parent_id {
        Some(id) => id,
        None => notes::create_in_transaction(&tx, None, &parent_title, now)?.id,
    };
    let page = notes::create_in_transaction(&tx, Some(&parent_id), &task.title, now)?;
    items::update(
        &tx,
        &page.id,
        &items::ItemPatch {
            body: Some(markdown.into()),
            ..Default::default()
        },
        now,
    )?;
    tx.commit()?;
    Ok(activity)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::finance::testing::{jakarta, now};
    use crate::items;
    use crate::tasks::{self, NewTask, TaskStatus};

    fn project(conn: &Connection, title: &str) -> String {
        let id = items::insert(conn, "project", title, "", now()).unwrap();
        conn.execute(
            "INSERT INTO projects (item_id, kind, agent) VALUES (?1, 'app', 1)",
            [&id],
        )
        .unwrap();
        id
    }

    fn task(conn: &Connection, project_id: &str, title: &str) -> String {
        tasks::create_task(
            conn,
            &NewTask {
                title: title.into(),
                project_id: Some(project_id.into()),
                ..Default::default()
            },
            now(),
            &jakarta(),
        )
        .unwrap()
        .id
    }

    fn message(project_id: &str, task_id: Option<&str>, role: Role) -> NewActivity {
        NewActivity {
            project_id: project_id.into(),
            task_id: task_id.map(String::from),
            actor: "Sol".into(),
            role,
            kind: Kind::Message,
            title: "Ringkasan".into(),
            body: "Isi".into(),
        }
    }

    #[test]
    fn add_validates_actor_and_body() {
        let conn = open_in_memory();
        let p = project(&conn, "Agen");
        let t = task(&conn, &p, "Tugas");
        let mut input = message(&p, Some(&t), Role::Request);
        for actor in ["".to_string(), "   ".to_string(), "a".repeat(41)] {
            input.actor = actor;
            assert!(matches!(
                add(&conn, &input, now()),
                Err(AppError::Invalid(_))
            ));
        }
        input.actor = "界".repeat(40);
        input.body = "a".repeat(200 * 1024 + 1);
        assert!(matches!(
            add(&conn, &input, now()),
            Err(AppError::Invalid(_))
        ));
        assert!(for_task(&conn, &t).unwrap().is_empty());
        input.body = "é".repeat(100 * 1024);
        let added = add(&conn, &input, now()).unwrap();
        assert_eq!(added.actor, input.actor);
        assert_eq!(added.body, input.body);
        assert_eq!(items::get(&conn, &added.id).unwrap().kind, "activity");
        assert_eq!(
            uuid::Uuid::parse_str(&added.id).unwrap().get_version_num(),
            7
        );
    }

    #[test]
    fn add_rejects_missing_deleted_and_mismatched_parents() {
        let conn = open_in_memory();
        let p = project(&conn, "Agen");
        let other = project(&conn, "Lain");
        let t = task(&conn, &p, "Tugas");
        assert!(add(&conn, &message("missing", None, Role::Note), now()).is_err());
        assert!(add(&conn, &message(&p, Some("missing"), Role::Note), now()).is_err());
        assert!(add(&conn, &message(&other, Some(&t), Role::Note), now()).is_err());
        items::soft_delete(&conn, &t, now()).unwrap();
        assert!(add(&conn, &message(&p, Some(&t), Role::Note), now()).is_err());
        items::soft_delete(&conn, &p, now()).unwrap();
        assert!(add(&conn, &message(&p, None, Role::Note), now()).is_err());
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM items WHERE type = 'activity'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn activity_queries_order_limit_and_ignore_deleted_items() {
        let conn = open_in_memory();
        let p = project(&conn, "Agen");
        let t = task(&conn, &p, "Tugas");
        let a = add(&conn, &message(&p, Some(&t), Role::Request), now()).unwrap();
        let b = add(&conn, &message(&p, Some(&t), Role::Implement), now()).unwrap();
        let c = add(&conn, &message(&p, None, Role::Note), now() + 1).unwrap();
        assert_eq!(for_task(&conn, &t).unwrap(), vec![a.clone(), b.clone()]);
        assert_eq!(
            for_project(&conn, &p, 2).unwrap(),
            vec![c.clone(), b.clone()]
        );
        assert!(for_project(&conn, &p, 0).unwrap().is_empty());
        assert_eq!(
            last_for_tasks(&conn, &p).unwrap().get(&t),
            Some(&("Sol".into(), Role::Implement))
        );
        items::soft_delete(&conn, &b.id, now() + 2).unwrap();
        assert_eq!(
            last_for_tasks(&conn, &p).unwrap().get(&t),
            Some(&("Sol".into(), Role::Request))
        );
        items::soft_delete(&conn, &t, now() + 3).unwrap();
        assert_eq!(for_project(&conn, &p, 10).unwrap(), vec![c]);
        assert!(for_task(&conn, &t).unwrap().is_empty());
        assert!(last_for_tasks(&conn, &p).unwrap().is_empty());
        items::soft_delete(&conn, &p, now() + 4).unwrap();
        assert!(for_project(&conn, &p, 10).unwrap().is_empty());
    }

    #[test]
    fn failed_activity_insert_rolls_back_item_and_search_index() {
        let conn = open_in_memory();
        let p = project(&conn, "Agen");
        conn.execute_batch("CREATE TRIGGER reject_activity BEFORE INSERT ON activities BEGIN SELECT RAISE(ABORT, 'failed'); END;").unwrap();
        assert!(add(&conn, &message(&p, None, Role::Note), now()).is_err());
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM items WHERE type = 'activity'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM items_fts WHERE title = 'Ringkasan'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn set_status_writes_a_status_activity() {
        let conn = open_in_memory();
        let p = project(&conn, "Agen");
        let t = task(&conn, &p, "Tugas");
        for (index, status) in [
            TaskStatus::Doing,
            TaskStatus::Test,
            TaskStatus::Review,
            TaskStatus::Done,
            TaskStatus::Plan,
        ]
        .into_iter()
        .enumerate()
        {
            set_status(&conn, &t, status, "Sol", now() + index as i64).unwrap();
            let detail = tasks::get_task(&conn, &t, now(), &jakarta()).unwrap();
            assert_eq!(detail.card.status, status);
            assert_eq!(
                items::get(&conn, &t).unwrap().completed_at.is_some(),
                status == TaskStatus::Done
            );
        }
        let rows = for_task(&conn, &t).unwrap();
        assert_eq!(rows.len(), 5);
        assert_eq!(
            (rows[1].actor.as_str(), rows[1].role, rows[1].kind),
            ("Sol", Role::Test, Kind::Status)
        );
        assert_eq!(rows[1].title, "Sol memindahkan ke Tes");
        set_status(&conn, &t, TaskStatus::Plan, "Sol", now() + 10).unwrap();
        assert_eq!(for_task(&conn, &t).unwrap().len(), 5);
        assert!(set_status(&conn, "missing", TaskStatus::Test, "Sol", now()).is_err());
        assert!(set_status(&conn, &t, TaskStatus::Test, "", now()).is_err());
        assert_eq!(
            tasks::get_task(&conn, &t, now(), &jakarta())
                .unwrap()
                .card
                .status,
            TaskStatus::Plan
        );
    }

    #[test]
    fn failed_status_activity_rolls_back_task_update() {
        let conn = open_in_memory();
        let p = project(&conn, "Agen");
        let t = task(&conn, &p, "Tugas");
        conn.execute_batch("CREATE TRIGGER reject_activity BEFORE INSERT ON activities BEGIN SELECT RAISE(ABORT, 'failed'); END;").unwrap();
        assert!(set_status(&conn, &t, TaskStatus::Done, "Sol", now() + 1).is_err());
        assert_eq!(
            tasks::get_task(&conn, &t, now(), &jakarta())
                .unwrap()
                .card
                .status,
            TaskStatus::Plan
        );
        let item = items::get(&conn, &t).unwrap();
        assert_eq!(item.completed_at, None);
        assert_eq!(item.updated_at, now());
        assert!(for_task(&conn, &t).unwrap().is_empty());
    }

    #[test]
    fn inbox_lists_requests_without_follow_up() {
        let conn = open_in_memory();
        let p = project(&conn, "Agen");
        let q = project(&conn, "Lain");
        let pending = task(&conn, &p, "Menunggu");
        let followed = task(&conn, &p, "Direncanakan");
        let doing = task(&conn, &p, "Dikerjakan");
        let elsewhere = task(&conn, &q, "Lain");
        let deleted = task(&conn, &p, "Dihapus");
        task(&conn, &p, "Tanpa permintaan");
        for (p, t) in [
            (&p, &pending),
            (&p, &followed),
            (&p, &doing),
            (&q, &elsewhere),
            (&p, &deleted),
        ] {
            add(&conn, &message(p, Some(t), Role::Request), now()).unwrap();
        }
        let follow_up = add(&conn, &message(&p, Some(&followed), Role::Plan), now() + 1).unwrap();
        set_status(&conn, &doing, TaskStatus::Doing, "Sol", now() + 1).unwrap();
        items::soft_delete(&conn, &deleted, now() + 1).unwrap();
        let ids: Vec<String> = inbox(&conn, None)
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert_eq!(ids, vec![pending.clone(), elsewhere.clone()]);
        assert_eq!(
            inbox(&conn, Some(&p))
                .unwrap()
                .iter()
                .map(|t| &t.id)
                .collect::<Vec<_>>(),
            vec![&pending]
        );
        items::soft_delete(&conn, &follow_up.id, now() + 2).unwrap();
        assert_eq!(inbox(&conn, Some(&p)).unwrap().len(), 2);
        items::soft_delete(&conn, &q, now() + 3).unwrap();
        assert_eq!(inbox(&conn, None).unwrap().len(), 2);
    }

    #[test]
    fn save_plan_writes_activity_and_notes_page() {
        let conn = open_in_memory();
        let p = project(&conn, "Anchoa");
        let t = task(&conn, &p, "Fitur agen");
        let markdown = "# Rencana\n\nBuat [[Referensi]].";
        let reference = crate::notes::create(&conn, None, "Referensi", now()).unwrap();
        let activity = save_plan(&conn, &t, "Sol", markdown, now() + 1).unwrap();
        assert_eq!((activity.role, activity.kind), (Role::Plan, Kind::Result));
        assert_eq!(activity.body, markdown);
        let pages = crate::notes::tree(&conn).unwrap();
        let parent = pages.iter().find(|p| p.title == "Rencana Anchoa").unwrap();
        let page = pages.iter().find(|p| p.title == "Fitur agen").unwrap();
        assert_eq!(page.parent_id.as_deref(), Some(parent.id.as_str()));
        assert_eq!(items::get(&conn, &page.id).unwrap().body, markdown);
        assert!(
            crate::links::backlinks(&conn, &reference.id)
                .unwrap()
                .iter()
                .any(|link| link.id == page.id)
        );
        let second = task(&conn, &p, "Fitur kedua");
        save_plan(&conn, &second, "Sol", "Rencana kedua", now() + 2).unwrap();
        assert_eq!(
            crate::notes::tree(&conn)
                .unwrap()
                .iter()
                .filter(|p| p.title == "Rencana Anchoa")
                .count(),
            1
        );
    }

    #[test]
    fn failed_plan_page_rolls_back_activity_and_parent_page() {
        let conn = open_in_memory();
        let p = project(&conn, "Agen");
        let t = task(&conn, &p, "Tugas");
        conn.execute_batch("CREATE TRIGGER reject_plan BEFORE INSERT ON items WHEN new.type = 'page' AND new.parent_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'failed'); END;").unwrap();
        assert!(save_plan(&conn, &t, "Sol", "Rencana", now()).is_err());
        assert!(for_task(&conn, &t).unwrap().is_empty());
        assert!(crate::notes::tree(&conn).unwrap().is_empty());
    }
}
