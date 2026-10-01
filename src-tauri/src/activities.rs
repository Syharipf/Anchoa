//! Shared activity history for the UI and the agent CLI.
use std::collections::HashMap;

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::tasks::{TaskCard, TaskStatus};

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

pub fn add(_conn: &Connection, _a: &NewActivity, _now: i64) -> Result<Activity, AppError> {
    Err(AppError::NotFound)
}

pub fn for_task(_conn: &Connection, _task_id: &str) -> Result<Vec<Activity>, AppError> {
    Ok(Vec::new())
}

pub fn for_project(_conn: &Connection, _project_id: &str, _limit: usize) -> Result<Vec<Activity>, AppError> {
    Ok(Vec::new())
}

pub fn last_for_tasks(_conn: &Connection, _project_id: &str) -> Result<HashMap<String, (String, Role)>, AppError> {
    Ok(HashMap::new())
}

pub fn set_status(_conn: &Connection, _task_id: &str, _status: TaskStatus, _actor: &str, _now: i64) -> Result<(), AppError> {
    Err(AppError::NotFound)
}

pub fn inbox(_conn: &Connection, _project_id: Option<&str>) -> Result<Vec<TaskCard>, AppError> {
    Ok(Vec::new())
}

pub fn save_plan(_conn: &Connection, _task_id: &str, _actor: &str, _markdown: &str, _now: i64) -> Result<Activity, AppError> {
    Err(AppError::NotFound)
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
        conn.execute("INSERT INTO projects (item_id, kind, agent) VALUES (?1, 'app', 1)", [&id]).unwrap();
        id
    }

    fn task(conn: &Connection, project_id: &str, title: &str) -> String {
        tasks::create_task(conn, &NewTask {
            title: title.into(), project_id: Some(project_id.into()), ..Default::default()
        }, now(), &jakarta()).unwrap().id
    }

    fn message(project_id: &str, task_id: Option<&str>, role: Role) -> NewActivity {
        NewActivity {
            project_id: project_id.into(), task_id: task_id.map(String::from), actor: "Sol".into(),
            role, kind: Kind::Message, title: "Ringkasan".into(), body: "Isi".into(),
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
            assert!(matches!(add(&conn, &input, now()), Err(AppError::Invalid(_))));
        }
        input.actor = "界".repeat(40);
        input.body = "a".repeat(200 * 1024 + 1);
        assert!(matches!(add(&conn, &input, now()), Err(AppError::Invalid(_))));
        assert!(for_task(&conn, &t).unwrap().is_empty());
        input.body = "é".repeat(100 * 1024);
        let added = add(&conn, &input, now()).unwrap();
        assert_eq!(added.actor, input.actor);
        assert_eq!(added.body, input.body);
        assert_eq!(items::get(&conn, &added.id).unwrap().kind, "activity");
        assert_eq!(uuid::Uuid::parse_str(&added.id).unwrap().get_version_num(), 7);
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
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM items WHERE type = 'activity'", [], |r| r.get(0)).unwrap();
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
        assert_eq!(for_project(&conn, &p, 2).unwrap(), vec![c.clone(), b.clone()]);
        assert!(for_project(&conn, &p, 0).unwrap().is_empty());
        assert_eq!(last_for_tasks(&conn, &p).unwrap().get(&t), Some(&("Sol".into(), Role::Implement)));
        items::soft_delete(&conn, &b.id, now() + 2).unwrap();
        assert_eq!(last_for_tasks(&conn, &p).unwrap().get(&t), Some(&("Sol".into(), Role::Request)));
        items::soft_delete(&conn, &t, now() + 3).unwrap();
        assert_eq!(for_project(&conn, &p, 10).unwrap(), vec![c]);
        assert!(last_for_tasks(&conn, &p).unwrap().is_empty());
    }

    #[test]
    fn set_status_writes_a_status_activity() {
        let conn = open_in_memory();
        let p = project(&conn, "Agen");
        let t = task(&conn, &p, "Tugas");
        for (index, status) in [TaskStatus::Doing, TaskStatus::Test, TaskStatus::Review, TaskStatus::Done, TaskStatus::Plan].into_iter().enumerate() {
            set_status(&conn, &t, status, "Sol", now() + index as i64).unwrap();
            let detail = tasks::get_task(&conn, &t, now(), &jakarta()).unwrap();
            assert_eq!(detail.card.status, status);
            assert_eq!(items::get(&conn, &t).unwrap().completed_at.is_some(), status == TaskStatus::Done);
        }
        let rows = for_task(&conn, &t).unwrap();
        assert_eq!(rows.len(), 5);
        assert_eq!((rows[1].actor.as_str(), rows[1].role, rows[1].kind), ("Sol", Role::Test, Kind::Status));
        assert_eq!(rows[1].title, "Sol memindahkan ke Tes");
        set_status(&conn, &t, TaskStatus::Plan, "Sol", now() + 10).unwrap();
        assert_eq!(for_task(&conn, &t).unwrap().len(), 5);
        assert!(set_status(&conn, "missing", TaskStatus::Test, "Sol", now()).is_err());
        assert!(set_status(&conn, &t, TaskStatus::Test, "", now()).is_err());
        assert_eq!(tasks::get_task(&conn, &t, now(), &jakarta()).unwrap().card.status, TaskStatus::Plan);
    }

    #[test]
    fn failed_status_activity_rolls_back_task_update() {
        let conn = open_in_memory();
        let p = project(&conn, "Agen");
        let t = task(&conn, &p, "Tugas");
        conn.execute_batch("CREATE TRIGGER reject_activity BEFORE INSERT ON activities BEGIN SELECT RAISE(ABORT, 'failed'); END;").unwrap();
        assert!(set_status(&conn, &t, TaskStatus::Done, "Sol", now() + 1).is_err());
        assert_eq!(tasks::get_task(&conn, &t, now(), &jakarta()).unwrap().card.status, TaskStatus::Plan);
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
        for (p, t) in [(&p, &pending), (&p, &followed), (&p, &doing), (&q, &elsewhere), (&p, &deleted)] {
            add(&conn, &message(p, Some(t), Role::Request), now()).unwrap();
        }
        let follow_up = add(&conn, &message(&p, Some(&followed), Role::Plan), now() + 1).unwrap();
        set_status(&conn, &doing, TaskStatus::Doing, "Sol", now() + 1).unwrap();
        items::soft_delete(&conn, &deleted, now() + 1).unwrap();
        let ids: Vec<String> = inbox(&conn, None).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec![pending.clone(), elsewhere.clone()]);
        assert_eq!(inbox(&conn, Some(&p)).unwrap().iter().map(|t| &t.id).collect::<Vec<_>>(), vec![&pending]);
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
        assert!(crate::links::backlinks(&conn, &reference.id).unwrap().iter().any(|link| link.id == page.id));
        let second = task(&conn, &p, "Fitur kedua");
        save_plan(&conn, &second, "Sol", "Rencana kedua", now() + 2).unwrap();
        assert_eq!(crate::notes::tree(&conn).unwrap().iter().filter(|p| p.title == "Rencana Anchoa").count(), 1);
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
