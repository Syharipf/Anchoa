//! Tasks with status, subtasks, projects and notes conversion (spec Fase 3A §3-4).
use jiff::tz::TimeZone;
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::{Connection, OptionalExtension, Params, params};
use serde::{Deserialize, Deserializer, Serialize};

use crate::error::AppError;
use crate::finance::invalid;
use crate::items;
use crate::time::day_bounds;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    #[default]
    Plan,
    Doing,
    Test,
    Review,
    Done,
}

impl ToSql for TaskStatus {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(match self {
            TaskStatus::Plan => "plan",
            TaskStatus::Doing => "doing",
            TaskStatus::Test => "test",
            TaskStatus::Review => "review",
            TaskStatus::Done => "done",
        }
        .into())
    }
}

impl FromSql for TaskStatus {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "plan" => Ok(TaskStatus::Plan),
            "doing" => Ok(TaskStatus::Doing),
            "test" => Ok(TaskStatus::Test),
            "review" => Ok(TaskStatus::Review),
            "done" => Ok(TaskStatus::Done),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCard {
    pub id: String,
    pub title: String,
    pub status: TaskStatus,
    pub tag: Option<String>,
    pub due_at: Option<i64>,
    pub overdue: bool,
    pub sub_done: i64,
    pub sub_total: i64,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDetail {
    #[serde(flatten)]
    pub card: TaskCard,
    pub start_at: Option<i64>,
    pub parent_id: Option<String>,
    pub parent_title: Option<String>,
    pub subtasks: Vec<TaskCard>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTask {
    pub title: String,
    pub project_id: Option<String>,
    pub parent_id: Option<String>,
    pub status: TaskStatus,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    pub status: Option<TaskStatus>,
    #[serde(default, deserialize_with = "present_opt")]
    pub project_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "present_opt")]
    pub start_at: Option<Option<i64>>,
    #[serde(default, deserialize_with = "present_opt")]
    pub tag: Option<Option<String>>,
}

fn present_opt<'de, T: Deserialize<'de>, D: Deserializer<'de>>(d: D) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(d).map(Some)
}

const CARD_SELECT: &str = "
    SELECT i.id, i.title, t.status, t.tag, i.due_at,
           (SELECT COUNT(*) FROM items sub_i JOIN tasks sub_t ON sub_t.item_id = sub_i.id
            WHERE sub_i.parent_id = i.id AND sub_i.deleted_at IS NULL AND sub_t.status = 'done') AS sub_done,
           (SELECT COUNT(*) FROM items sub_i
            WHERE sub_i.parent_id = i.id AND sub_i.deleted_at IS NULL AND sub_i.type = 'task') AS sub_total,
           t.project_id,
           (SELECT pi.title FROM items pi WHERE pi.id = t.project_id AND pi.deleted_at IS NULL) AS project_name
    FROM tasks t
    JOIN items i ON i.id = t.item_id
    WHERE i.deleted_at IS NULL";

