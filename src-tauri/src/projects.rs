//! Projects, overview, and kanban board (spec Fase 3A §3-4).
use jiff::tz::TimeZone;
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::finance::invalid;
use crate::items;
use crate::tasks::{self, TaskCard, TaskStatus};
use crate::time::local_date;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectKind {
    #[default]
    App,
    Document,
    Research,
    Personal,
}

impl ToSql for ProjectKind {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(match self {
            ProjectKind::App => "app",
            ProjectKind::Document => "document",
            ProjectKind::Research => "research",
            ProjectKind::Personal => "personal",
        }
        .into())
    }
}

impl FromSql for ProjectKind {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "app" => Ok(ProjectKind::App),
            "document" => Ok(ProjectKind::Document),
            "research" => Ok(ProjectKind::Research),
            "personal" => Ok(ProjectKind::Personal),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectStatus {
    #[default]
    Active,
    Late,
    Done,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub kind: ProjectKind,
    pub deadline_at: Option<i64>,
    pub deadline_days: Option<i64>,
    pub status: ProjectStatus,
    pub done: i64,
    pub total: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetail {
    #[serde(flatten)]
    pub summary: ProjectSummary,
    pub description: String,
    pub repo_url: Option<String>,
    pub agent: bool,
    pub agent_command: Option<String>,
    pub agent_dir: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: ProjectKind,
    pub deadline_at: Option<i64>,
    pub repo_url: Option<String>,
    pub description: String,
    #[serde(default)]
    pub agent: bool,
    pub agent_command: Option<String>,
    pub agent_dir: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooseCount {
    pub done: i64,
    pub total: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub projects: Vec<ProjectSummary>,
    pub active_count: i64,
    pub loose: LooseCount,
    pub upcoming: Vec<TaskCard>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Columns {
    pub plan: Vec<TaskCard>,
    pub doing: Vec<TaskCard>,
    pub test: Vec<TaskCard>,
    pub review: Vec<TaskCard>,
    pub done: Vec<TaskCard>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub project: Option<ProjectDetail>,
    pub columns: Columns,
}

fn validate_repo_url(url: &str) -> bool {
    // regex: ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?$
    if !url.starts_with("https://github.com/") {
        return false;
    }
    let rest = &url["https://github.com/".len()..];
    let rest = rest.strip_suffix('/').unwrap_or(rest);
    let parts: Vec<&str> = rest.split('/').collect();
    if parts.len() != 2 {
        return false;
    }
    let valid_char = |c: char| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-';
    !parts[0].is_empty()
        && parts[0].chars().all(valid_char)
        && !parts[1].is_empty()
        && parts[1].chars().all(valid_char)
}

pub(crate) fn validate_agent_dir(dir: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(dir) = dir.map(str::trim).filter(|dir| !dir.is_empty()) else {
        return Ok(None);
    };
    let invalid_dir = || invalid("Folder agen harus ada dan berada di bawah home");
    #[cfg(not(windows))]
    let home_path = std::env::var_os("HOME");
    #[cfg(windows)]
    let home_path = std::env::var_os("USERPROFILE");
    let home = std::path::PathBuf::from(home_path.ok_or_else(invalid_dir)?)
        .canonicalize().map_err(|_| invalid_dir())?;
    let path = std::path::Path::new(dir).canonicalize().map_err(|_| invalid_dir())?;
    if !path.is_dir() || !path.starts_with(&home) {
        return Err(invalid_dir());
    }
    let path = path.to_str().ok_or_else(invalid_dir)?;
    Ok(Some(path.into()))
}

struct RawProject {
    id: String,
    name: String,
    description: String,
    kind: ProjectKind,
    deadline_at: Option<i64>,
    repo_url: Option<String>,
    done: i64,
    total: i64,
    agent: bool,
    agent_command: Option<String>,
    agent_dir: Option<String>,
}

const PROJECT_SELECT: &str = "
    SELECT i.id, i.title, i.body, p.kind, p.deadline_at, p.repo_url,
           (SELECT COUNT(*) FROM items ti JOIN tasks tt ON tt.item_id = ti.id
            WHERE ti.deleted_at IS NULL AND ti.type = 'task' AND ti.parent_id IS NULL
              AND tt.project_id = i.id AND tt.status = 'done') AS done,
           (SELECT COUNT(*) FROM items ti JOIN tasks tt ON tt.item_id = ti.id
            WHERE ti.deleted_at IS NULL AND ti.type = 'task' AND ti.parent_id IS NULL
              AND tt.project_id = i.id) AS total,
           p.agent, p.agent_command, p.agent_dir
    FROM projects p
    JOIN items i ON i.id = p.item_id
    WHERE i.deleted_at IS NULL";

fn raw_from_row(r: &rusqlite::Row) -> rusqlite::Result<RawProject> {
    Ok(RawProject {
        id: r.get(0)?,
        name: r.get(1)?,
        description: r.get(2)?,
        kind: r.get(3)?,
        deadline_at: r.get(4)?,
        repo_url: r.get(5)?,
        done: r.get(6)?,
        total: r.get(7)?,
        agent: r.get(8)?,
        agent_command: r.get(9)?,
        agent_dir: r.get(10)?,
    })
}

fn build_summary(raw: &RawProject, now: i64, tz: &TimeZone) -> Result<ProjectSummary, AppError> {
    let deadline_days = match raw.deadline_at {
        Some(d_ms) => {
            let today = local_date(now, tz)?;
            let deadline = local_date(d_ms, tz)?;
            Some(i64::from(today.until(deadline)?.get_days()))
        }
        None => None,
    };

    let status = if raw.total > 0 && raw.done == raw.total {
        ProjectStatus::Done
    } else if deadline_days.is_some_and(|days| days < 0) {
        ProjectStatus::Late
    } else {
        ProjectStatus::Active
    };

    Ok(ProjectSummary {
        id: raw.id.clone(),
        name: raw.name.clone(),
        kind: raw.kind,
        deadline_at: raw.deadline_at,
        deadline_days,
        status,
        done: raw.done,
        total: raw.total,
    })
}

fn build_detail(raw: RawProject, now: i64, tz: &TimeZone) -> Result<ProjectDetail, AppError> {
    let description = raw.description.clone();
    let repo_url = raw.repo_url.clone();
    let summary = build_summary(&raw, now, tz)?;
    Ok(ProjectDetail {
        summary,
        description,
        repo_url,
        agent: raw.agent,
        agent_command: raw.agent_command,
        agent_dir: raw.agent_dir,
    })
}

fn sort_projects(projects: &mut [ProjectSummary]) {
    projects.sort_by(|a, b| {
        let a_done = a.status == ProjectStatus::Done;
        let b_done = b.status == ProjectStatus::Done;
        if a_done != b_done {
            return a_done.cmp(&b_done);
        }
        match (a.deadline_at, b.deadline_at) {
            (Some(d1), Some(d2)) if d1 != d2 => d1.cmp(&d2),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
}

pub fn get_project(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<ProjectDetail, AppError> {
    let raw = conn
        .query_row(
            &format!("{PROJECT_SELECT} AND i.id = ?1"),
            [id],
            raw_from_row,
        )
        .optional()?
        .ok_or(AppError::NotFound)?;
    build_detail(raw, now, tz)
}

pub fn save_project(
    conn: &Connection,
    input: &ProjectInput,
    now: i64,
    tz: &TimeZone,
) -> Result<ProjectDetail, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(invalid("Nama proyek tidak boleh kosong"));
    }

    let repo_url = match &input.repo_url {
        Some(url) => {
            let trimmed = url.trim();
            if trimmed.is_empty() {
                None
            } else if validate_repo_url(trimmed) {
                Some(trimmed.to_string())
            } else {
                return Err(invalid("URL repositori tidak valid"));
            }
        }
        None => None,
    };

    let agent_dir = validate_agent_dir(input.agent_dir.as_deref())?;
    let agent_command = input.agent_command.as_deref().map(str::trim).filter(|command| !command.is_empty());
    let tx = conn.unchecked_transaction()?;
    let id = match &input.id {
        None => {
            let id = items::insert(&tx, "project", name, &input.description, now)?;
            tx.execute(
                "INSERT INTO projects (item_id, kind, deadline_at, repo_url, agent, agent_command, agent_dir)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, input.kind, input.deadline_at, repo_url, input.agent, agent_command, agent_dir],
            )?;
            id
        }
        Some(id) => {
            let exists: bool = tx.query_row(
                "SELECT EXISTS (SELECT 1 FROM items WHERE id = ?1 AND deleted_at IS NULL AND type = 'project')",
                [id],
                |r| r.get(0),
            )?;
            if !exists {
                return Err(AppError::NotFound);
            }
            tx.execute(
                "UPDATE items SET title = ?2, body = ?3, updated_at = ?4 WHERE id = ?1",
                params![id, name, input.description, now],
            )?;
            tx.execute(
                "UPDATE projects SET kind = ?2, deadline_at = ?3, repo_url = ?4,
                 agent = ?5, agent_command = ?6, agent_dir = ?7 WHERE item_id = ?1",
                params![id, input.kind, input.deadline_at, repo_url, input.agent, agent_command, agent_dir],
            )?;
            id.clone()
        }
    };
    tx.commit()?;

    get_project(conn, &id, now, tz)
}

pub fn delete_project(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM items WHERE id = ?1 AND deleted_at IS NULL AND type = 'project')",
        [id],
        |r| r.get(0),
    )?;
    if !exists {
        return Err(AppError::NotFound);
    }

    let tx = conn.unchecked_transaction()?;
    items::soft_delete(&tx, id, now)?;
    // Move its tasks to loose tasks
    tx.execute(
        "UPDATE tasks SET project_id = NULL WHERE project_id = ?1",
        [id],
    )?;
    tx.commit()?;
    Ok(())
}

pub fn projects_overview(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Overview, AppError> {
    let mut stmt = conn.prepare(PROJECT_SELECT)?;
    let raws = stmt.query_map([], raw_from_row)?.collect::<Result<Vec<_>, _>>()?;

    let mut projects = Vec::new();
    for raw in raws {
        projects.push(build_summary(&raw, now, tz)?);
    }
    sort_projects(&mut projects);

    let active_count = projects.iter().filter(|p| p.status != ProjectStatus::Done).count() as i64;

    let loose: LooseCount = conn.query_row(
        "SELECT
            COALESCE(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END), 0),
            COUNT(*)
         FROM items i
         JOIN tasks t ON t.item_id = i.id
         WHERE i.deleted_at IS NULL AND i.type = 'task' AND i.parent_id IS NULL AND t.project_id IS NULL",
        [],
        |r| Ok(LooseCount { done: r.get(0)?, total: r.get(1)? }),
    )?;

    let upcoming = tasks::card_query(
        conn,
        "t.status != 'done' AND i.due_at IS NOT NULL ORDER BY i.due_at, i.title, i.id LIMIT 5",
        [],
        now,
        tz,
    )?;

    Ok(Overview {
        projects,
        active_count,
        loose,
        upcoming,
    })
}

pub fn project_board(
    conn: &Connection,
    id: Option<&str>,
    now: i64,
    tz: &TimeZone,
) -> Result<Board, AppError> {
    let project = match id {
        Some(proj_id) => Some(get_project(conn, proj_id, now, tz)?),
        None => None,
    };

    let (clause, params): (&str, Vec<rusqlite::types::Value>) = match id {
        Some(proj_id) => (
            "i.parent_id IS NULL AND t.project_id = ?1 ORDER BY CASE WHEN i.due_at IS NULL THEN 1 ELSE 0 END, i.due_at, i.created_at, i.id",
            vec![proj_id.to_string().into()],
        ),
        None => (
            "i.parent_id IS NULL AND t.project_id IS NULL ORDER BY CASE WHEN i.due_at IS NULL THEN 1 ELSE 0 END, i.due_at, i.created_at, i.id",
            vec![],
        ),
    };

    let cards = tasks::card_query(conn, clause, rusqlite::params_from_iter(params), now, tz)?;
    let mut plan = Vec::new();
    let mut doing = Vec::new();
    let mut test = Vec::new();
    let mut review = Vec::new();
    let mut done = Vec::new();
    let agent = project.as_ref().is_some_and(|project| project.agent);

    for card in cards {
        match card.status {
            TaskStatus::Plan => plan.push(card),
            TaskStatus::Doing => doing.push(card),
            TaskStatus::Test if agent => test.push(card),
            TaskStatus::Review if agent => review.push(card),
            TaskStatus::Test | TaskStatus::Review => doing.push(card),
            TaskStatus::Done => done.push(card),
        }
    }

    Ok(Board {
        project,
        columns: Columns { plan, doing, test, review, done },
    })
}

pub fn repo_url(conn: &Connection, id: &str) -> Result<String, AppError> {
    let repo_url: Option<String> = conn
        .query_row(
            "SELECT p.repo_url FROM projects p JOIN items i ON i.id = p.item_id WHERE i.id = ?1 AND i.deleted_at IS NULL",
            [id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(AppError::NotFound)?;

    match repo_url {
        Some(url) if !url.trim().is_empty() => Ok(url),
        _ => Err(invalid("Proyek tidak memiliki repositori")),
    }
}

pub fn active_projects(
    conn: &Connection,
    now: i64,
    tz: &TimeZone,
    limit: usize,
) -> Result<Vec<ProjectSummary>, AppError> {
    let overview = projects_overview(conn, now, tz)?;
    Ok(overview
        .projects
        .into_iter()
        .filter(|p| p.status != ProjectStatus::Done)
        .take(limit)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::finance::testing::{jakarta, ms, now};
    use crate::items::{ItemPatch, update};
    use crate::tasks::{NewTask, create_task, update_task};

    #[test]
    fn board_has_test_and_review_columns() {
        let conn = open_in_memory();
        let input: ProjectInput = serde_json::from_value(serde_json::json!({
            "name": "Agen", "kind": "app", "description": "", "agent": true,
            "agentCommand": "claude -p test"
        })).unwrap();
        let project = save_project(&conn, &input, now(), &jakarta()).unwrap();
        for status in ["test", "review", "done"] {
            let task: NewTask = serde_json::from_value(serde_json::json!({
                "title": status, "projectId": project.summary.id, "status": status
            })).unwrap();
            create_task(&conn, &task, now(), &jakarta()).unwrap();
        }
        let board = project_board(&conn, Some(&project.summary.id), now(), &jakarta()).unwrap();
        let json = serde_json::to_value(&board).unwrap();
        assert_eq!(json["project"]["agent"], true);
        assert_eq!(json["project"]["agentCommand"], "claude -p test");
        assert_eq!(json["columns"]["test"][0]["status"], "test");
        assert_eq!(json["columns"]["review"][0]["status"], "review");
        assert_eq!((board.project.as_ref().unwrap().summary.done, board.project.as_ref().unwrap().summary.total), (1, 3));

        // Disabling agent mode keeps all open tasks visible in the ordinary board.
        let input: ProjectInput = serde_json::from_value(serde_json::json!({
            "id": project.summary.id, "name": "Agen", "kind": "app", "description": "", "agent": false
        })).unwrap();
        save_project(&conn, &input, now(), &jakarta()).unwrap();
        let board = project_board(&conn, Some(&project.summary.id), now(), &jakarta()).unwrap();
        let json = serde_json::to_value(&board).unwrap();
        assert_eq!(json["columns"]["test"], serde_json::json!([]));
        assert_eq!(json["columns"]["review"], serde_json::json!([]));
        assert_eq!(board.columns.doing.len(), 2);
        let loose = serde_json::to_value(project_board(&conn, None, now(), &jakarta()).unwrap()).unwrap();
        assert_eq!(loose["columns"]["test"], serde_json::json!([]));
        assert_eq!(loose["columns"]["review"], serde_json::json!([]));
    }

    #[test]
    fn agent_dir_must_be_under_home() {
        let conn = open_in_memory();
        let input: ProjectInput = serde_json::from_value(serde_json::json!({
            "name": "Agen", "kind": "app", "description": "", "agent": true,
            "agentDir": std::path::MAIN_SEPARATOR.to_string()
        })).unwrap();
        assert!(matches!(save_project(&conn, &input, now(), &jakarta()), Err(AppError::Invalid(_))));
        assert!(projects_overview(&conn, now(), &jakarta()).unwrap().projects.is_empty());
    }

    #[test]
    fn agent_fields_round_trip_and_directory_is_canonical() {
        let conn = open_in_memory();
        let dir = tempfile::tempdir_in(".").unwrap();
        let input: ProjectInput = serde_json::from_value(serde_json::json!({
            "name": "Agen", "kind": "app", "description": "", "agent": true,
            "agentCommand": "claude -p test", "agentDir": dir.path().join(".")
        })).unwrap();
        let saved = save_project(&conn, &input, now(), &jakarta()).unwrap();
        let json = serde_json::to_value(&saved).unwrap();
        assert_eq!(json["agentDir"], dir.path().canonicalize().unwrap().to_str().unwrap());
        assert_eq!(json["agent"], true);
        assert_eq!(json["agentCommand"], "claude -p test");

        let update: ProjectInput = serde_json::from_value(serde_json::json!({
            "id": saved.summary.id, "name": "Agen", "kind": "app", "description": "",
            "agent": false, "agentCommand": "", "agentDir": ""
        })).unwrap();
        let saved = save_project(&conn, &update, now() + 1, &jakarta()).unwrap();
        let json = serde_json::to_value(&saved).unwrap();
        assert_eq!(json["agent"], false);
        assert!(json["agentCommand"].is_null());
        assert!(json["agentDir"].is_null());
    }

    #[test]
    fn agent_dir_rejects_files_missing_paths_and_symlinks_outside_home() {
        let conn = open_in_memory();
        let dir = tempfile::tempdir_in(".").unwrap();
        let file = tempfile::NamedTempFile::new_in(dir.path()).unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("/", dir.path().join("escape")).unwrap();
        for path in [file.path().to_path_buf(), dir.path().join("missing"), dir.path().join("escape")] {
            let input: ProjectInput = serde_json::from_value(serde_json::json!({
                "name": "Agen", "kind": "app", "description": "", "agent": true, "agentDir": path
            })).unwrap();
            assert!(matches!(save_project(&conn, &input, now(), &jakarta()), Err(AppError::Invalid(_))));
        }
    }

    #[test]
    fn project_input_is_validated() {
        let conn = open_in_memory();
        let blank = ProjectInput { name: "   ".into(), ..Default::default() };
        assert!(matches!(save_project(&conn, &blank, now(), &jakarta()), Err(AppError::Invalid(_))));

        let bad_urls = [
            "https://gitlab.com/a/b",
            "http://github.com/a/b",
            "https://github.com/a",
        ];
        for url in bad_urls {
            let input = ProjectInput {
                name: "Proyek".into(),
                repo_url: Some(url.into()),
                ..Default::default()
            };
            assert!(matches!(save_project(&conn, &input, now(), &jakarta()), Err(AppError::Invalid(_))));
        }

        let good = ProjectInput {
            name: "Proyek".into(),
            repo_url: Some("https://github.com/syharipf/anchoa".into()),
            ..Default::default()
        };
        let p = save_project(&conn, &good, now(), &jakarta()).unwrap();
        assert_eq!(p.repo_url.as_deref(), Some("https://github.com/syharipf/anchoa"));
    }

    #[test]
    fn progress_counts_top_level_tasks_only() {
        let conn = open_in_memory();
        let p = save_project(
            &conn,
            &ProjectInput { name: "Proyek A".into(), ..Default::default() },
            now(),
            &jakarta(),
        )
        .unwrap();

        let top1 = create_task(
            &conn,
            &NewTask { title: "Top 1".into(), project_id: Some(p.summary.id.clone()), status: TaskStatus::Done, ..Default::default() },
            now(),
            &jakarta(),
        )
        .unwrap();

        let top2 = create_task(
            &conn,
            &NewTask { title: "Top 2".into(), project_id: Some(p.summary.id.clone()), status: TaskStatus::Plan, ..Default::default() },
            now(),
            &jakarta(),
        )
        .unwrap();

        // Subtask under top2 (done) should NOT increment project done or total
        create_task(
            &conn,
            &NewTask { title: "Sub 1".into(), parent_id: Some(top2.id), status: TaskStatus::Done, ..Default::default() },
            now(),
            &jakarta(),
        )
        .unwrap();

        let detail = get_project(&conn, &p.summary.id, now(), &jakarta()).unwrap();
        assert_eq!((detail.summary.done, detail.summary.total), (1, 2));
        assert_eq!(detail.summary.status, ProjectStatus::Active);

        // Mark top2 done -> all top level done -> project status Done
        update_task(
            &conn,
            &top1.id,
            &tasks::TaskPatch { status: Some(TaskStatus::Done), ..Default::default() },
            now(),
            &jakarta(),
        )
        .unwrap();
    }

    #[test]
    fn status_and_deadline_days() {
        let conn = open_in_memory();
        let yesterday = ms("2026-09-28T00:00:00+07:00");
        let today = ms("2026-09-29T00:00:00+07:00");

        // Deadline kemarin, belum selesai -> late, -1
        let p_late = save_project(
            &conn,
            &ProjectInput { name: "Late".into(), deadline_at: Some(yesterday), ..Default::default() },
            now(),
            &jakarta(),
        )
        .unwrap();
        assert_eq!(p_late.summary.status, ProjectStatus::Late);
        assert_eq!(p_late.summary.deadline_days, Some(-1));

        // Deadline hari ini -> active, 0
        let p_today = save_project(
            &conn,
            &ProjectInput { name: "Today".into(), deadline_at: Some(today), ..Default::default() },
            now(),
            &jakarta(),
        )
        .unwrap();
        assert_eq!(p_today.summary.status, ProjectStatus::Active);
        assert_eq!(p_today.summary.deadline_days, Some(0));

        // Semua tugas selesai -> done
        let p_done = save_project(
            &conn,
            &ProjectInput { name: "Done".into(), deadline_at: Some(yesterday), ..Default::default() },
            now(),
            &jakarta(),
        )
        .unwrap();
        create_task(
            &conn,
            &NewTask { title: "T".into(), project_id: Some(p_done.summary.id.clone()), status: TaskStatus::Done, ..Default::default() },
            now(),
            &jakarta(),
        )
        .unwrap();
        let p_done_summary = get_project(&conn, &p_done.summary.id, now(), &jakarta()).unwrap().summary;
        assert_eq!(p_done_summary.status, ProjectStatus::Done);

        // Tanpa tugas dan tanpa deadline -> active
        let p_empty = save_project(
            &conn,
            &ProjectInput { name: "Empty".into(), deadline_at: None, ..Default::default() },
            now(),
            &jakarta(),
        )
        .unwrap();
        assert_eq!(p_empty.summary.status, ProjectStatus::Active);
        assert_eq!(p_empty.summary.deadline_days, None);
    }

    #[test]
    fn overview_orders_projects_and_counts_loose_tasks() {
        let conn = open_in_memory();
        let d1 = ms("2026-10-01T00:00:00+07:00");
        let d2 = ms("2026-10-05T00:00:00+07:00");

        let p_no_dl = save_project(&conn, &ProjectInput { name: "Zeta".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        let p_d2 = save_project(&conn, &ProjectInput { name: "Beta".into(), deadline_at: Some(d2), ..Default::default() }, now(), &jakarta()).unwrap();
        let p_d1 = save_project(&conn, &ProjectInput { name: "Alpha".into(), deadline_at: Some(d1), ..Default::default() }, now(), &jakarta()).unwrap();
        let p_done = save_project(&conn, &ProjectInput { name: "DoneProj".into(), deadline_at: Some(d1), ..Default::default() }, now(), &jakarta()).unwrap();
        create_task(
            &conn,
            &NewTask { title: "Done Task".into(), project_id: Some(p_done.summary.id.clone()), status: TaskStatus::Done, ..Default::default() },
            now(),
            &jakarta(),
        )
        .unwrap();

        // Create loose tasks: 1 done, 2 plan, plus 1 subtask (which should not be counted in loose)
        let _loose1 = create_task(&conn, &NewTask { title: "L1".into(), status: TaskStatus::Done, ..Default::default() }, now(), &jakarta()).unwrap();
        let loose2 = create_task(&conn, &NewTask { title: "L2".into(), status: TaskStatus::Plan, ..Default::default() }, now(), &jakarta()).unwrap();
        let _loose3 = create_task(&conn, &NewTask { title: "L3".into(), status: TaskStatus::Plan, ..Default::default() }, now(), &jakarta()).unwrap();
        let _sub_loose = create_task(&conn, &NewTask { title: "Sub L2".into(), parent_id: Some(loose2.id), status: TaskStatus::Done, ..Default::default() }, now(), &jakarta()).unwrap();

        let ov = projects_overview(&conn, now(), &jakarta()).unwrap();
        assert_eq!(ov.active_count, 3);
        assert_eq!(ov.loose, LooseCount { done: 1, total: 3 });

        let names: Vec<&str> = ov.projects.iter().map(|p| p.name.as_str()).collect();
        // Active/late projects ordered by deadline (d1 then d2, then without deadline), then done projects
        assert_eq!(names, vec![p_d1.summary.name.as_str(), p_d2.summary.name.as_str(), p_no_dl.summary.name.as_str(), p_done.summary.name.as_str()]);
    }

    #[test]
    fn upcoming_is_five_open_dated_tasks_including_late() {
        let conn = open_in_memory();
        let yesterday = ms("2026-09-28T00:00:00+07:00");
        let today = ms("2026-09-29T00:00:00+07:00");
        let d1 = ms("2026-09-30T00:00:00+07:00");
        let d2 = ms("2026-10-01T00:00:00+07:00");
        let d3 = ms("2026-10-02T00:00:00+07:00");
        let d4 = ms("2026-10-03T00:00:00+07:00");

        // 6 open tasks with dates
        let t_late = create_task(&conn, &NewTask { title: "Late".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        update(&conn, &t_late.id, &ItemPatch { due_at: Some(Some(yesterday)), ..Default::default() }, now()).unwrap();

        let t_today = create_task(&conn, &NewTask { title: "Today".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        update(&conn, &t_today.id, &ItemPatch { due_at: Some(Some(today)), ..Default::default() }, now()).unwrap();

        let t1 = create_task(&conn, &NewTask { title: "T1".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        update(&conn, &t1.id, &ItemPatch { due_at: Some(Some(d1)), ..Default::default() }, now()).unwrap();

        let t2 = create_task(&conn, &NewTask { title: "T2".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        update(&conn, &t2.id, &ItemPatch { due_at: Some(Some(d2)), ..Default::default() }, now()).unwrap();

        let t3 = create_task(&conn, &NewTask { title: "T3".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        update(&conn, &t3.id, &ItemPatch { due_at: Some(Some(d3)), ..Default::default() }, now()).unwrap();

        let _t4 = create_task(&conn, &NewTask { title: "T4".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        update(&conn, &_t4.id, &ItemPatch { due_at: Some(Some(d4)), ..Default::default() }, now()).unwrap();

        // 1 done task with date (should not be in upcoming)
        let t_done = create_task(&conn, &NewTask { title: "Done".into(), status: TaskStatus::Done, ..Default::default() }, now(), &jakarta()).unwrap();
        update(&conn, &t_done.id, &ItemPatch { due_at: Some(Some(d1)), ..Default::default() }, now()).unwrap();

        let ov = projects_overview(&conn, now(), &jakarta()).unwrap();
        assert_eq!(ov.upcoming.len(), 5);
        let titles: Vec<&str> = ov.upcoming.iter().map(|t| t.title.as_str()).collect();
        assert_eq!(titles, vec!["Late", "Today", "T1", "T2", "T3"]);
        assert!(ov.upcoming[0].overdue);
    }

    #[test]
    fn board_columns_hold_top_level_tasks_in_due_order() {
        let conn = open_in_memory();
        let d1 = ms("2026-09-30T00:00:00+07:00");
        let d2 = ms("2026-10-01T00:00:00+07:00");

        // Loose tasks board (id: None)
        let _t_nodue = create_task(&conn, &NewTask { title: "No Due".into(), status: TaskStatus::Plan, ..Default::default() }, now(), &jakarta()).unwrap();
        let t_d2 = create_task(&conn, &NewTask { title: "Due 2".into(), status: TaskStatus::Plan, ..Default::default() }, now(), &jakarta()).unwrap();
        update(&conn, &t_d2.id, &ItemPatch { due_at: Some(Some(d2)), ..Default::default() }, now()).unwrap();
        let t_d1 = create_task(&conn, &NewTask { title: "Due 1".into(), status: TaskStatus::Plan, ..Default::default() }, now(), &jakarta()).unwrap();
        update(&conn, &t_d1.id, &ItemPatch { due_at: Some(Some(d1)), ..Default::default() }, now()).unwrap();

        let board_loose = project_board(&conn, None, now(), &jakarta()).unwrap();
        assert!(board_loose.project.is_none());
        assert_eq!(board_loose.columns.plan.len(), 3);
        let plan_titles: Vec<&str> = board_loose.columns.plan.iter().map(|t| t.title.as_str()).collect();
        // due1, due2, then no due at the end
        assert_eq!(plan_titles, vec!["Due 1", "Due 2", "No Due"]);

        // Project board
        let p = save_project(&conn, &ProjectInput { name: "Proyek Board".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        let pt_doing = create_task(&conn, &NewTask { title: "Doing".into(), project_id: Some(p.summary.id.clone()), status: TaskStatus::Doing, ..Default::default() }, now(), &jakarta()).unwrap();
        let pt_done = create_task(&conn, &NewTask { title: "Done".into(), project_id: Some(p.summary.id.clone()), status: TaskStatus::Done, ..Default::default() }, now(), &jakarta()).unwrap();

        let board_proj = project_board(&conn, Some(&p.summary.id), now(), &jakarta()).unwrap();
        assert_eq!(board_proj.project.as_ref().map(|p| p.summary.name.as_str()), Some("Proyek Board"));
        assert_eq!(board_proj.columns.doing.len(), 1);
        assert_eq!(board_proj.columns.doing[0].id, pt_doing.id);
        assert_eq!(board_proj.columns.done.len(), 1);
        assert_eq!(board_proj.columns.done[0].id, pt_done.id);
    }

    #[test]
    fn deleting_a_project_frees_its_tasks() {
        let conn = open_in_memory();
        let p = save_project(&conn, &ProjectInput { name: "Proyek".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        let t = create_task(&conn, &NewTask { title: "T".into(), project_id: Some(p.summary.id.clone()), ..Default::default() }, now(), &jakarta()).unwrap();

        delete_project(&conn, &p.summary.id, now()).unwrap();

        let card = tasks::card_query(&conn, "i.id = ?1", [&t.id], now(), &jakarta()).unwrap().remove(0);
        assert_eq!(card.project_id, None);
        assert_eq!(card.project_name, None);

        assert!(matches!(get_project(&conn, &p.summary.id, now(), &jakarta()), Err(AppError::NotFound)));
    }

    #[test]
    fn repo_url_requires_a_repo() {
        let conn = open_in_memory();
        let p1 = save_project(&conn, &ProjectInput { name: "No Repo".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        assert!(matches!(repo_url(&conn, &p1.summary.id), Err(AppError::Invalid(_))));

        let p2 = save_project(
            &conn,
            &ProjectInput {
                name: "With Repo".into(),
                repo_url: Some("https://github.com/syharipf/anchoa".into()),
                ..Default::default()
            },
            now(),
            &jakarta(),
        )
        .unwrap();
        assert_eq!(repo_url(&conn, &p2.summary.id).unwrap(), "https://github.com/syharipf/anchoa");
    }

    #[test]
    fn active_projects_limits_and_filters_done() {
        let conn = open_in_memory();
        let p1 = save_project(&conn, &ProjectInput { name: "P1".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        let p2 = save_project(&conn, &ProjectInput { name: "P2".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        let p3 = save_project(&conn, &ProjectInput { name: "P3".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        let p_done = save_project(&conn, &ProjectInput { name: "P Done".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        create_task(
            &conn,
            &NewTask { title: "D".into(), project_id: Some(p_done.summary.id.clone()), status: TaskStatus::Done, ..Default::default() },
            now(),
            &jakarta(),
        )
        .unwrap();

        let top2 = active_projects(&conn, now(), &jakarta(), 2).unwrap();
        assert_eq!(top2.len(), 2);
        assert_eq!(top2[0].id, p1.summary.id);
        assert_eq!(top2[1].id, p2.summary.id);
        assert!(!top2.iter().any(|p| p.id == p_done.summary.id || p.id == p3.summary.id));
    }

    #[test]
    fn deleted_tasks_leave_progress_boards_loose_counts_and_upcoming() {
        let conn = open_in_memory();
        let project = save_project(&conn, &ProjectInput { name: "Anchoa".into(), ..Default::default() }, now(), &jakarta()).unwrap();
        let live = create_task(&conn, &NewTask { title: "Ada".into(), project_id: Some(project.summary.id.clone()), ..Default::default() }, now(), &jakarta()).unwrap();
        for (project_id, status) in [(Some(project.summary.id.clone()), TaskStatus::Done), (Some(project.summary.id.clone()), TaskStatus::Plan), (None, TaskStatus::Done), (None, TaskStatus::Plan)] {
            let gone = create_task(&conn, &NewTask { title: "Dihapus".into(), project_id, status, ..Default::default() }, now(), &jakarta()).unwrap();
            crate::items::update(&conn, &gone.id, &crate::items::ItemPatch { due_at: Some(Some(now())), ..Default::default() }, now()).unwrap();
            crate::tasks::delete_task(&conn, &gone.id, now()).unwrap();
        }
        let overview = projects_overview(&conn, now(), &jakarta()).unwrap();
        assert_eq!((overview.projects[0].done, overview.projects[0].total, overview.active_count), (0, 1, 1));
        assert_eq!((overview.loose.done, overview.loose.total), (0, 0));
        assert!(overview.upcoming.is_empty());
        let board = project_board(&conn, Some(&project.summary.id), now(), &jakarta()).unwrap();
        assert_eq!(board.columns.plan, [live]);
        assert!(board.columns.done.is_empty());
        let loose = project_board(&conn, None, now(), &jakarta()).unwrap();
        assert!(loose.columns.plan.is_empty() && loose.columns.done.is_empty());
    }

    #[test]
    fn deleted_projects_leave_overview_active_list_board_and_repo_lookup() {
        let conn = open_in_memory();
        let project = save_project(&conn, &ProjectInput { name: "Anchoa".into(), repo_url: Some("https://github.com/user/repo".into()), ..Default::default() }, now(), &jakarta()).unwrap();
        let id = project.summary.id;
        delete_project(&conn, &id, now()).unwrap();
        assert!(projects_overview(&conn, now(), &jakarta()).unwrap().projects.is_empty());
        assert!(active_projects(&conn, now(), &jakarta(), 2).unwrap().is_empty());
        assert!(matches!(get_project(&conn, &id, now(), &jakarta()), Err(AppError::NotFound)));
        assert!(matches!(project_board(&conn, Some(&id), now(), &jakarta()), Err(AppError::NotFound)));
        assert!(matches!(repo_url(&conn, &id), Err(AppError::NotFound)));
        let edit = ProjectInput { id: Some(id), name: "Ubah".into(), ..Default::default() };
        assert!(matches!(save_project(&conn, &edit, now(), &jakarta()), Err(AppError::NotFound)));
    }
}