pub fn card_query(
    conn: &Connection,
    clause: &str,
    params: impl Params,
    now: i64,
    tz: &TimeZone,
) -> Result<Vec<TaskCard>, AppError> {
    let (today_start, _) = day_bounds(now, tz)?;
    let trimmed = clause.trim();
    let sql = if trimmed.is_empty() {
        CARD_SELECT.to_string()
    } else if trimmed.to_uppercase().starts_with("ORDER BY") || trimmed.to_uppercase().starts_with("LIMIT") {
        format!("{CARD_SELECT} {trimmed}")
    } else {
        format!("{CARD_SELECT} AND {trimmed}")
    };
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params, |r| {
        let status: TaskStatus = r.get(2)?;
        let due_at: Option<i64> = r.get(4)?;
        let overdue = due_at.is_some_and(|due| due < today_start) && status != TaskStatus::Done;
        Ok(TaskCard {
            id: r.get(0)?,
            title: r.get(1)?,
            status,
            tag: r.get(3)?,
            due_at,
            overdue,
            sub_done: r.get(5)?,
            sub_total: r.get(6)?,
            project_id: r.get(7)?,
            project_name: r.get(8)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub(crate) fn apply_status(tx: &Connection, id: &str, status: TaskStatus, now: i64) -> Result<(), AppError> {
    let completed_at = match status {
        TaskStatus::Done => Some(now),
        TaskStatus::Plan | TaskStatus::Doing | TaskStatus::Test | TaskStatus::Review => None,
    };
    tx.execute("UPDATE tasks SET status = ?2 WHERE item_id = ?1", params![id, status])?;
    tx.execute(
        "UPDATE items SET completed_at = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, completed_at, now],
    )?;
    Ok(())
}

fn validate_project(conn: &Connection, project_id: &str) -> Result<(), AppError> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM items WHERE id = ?1 AND deleted_at IS NULL AND type = 'project')",
        [project_id],
        |r| r.get(0),
    )?;
    if !exists {
        return Err(invalid("Proyek tidak ditemukan"));
    }
    Ok(())
}

pub fn create_task(
    conn: &Connection,
    input: &NewTask,
    now: i64,
    tz: &TimeZone,
) -> Result<TaskCard, AppError> {
    let tx = conn.unchecked_transaction()?;
    let result = create_task_in_transaction(&tx, input, now, tz)?;
    tx.commit()?;
    Ok(result)
}

/// Shared creation rules for compound operations that own their transaction.
pub(crate) fn create_task_in_transaction(
    conn: &Connection,
    input: &NewTask,
    now: i64,
    tz: &TimeZone,
) -> Result<TaskCard, AppError> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(invalid("Judul tugas tidak boleh kosong"));
    }

    let (effective_project_id, parent_id) = match &input.parent_id {
        Some(pid) => {
            let parent_info: Option<(Option<String>, Option<String>)> = conn
                .query_row(
                    "SELECT i.parent_id, t.project_id FROM items i
                     JOIN tasks t ON t.item_id = i.id
                     WHERE i.id = ?1 AND i.deleted_at IS NULL AND i.type = 'task'",
                    [pid],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;

            let (grandparent, parent_proj) = parent_info.ok_or_else(|| invalid("Tugas induk tidak ditemukan"))?;
            if grandparent.is_some() {
                return Err(invalid("Sub-tugas tidak bisa memiliki sub-tugas"));
            }
            (parent_proj, Some(pid.clone()))
        }
        None => {
            if let Some(proj_id) = &input.project_id {
                validate_project(conn, proj_id)?;
            }
            (input.project_id.clone(), None)
        }
    };

    let id = items::insert(conn, "task", title, "", now)?;
    if let Some(pid) = &parent_id {
        conn.execute("UPDATE items SET parent_id = ?2 WHERE id = ?1", params![id, pid])?;
    }
    conn.execute(
        "INSERT INTO tasks (item_id, status, project_id) VALUES (?1, ?2, ?3)",
        params![id, TaskStatus::Plan, effective_project_id],
    )?;
    apply_status(conn, &id, input.status, now)?;

    card_query(conn, "i.id = ?1", [&id], now, tz)?
        .into_iter()
        .next()
        .ok_or(AppError::NotFound)
}

pub fn get_task(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<TaskDetail, AppError> {
    let card = card_query(conn, "i.id = ?1", [id], now, tz)?
        .into_iter()
        .next()
        .ok_or(AppError::NotFound)?;

    let (start_at, parent_id): (Option<i64>, Option<String>) = conn.query_row(
        "SELECT t.start_at, i.parent_id FROM tasks t JOIN items i ON i.id = t.item_id WHERE i.id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;

    let parent_title = if let Some(pid) = &parent_id {
        conn.query_row(
            "SELECT title FROM items WHERE id = ?1 AND deleted_at IS NULL",
            [pid],
            |r| r.get(0),
        )
        .optional()?
    } else {
        None
    };

    let subtasks = card_query(conn, "i.parent_id = ?1 ORDER BY i.created_at, i.id", [id], now, tz)?;

    Ok(TaskDetail {
        card,
        start_at,
        parent_id,
        parent_title,
        subtasks,
    })
}

pub fn update_task(
    conn: &Connection,
    id: &str,
    patch: &TaskPatch,
    now: i64,
    tz: &TimeZone,
) -> Result<TaskDetail, AppError> {
    let task_row: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT i.parent_id, t.project_id FROM items i JOIN tasks t ON t.item_id = i.id WHERE i.id = ?1 AND i.deleted_at IS NULL",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;

    let (parent_id, _) = task_row.ok_or(AppError::NotFound)?;

    let tx = conn.unchecked_transaction()?;
    let unassigning = matches!(patch.project_id, Some(None));
    // Keep the original project on the status activity when this patch makes the task loose.
    if let Some(status) = patch.status.filter(|_| unassigning) {
        crate::activities::set_status_in_transaction(&tx, id, status, "Kamu", now)?;
    }

    if let Some(maybe_proj) = &patch.project_id {
        if parent_id.is_some() {
            return Err(invalid("Sub-tugas selalu mengikuti proyek induknya"));
        }
        let new_proj = match maybe_proj {
            Some(pid) => {
                validate_project(&tx, pid)?;
                Some(pid.clone())
            }
            None => None,
        };
        tx.execute(
            "UPDATE tasks SET project_id = ?2 WHERE item_id = ?1",
            params![id, new_proj],
        )?;
        tx.execute(
            "UPDATE tasks SET project_id = ?2 WHERE item_id IN (
                SELECT id FROM items WHERE parent_id = ?1 AND deleted_at IS NULL
             )",
            params![id, new_proj],
        )?;
        tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![id, now])?;
    }

    if let Some(status) = patch.status.filter(|_| !unassigning) {
        crate::activities::set_status_in_transaction(&tx, id, status, "Kamu", now)?;
    }

    if let Some(maybe_start) = patch.start_at {
        tx.execute(
            "UPDATE tasks SET start_at = ?2 WHERE item_id = ?1",
            params![id, maybe_start],
        )?;
        tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![id, now])?;
    }

    if let Some(maybe_tag) = &patch.tag {
        let tag = maybe_tag.as_ref().map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
        tx.execute(
            "UPDATE tasks SET tag = ?2 WHERE item_id = ?1",
            params![id, tag],
        )?;
        tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![id, now])?;
    }

    tx.commit()?;
    get_task(conn, id, now, tz)
}

pub fn delete_task(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM items WHERE id = ?1 AND deleted_at IS NULL AND type = 'task')",
        [id],
        |r| r.get(0),
    )?;
    if !exists {
        return Err(AppError::NotFound);
    }
    let tx = conn.unchecked_transaction()?;
    items::soft_delete(&tx, id, now)?;
    tx.execute(
        "UPDATE items SET deleted_at = ?2 WHERE parent_id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn convert_to_task(
    conn: &Connection,
    id: &str,
    now: i64,
    tz: &TimeZone,
) -> Result<TaskDetail, AppError> {
    let item = items::get(conn, id)?;
    if item.kind != "note" {
        return Err(invalid("Hanya catatan yang bisa diubah menjadi tugas"));
    }

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO tasks (item_id, status) VALUES (?1, 'plan')",
        [id],
    )?;
    tx.execute(
        "UPDATE items SET type = 'task', completed_at = NULL, updated_at = ?2 WHERE id = ?1",
        params![id, now],
    )?;
    tx.commit()?;

    get_task(conn, id, now, tz)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::finance::testing::{jakarta, ms, now};
    use crate::items::{ItemPatch, capture_note, update};

    fn make_project(conn: &Connection, name: &str) -> String {
        let id = items::insert(conn, "project", name, "deskripsi", now()).unwrap();
        conn.execute(
            "INSERT INTO projects (item_id, kind) VALUES (?1, 'app')",
            [&id],
        )
        .unwrap();
        id
    }

    #[test]
    fn update_task_status_writes_activity_as_kamu_only_when_changed() {
        let conn = open_in_memory();
        let project = make_project(&conn, "Agen");
        let task = create_task(&conn, &NewTask {
            title: "Tugas".into(), project_id: Some(project), ..Default::default()
        }, now(), &jakarta()).unwrap();
        let patch = TaskPatch { status: Some(TaskStatus::Doing), ..Default::default() };
        update_task(&conn, &task.id, &patch, now() + 1, &jakarta()).unwrap();
        update_task(&conn, &task.id, &patch, now() + 2, &jakarta()).unwrap();
        update_task(&conn, &task.id, &TaskPatch { tag: Some(Some("UI".into())), ..Default::default() }, now() + 3, &jakarta()).unwrap();
        let rows: Vec<(String, String)> = conn.prepare(
            "SELECT actor, kind FROM activities WHERE task_id = ?1"
        ).unwrap().query_map([&task.id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
            .collect::<Result<_, _>>().unwrap();
        assert_eq!(rows, vec![("Kamu".into(), "status".into())]);
    }

    #[test]
    fn test_and_review_statuses_round_trip_and_clear_completion() {
        let conn = open_in_memory();
        let task = create_task(&conn, &NewTask {
            title: "Tugas".into(), status: TaskStatus::Done, ..Default::default()
        }, now(), &jakarta()).unwrap();
        for status in ["test", "review"] {
            let patch: TaskPatch = serde_json::from_value(serde_json::json!({"status": status})).unwrap();
            let detail = update_task(&conn, &task.id, &patch, now() + 1, &jakarta()).unwrap();
            assert_eq!(serde_json::to_value(detail.card.status).unwrap(), status);
            assert_eq!(items::get(&conn, &task.id).unwrap().completed_at, None);
        }
    }

    #[test]
    fn ui_status_and_other_fields_roll_back_if_activity_fails() {
        let conn = open_in_memory();
        let p = make_project(&conn, "Agen");
        let task = create_task(&conn, &NewTask {
            title: "Tugas".into(), project_id: Some(p), ..Default::default()
        }, now(), &jakarta()).unwrap();
        conn.execute_batch("CREATE TRIGGER reject_activity BEFORE INSERT ON activities BEGIN SELECT RAISE(ABORT, 'failed'); END;").unwrap();
        let patch = TaskPatch { status: Some(TaskStatus::Done), tag: Some(Some("UI".into())), ..Default::default() };
        assert!(update_task(&conn, &task.id, &patch, now() + 1, &jakarta()).is_err());
        assert_eq!(get_task(&conn, &task.id, now(), &jakarta()).unwrap().card, task);
        assert_eq!(items::get(&conn, &task.id).unwrap().completed_at, None);
    }

    #[test]
    fn moving_a_loose_task_to_a_project_and_changing_status_records_history() {
        let conn = open_in_memory();
        let p = make_project(&conn, "Agen");
        let task = create_task(&conn, &NewTask { title: "Tugas".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        let patch = TaskPatch { status: Some(TaskStatus::Test), project_id: Some(Some(p.clone())), ..Default::default() };
        update_task(&conn, &task.id, &patch, now() + 1, &jakarta()).unwrap();
        let rows = crate::activities::for_task(&conn, &task.id).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].project_id, p);
        assert_eq!(rows[0].actor, "Kamu");
    }

    #[test]
    fn unassigning_a_task_while_changing_status_keeps_its_history() {
        let conn = open_in_memory();
        let p = make_project(&conn, "Agen");
        let task = create_task(&conn, &NewTask {
            title: "Tugas".into(), project_id: Some(p.clone()), ..Default::default()
        }, now(), &jakarta()).unwrap();
        let patch = TaskPatch { status: Some(TaskStatus::Review), project_id: Some(None), ..Default::default() };
        let detail = update_task(&conn, &task.id, &patch, now() + 1, &jakarta()).unwrap();
        assert_eq!(detail.card.project_id, None);
        assert_eq!(detail.card.status, TaskStatus::Review);
        let rows = crate::activities::for_task(&conn, &task.id).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].project_id, p);
    }

    #[test]
    fn create_task_trims_and_validates() {
        let conn = open_in_memory();
        let blank = NewTask { title: "   ".into(), ..Default::default() };
        assert!(matches!(create_task(&conn, &blank, now(), &jakarta()), Err(AppError::Invalid(_))));

        let ghost_proj = NewTask {
            title: "Tugas".into(),
            project_id: Some("nope".into()),
            ..Default::default()
        };
        assert!(matches!(create_task(&conn, &ghost_proj, now(), &jakarta()), Err(AppError::Invalid(_))));

        let proj = make_project(&conn, "Proyek A");
        items::soft_delete(&conn, &proj, now()).unwrap();
        let deleted_proj = NewTask {
            title: "Tugas".into(),
            project_id: Some(proj),
            ..Default::default()
        };
        assert!(matches!(create_task(&conn, &deleted_proj, now(), &jakarta()), Err(AppError::Invalid(_))));
    }

    #[test]
    fn status_and_completed_at_stay_in_sync() {
        let conn = open_in_memory();
        let card = create_task(
            &conn,
            &NewTask {
                title: "Tugas A".into(),
                status: TaskStatus::Plan,
                ..Default::default()
            },
            now(),
            &jakarta(),
        )
        .unwrap();
        let item = items::get(&conn, &card.id).unwrap();
        assert_eq!(item.completed_at, None);

        // Update to done sets completed_at to now
        let done_time = now() + 5000;
        let detail = update_task(
            &conn,
            &card.id,
            &TaskPatch { status: Some(TaskStatus::Done), ..Default::default() },
            done_time,
            &jakarta(),
        )
        .unwrap();
        assert_eq!(detail.card.status, TaskStatus::Done);
        let item = items::get(&conn, &card.id).unwrap();
        assert_eq!(item.completed_at, Some(done_time));

        // Back to plan clears completed_at
        let plan_time = done_time + 5000;
        let detail = update_task(
            &conn,
            &card.id,
            &TaskPatch { status: Some(TaskStatus::Plan), ..Default::default() },
            plan_time,
            &jakarta(),
        )
        .unwrap();
        assert_eq!(detail.card.status, TaskStatus::Plan);
        let item = items::get(&conn, &card.id).unwrap();
        assert_eq!(item.completed_at, None);

        // Creating directly as done also sets completed_at
        let card_done = create_task(
            &conn,
            &NewTask {
                title: "Tugas Langsung Selesai".into(),
                status: TaskStatus::Done,
                ..Default::default()
            },
            now(),
            &jakarta(),
        )
        .unwrap();
        assert_eq!(card_done.status, TaskStatus::Done);
        let item_done = items::get(&conn, &card_done.id).unwrap();
        assert_eq!(item_done.completed_at, Some(now()));
    }

    #[test]
    fn subtasks_follow_their_parent() {
        let conn = open_in_memory();
        let proj1 = make_project(&conn, "Proyek 1");
        let proj2 = make_project(&conn, "Proyek 2");

        let parent = create_task(
            &conn,
            &NewTask {
                title: "Induk".into(),
                project_id: Some(proj1.clone()),
                status: TaskStatus::Plan,
                ..Default::default()
            },
            now(),
            &jakarta(),
        )
        .unwrap();

        // Subtask created with a different project_id still follows parent's project
        let sub1 = create_task(
            &conn,
            &NewTask {
                title: "Sub 1".into(),
                parent_id: Some(parent.id.clone()),
                project_id: Some(proj2.clone()),
                status: TaskStatus::Done,
            },
            now(),
            &jakarta(),
        )
        .unwrap();
        assert_eq!(sub1.project_id.as_deref(), Some(proj1.as_str()));

        let sub2 = create_task(
            &conn,
            &NewTask {
                title: "Sub 2".into(),
                parent_id: Some(parent.id.clone()),
                project_id: None,
                status: TaskStatus::Plan,
            },
            now(),
            &jakarta(),
        )
        .unwrap();
        assert_eq!(sub2.project_id.as_deref(), Some(proj1.as_str()));

        // Sub-subtask is rejected
        let sub_sub = NewTask {
            title: "Sub Sub".into(),
            parent_id: Some(sub1.id.clone()),
            ..Default::default()
        };
        assert!(matches!(create_task(&conn, &sub_sub, now(), &jakarta()), Err(AppError::Invalid(_))));

        // sub_done and sub_total on parent card are correct
        let parent_card = card_query(&conn, "i.id = ?1", [&parent.id], now(), &jakarta())
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        assert_eq!((parent_card.sub_done, parent_card.sub_total), (1, 2));
    }

    #[test]
    fn moving_a_parent_moves_its_subtasks() {
        let conn = open_in_memory();
        let proj1 = make_project(&conn, "Proyek 1");
        let proj2 = make_project(&conn, "Proyek 2");

        let parent = create_task(
            &conn,
            &NewTask {
                title: "Induk".into(),
                project_id: Some(proj1.clone()),
                status: TaskStatus::Plan,
                ..Default::default()
            },
            now(),
            &jakarta(),
        )
        .unwrap();

        let sub = create_task(
            &conn,
            &NewTask {
                title: "Sub".into(),
                parent_id: Some(parent.id.clone()),
                status: TaskStatus::Plan,
                ..Default::default()
            },
            now(),
            &jakarta(),
        )
        .unwrap();
        assert_eq!(sub.project_id.as_deref(), Some(proj1.as_str()));

        // Move parent to proj2 -> subtask also moves to proj2
        update_task(
            &conn,
            &parent.id,
            &TaskPatch {
                project_id: Some(Some(proj2.clone())),
                ..Default::default()
            },
            now(),
            &jakarta(),
        )
        .unwrap();

        let sub_card = card_query(&conn, "i.id = ?1", [&sub.id], now(), &jakarta())
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        assert_eq!(sub_card.project_id.as_deref(), Some(proj2.as_str()));

        // Move parent to null -> subtask also becomes loose
        update_task(
            &conn,
            &parent.id,
            &TaskPatch {
                project_id: Some(None),
                ..Default::default()
            },
            now(),
            &jakarta(),
        )
        .unwrap();

        let sub_card = card_query(&conn, "i.id = ?1", [&sub.id], now(), &jakarta())
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        assert_eq!(sub_card.project_id, None);
    }

    #[test]
    fn patch_leaves_missing_fields_alone() {
        let conn = open_in_memory();
        let task = create_task(
            &conn,
            &NewTask {
                title: "Tugas".into(),
                status: TaskStatus::Plan,
                ..Default::default()
            },
            now(),
            &jakarta(),
        )
        .unwrap();

        // First set tag: UI and startAt: 1000
        let json1 = r#"{"tag":"UI","startAt":1000}"#;
        let patch1: TaskPatch = serde_json::from_str(json1).unwrap();
        let d1 = update_task(&conn, &task.id, &patch1, now(), &jakarta()).unwrap();
        assert_eq!(d1.card.tag.as_deref(), Some("UI"));
        assert_eq!(d1.start_at, Some(1000));

        // Now patch with {"startAt":null} only
        let json2 = r#"{"startAt":null}"#;
        let patch2: TaskPatch = serde_json::from_str(json2).unwrap();
        let d2 = update_task(&conn, &task.id, &patch2, now(), &jakarta()).unwrap();
        // tag remains "UI", startAt becomes None
        assert_eq!(d2.card.tag.as_deref(), Some("UI"));
        assert_eq!(d2.start_at, None);
    }

    #[test]
    fn delete_task_takes_its_subtasks() {
        let conn = open_in_memory();
        let parent = create_task(
            &conn,
            &NewTask {
                title: "Induk".into(),
                status: TaskStatus::Plan,
                ..Default::default()
            },
            now(),
            &jakarta(),
        )
        .unwrap();

        let sub = create_task(
            &conn,
            &NewTask {
                title: "Sub".into(),
                parent_id: Some(parent.id.clone()),
                status: TaskStatus::Plan,
                ..Default::default()
            },
            now(),
            &jakarta(),
        )
        .unwrap();

        delete_task(&conn, &parent.id, now()).unwrap();

        assert!(matches!(get_task(&conn, &parent.id, now(), &jakarta()), Err(AppError::NotFound)));
        assert!(matches!(get_task(&conn, &sub.id, now(), &jakarta()), Err(AppError::NotFound)));
        let parent_del: Option<i64> = conn.query_row("SELECT deleted_at FROM items WHERE id = ?1", [&parent.id], |r| r.get(0)).unwrap();
        assert_eq!(parent_del, Some(now()));
        let sub_del: Option<i64> = conn.query_row("SELECT deleted_at FROM items WHERE id = ?1", [&sub.id], |r| r.get(0)).unwrap();
        assert_eq!(sub_del, Some(now()));
    }

    #[test]
    fn overdue_only_for_open_tasks_due_before_today() {
        let conn = open_in_memory();
        let yesterday = ms("2026-09-28T00:00:00+07:00");
        let today = ms("2026-09-29T00:00:00+07:00");
        let tomorrow = ms("2026-09-30T00:00:00+07:00");

        // Late open task -> overdue: true
        let t1 = create_task(&conn, &NewTask { title: "t1".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        update(&conn, &t1.id, &ItemPatch { due_at: Some(Some(yesterday)), ..Default::default() }, now()).unwrap();

        // Late done task -> overdue: false
        let t2 = create_task(
            &conn,
            &NewTask { title: "t2".into(), status: TaskStatus::Done, ..Default::default() },
            now(),
            &jakarta(),
        )
        .unwrap();
        update(&conn, &t2.id, &ItemPatch { due_at: Some(Some(yesterday)), ..Default::default() }, now()).unwrap();

        // Due today open task -> overdue: false
        let t3 = create_task(&conn, &NewTask { title: "t3".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        update(&conn, &t3.id, &ItemPatch { due_at: Some(Some(today)), ..Default::default() }, now()).unwrap();

        // Due tomorrow open task -> overdue: false
        let t4 = create_task(&conn, &NewTask { title: "t4".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        update(&conn, &t4.id, &ItemPatch { due_at: Some(Some(tomorrow)), ..Default::default() }, now()).unwrap();

        // No due date -> overdue: false
        let t5 = create_task(&conn, &NewTask { title: "t5".into(), ..Default::default() }, now(), &jakarta()).unwrap();

        let c1 = card_query(&conn, "i.id = ?1", [&t1.id], now(), &jakarta()).unwrap().remove(0);
        let c2 = card_query(&conn, "i.id = ?1", [&t2.id], now(), &jakarta()).unwrap().remove(0);
        let c3 = card_query(&conn, "i.id = ?1", [&t3.id], now(), &jakarta()).unwrap().remove(0);
        let c4 = card_query(&conn, "i.id = ?1", [&t4.id], now(), &jakarta()).unwrap().remove(0);
        let c5 = card_query(&conn, "i.id = ?1", [&t5.id], now(), &jakarta()).unwrap().remove(0);

        assert!(c1.overdue);
        assert!(!c2.overdue);
        assert!(!c3.overdue);
        assert!(!c4.overdue);
        assert!(!c5.overdue);
    }

    #[test]
    fn convert_to_task_only_takes_notes() {
        let conn = open_in_memory();
        let note = capture_note(&conn, "catatan tenggat", now()).unwrap();
        let due = ms("2026-10-01T00:00:00+07:00");
        update(&conn, &note.id, &ItemPatch { due_at: Some(Some(due)), ..Default::default() }, now()).unwrap();

        let detail = convert_to_task(&conn, &note.id, now(), &jakarta()).unwrap();
        assert_eq!(detail.card.status, TaskStatus::Plan);
        assert_eq!(detail.card.due_at, Some(due));
        let converted_item = items::get(&conn, &note.id).unwrap();
        assert_eq!(converted_item.kind, "task");

        // Converting a task or project is rejected as Invalid
        assert!(matches!(convert_to_task(&conn, &note.id, now(), &jakarta()), Err(AppError::Invalid(_))));

        let proj = make_project(&conn, "Proyek");
        assert!(matches!(convert_to_task(&conn, &proj, now(), &jakarta()), Err(AppError::Invalid(_))));
    }

    #[test]
    fn get_task_lists_subtasks_and_parent() {
        let conn = open_in_memory();
        let parent = create_task(
            &conn,
            &NewTask { title: "Induk".into(), ..Default::default() },
            now(),
            &jakarta(),
        )
        .unwrap();

        let sub1 = create_task(
            &conn,
            &NewTask { title: "Sub 1".into(), parent_id: Some(parent.id.clone()), ..Default::default() },
            now(),
            &jakarta(),
        )
        .unwrap();
        let sub2 = create_task(
            &conn,
            &NewTask { title: "Sub 2".into(), parent_id: Some(parent.id.clone()), ..Default::default() },
            now() + 10,
            &jakarta(),
        )
        .unwrap();

        let parent_detail = get_task(&conn, &parent.id, now(), &jakarta()).unwrap();
        assert_eq!(parent_detail.parent_id, None);
        assert_eq!(parent_detail.parent_title, None);
        let sub_ids: Vec<String> = parent_detail.subtasks.into_iter().map(|s| s.id).collect();
        assert_eq!(sub_ids, vec![sub1.id.clone(), sub2.id.clone()]);

        let sub1_detail = get_task(&conn, &sub1.id, now(), &jakarta()).unwrap();
        assert_eq!(sub1_detail.parent_id.as_deref(), Some(parent.id.as_str()));
        assert_eq!(sub1_detail.parent_title.as_deref(), Some("Induk"));
        assert!(sub1_detail.subtasks.is_empty());
    }
}
