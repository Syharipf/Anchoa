//! Combined schedule of tasks, bills, and project deadlines for a date range (spec Fase 3B §3).
use jiff::civil::Date;
use jiff::tz::TimeZone;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::bills::{self, BillStatus, Repeat};
use crate::error::AppError;
use crate::tasks::TaskStatus;
use crate::time::{self, local_date};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRange {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemSource {
    Task,
    Bill,
    /// Pulled from Google Calendar; read-only, never editable here.
    Calendar,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Project,
    Bill,
    Personal,
    /// Google Calendar events. Own kind so they can be filtered on their own.
    Calendar,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleItem {
    pub key: String,
    pub source: ItemSource,
    pub id: String,
    pub kind: ItemKind,
    pub title: String,
    pub group_id: String,
    pub group_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    pub due_date: String,
    pub status: TaskStatus,
    pub overdue: bool,
    pub checkable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeadline {
    pub project_id: String,
    pub name: String,
    pub date: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub today: String,
    pub items: Vec<ScheduleItem>,
    pub deadlines: Vec<ProjectDeadline>,
}

fn parse_date(s: &str) -> Result<Date, AppError> {
    let invalid = || AppError::Invalid(format!("Tanggal tidak valid: {s}"));
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 3 {
        return Err(invalid());
    }
    if parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return Err(invalid());
    }
    let y: i16 = parts[0].parse().map_err(|_| invalid())?;
    let m: i8 = parts[1].parse().map_err(|_| invalid())?;
    let d: i8 = parts[2].parse().map_err(|_| invalid())?;
    Date::new(y, m, d).map_err(|_| invalid())
}

fn validate_range(range: &ScheduleRange) -> Result<(Date, Date), AppError> {
    let from_date = parse_date(&range.from)?;
    let to_date = parse_date(&range.to)?;
    if from_date > to_date {
        return Err(AppError::Invalid(
            "Tanggal awal harus sebelum atau sama dengan tanggal akhir".into(),
        ));
    }
    let days = from_date
        .until(to_date)
        .map_err(|e| AppError::Invalid(e.to_string()))?
        .get_days();
    if days > 93 {
        return Err(AppError::Invalid(format!(
            "Rentang terlalu panjang: {days} hari (maksimal 93 hari)"
        )));
    }
    Ok((from_date, to_date))
}

/// Day boundaries in epoch ms, for cache queries that compare timestamps
/// rather than the local date strings the schedule renders.
pub fn range_bounds(range: &ScheduleRange, tz: &TimeZone) -> Result<(i64, i64), AppError> {
    let (from, to) = validate_range(range)?;
    let (from_ms, _) = time::date_bounds(from, tz)?;
    let (_, to_ms) = time::date_bounds(to, tz)?;
    Ok((from_ms, to_ms))
}

struct TaskRow {
    id: String,
    title: String,
    status: TaskStatus,
    due_at: i64,
    start_at: Option<i64>,
    project_id: Option<String>,
    project_name: Option<String>,
}

const TASK_SELECT: &str = "
    SELECT i.id, i.title, t.status, i.due_at, t.start_at, t.project_id,
           (SELECT pi.title FROM items pi WHERE pi.id = t.project_id AND pi.deleted_at IS NULL) AS project_name
    FROM tasks t
    JOIN items i ON i.id = t.item_id
    WHERE i.deleted_at IS NULL AND i.due_at IS NOT NULL";

pub fn schedule(
    conn: &Connection,
    range: &ScheduleRange,
    now: i64,
    tz: &TimeZone,
) -> Result<Schedule, AppError> {
    validate_range(range)?;
    let today = local_date(now, tz)?.strftime("%Y-%m-%d").to_string();

    let mut stmt = conn.prepare(TASK_SELECT)?;
    let task_rows = stmt.query_map([], |r| {
        Ok(TaskRow {
            id: r.get(0)?,
            title: r.get(1)?,
            status: r.get(2)?,
            due_at: r.get(3)?,
            start_at: r.get(4)?,
            project_id: r.get(5)?,
            project_name: r.get(6)?,
        })
    })?;

    let mut items = Vec::new();

    for row in task_rows {
        let task = row?;
        let due_date = local_date(task.due_at, tz)?.strftime("%Y-%m-%d").to_string();
        let start_date = match task.start_at {
            Some(ms) => Some(local_date(ms, tz)?.strftime("%Y-%m-%d").to_string()),
            None => None,
        };

        let overdue = task.status != TaskStatus::Done && due_date < today;

        let span_start = start_date.as_deref().unwrap_or(&due_date);
        let (s_start, s_end) = if span_start <= due_date.as_str() {
            (span_start, due_date.as_str())
        } else {
            (due_date.as_str(), span_start)
        };

        let overlaps = s_start <= range.to.as_str() && s_end >= range.from.as_str();
        let late_before_from = overdue && due_date < range.from;

        if overlaps || late_before_from {
            let (kind, group_id, group_name) = match (task.project_id, task.project_name) {
                (Some(pid), Some(pname)) => (ItemKind::Project, pid, pname),
                _ => (ItemKind::Personal, "personal".to_string(), "Pribadi".to_string()),
            };

            items.push(ScheduleItem {
                key: format!("task:{}", task.id),
                source: ItemSource::Task,
                id: task.id,
                kind,
                title: task.title,
                group_id,
                group_name,
                start_date,
                due_date,
                status: task.status,
                overdue,
                checkable: true,
            });
        }
    }

    let live_bills = bills::list_bills(conn, now, tz)?;
    for bill in live_bills {
        let stored_date = local_date(bill.due_at, tz)?.strftime("%Y-%m-%d").to_string();
        let is_overdue = bill.status == BillStatus::Overdue;
        let in_range = stored_date >= range.from && stored_date <= range.to;

        if in_range || is_overdue {
            let status = if bill.status == BillStatus::PaidToday {
                TaskStatus::Done
            } else {
                TaskStatus::Plan
            };

            items.push(ScheduleItem {
                key: format!("bill:{}:{}", bill.id, stored_date),
                source: ItemSource::Bill,
                id: bill.id.clone(),
                kind: ItemKind::Bill,
                title: bill.name.clone(),
                group_id: "bills".to_string(),
                group_name: "Tagihan".to_string(),
                start_date: None,
                due_date: stored_date,
                status,
                overdue: is_overdue,
                checkable: true,
            });
        }

        if bill.repeat == Repeat::Monthly {
            let due_day: i8 = conn.query_row(
                "SELECT due_day FROM bills WHERE item_id = ?1",
                [&bill.id],
                |r| r.get(0),
            )?;
            let mut cur_ms = bill.due_at;
            for _ in 0..12 {
                cur_ms = time::next_month_due(cur_ms, due_day, tz)?;
                let proj_date = local_date(cur_ms, tz)?.strftime("%Y-%m-%d").to_string();
                if proj_date > range.to {
                    break;
                }
                if proj_date >= range.from {
                    items.push(ScheduleItem {
                        key: format!("bill:{}:{}", bill.id, proj_date),
                        source: ItemSource::Bill,
                        id: bill.id.clone(),
                        kind: ItemKind::Bill,
                        title: bill.name.clone(),
                        group_id: "bills".to_string(),
                        group_name: "Tagihan".to_string(),
                        start_date: None,
                        due_date: proj_date,
                        status: TaskStatus::Plan,
                        overdue: false,
                        checkable: false,
                    });
                }
            }
        }
    }

    let mut p_stmt = conn.prepare(
        "SELECT i.id, i.title, p.deadline_at
         FROM projects p
         JOIN items i ON i.id = p.item_id
         WHERE i.deleted_at IS NULL AND p.deadline_at IS NOT NULL",
    )?;
    let p_rows = p_stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?))
    })?;

    let mut deadlines = Vec::new();
    for row in p_rows {
        let (project_id, name, deadline_ms) = row?;
        let date = local_date(deadline_ms, tz)?.strftime("%Y-%m-%d").to_string();
        if date >= range.from && date <= range.to {
            deadlines.push(ProjectDeadline { project_id, name, date });
        }
    }
    deadlines.sort_by(|a, b| {
        a.date
            .cmp(&b.date)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.project_id.cmp(&b.project_id))
    });

    // Google Calendar events, read-only: cached locally, never written back.
    // Locally created tasks above stay authoritative.
    items.extend(crate::calendar::items(conn, range, tz)?);

    items.sort_by(|a, b| {
        a.due_date
            .cmp(&b.due_date)
            .then_with(|| a.kind.cmp(&b.kind))
            .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
            .then_with(|| a.key.cmp(&b.key))
    });

    Ok(Schedule {
        today,
        items,
        deadlines,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bills::{self, BillInput};
    use crate::db::open_in_memory;
    use crate::finance::testing::{account, jakarta, ms, now};
    use crate::items::{self, ItemPatch};
    use crate::projects::{self, ProjectInput};
    use crate::tasks::{self, NewTask, TaskPatch};

    #[test]
    fn tasks_get_kind_group_and_dates() {
        let conn = open_in_memory();
        let tz = jakarta();
        let now_time = now();

        let proj = projects::save_project(
            &conn,
            &ProjectInput {
                name: "Anchoa Project".into(),
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();

        let t1 = tasks::create_task(
            &conn,
            &NewTask {
                title: "Task in project".into(),
                project_id: Some(proj.summary.id.clone()),
                status: TaskStatus::Plan,
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();

        tasks::update_task(
            &conn,
            &t1.id,
            &TaskPatch {
                start_at: Some(Some(ms("2026-09-28T09:00:00+07:00"))),
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();
        items::update(
            &conn,
            &t1.id,
            &ItemPatch {
                due_at: Some(Some(ms("2026-09-29T18:00:00+07:00"))),
                ..Default::default()
            },
            now_time,
        )
        .unwrap();

        let t2 = tasks::create_task(
            &conn,
            &NewTask {
                title: "Loose task".into(),
                project_id: None,
                status: TaskStatus::Plan,
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();

        items::update(
            &conn,
            &t2.id,
            &ItemPatch {
                due_at: Some(Some(ms("2026-09-30T10:00:00+07:00"))),
                ..Default::default()
            },
            now_time,
        )
        .unwrap();

        let sched = schedule(
            &conn,
            &ScheduleRange {
                from: "2026-09-28".into(),
                to: "2026-09-30".into(),
            },
            now_time,
            &tz,
        )
        .unwrap();

        assert_eq!(sched.items.len(), 2);

        let item1 = &sched.items[0];
        assert_eq!(item1.id, t1.id);
        assert_eq!(item1.source, ItemSource::Task);
        assert_eq!(item1.kind, ItemKind::Project);
        assert_eq!(item1.group_id, proj.summary.id);
        assert_eq!(item1.group_name, "Anchoa Project");
        assert_eq!(item1.start_date, Some("2026-09-28".into()));
        assert_eq!(item1.due_date, "2026-09-29");
        assert_eq!(item1.key, format!("task:{}", t1.id));
        assert!(item1.checkable);

        let item2 = &sched.items[1];
        assert_eq!(item2.id, t2.id);
        assert_eq!(item2.source, ItemSource::Task);
        assert_eq!(item2.kind, ItemKind::Personal);
        assert_eq!(item2.group_id, "personal");
        assert_eq!(item2.group_name, "Pribadi");
        assert_eq!(item2.start_date, None);
        assert_eq!(item2.due_date, "2026-09-30");
        assert_eq!(item2.key, format!("task:{}", t2.id));
        assert!(item2.checkable);
    }

    #[test]
    fn range_keeps_overlapping_and_late_items() {
        let conn = open_in_memory();
        let tz = jakarta();
        let now_time = now();

        // 1. Finished task before range (2026-09-20, done) -> outside range, not late -> NOT included
        let t_past_done = tasks::create_task(
            &conn,
            &NewTask {
                title: "Past done".into(),
                status: TaskStatus::Done,
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();
        items::update(
            &conn,
            &t_past_done.id,
            &ItemPatch {
                due_at: Some(Some(ms("2026-09-20T10:00:00+07:00"))),
                ..Default::default()
            },
            now_time,
        )
        .unwrap();

        // 2. Future task beyond range (2026-10-20, plan) -> outside range -> NOT included
        let t_future = tasks::create_task(
            &conn,
            &NewTask {
                title: "Future task".into(),
                status: TaskStatus::Plan,
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();
        items::update(
            &conn,
            &t_future.id,
            &ItemPatch {
                due_at: Some(Some(ms("2026-10-20T10:00:00+07:00"))),
                ..Default::default()
            },
            now_time,
        )
        .unwrap();

        // 3. Late task before range (due 2026-09-25, plan, today 2026-09-29) -> late before from -> INCLUDED
        let t_late = tasks::create_task(
            &conn,
            &NewTask {
                title: "Late task".into(),
                status: TaskStatus::Plan,
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();
        items::update(
            &conn,
            &t_late.id,
            &ItemPatch {
                due_at: Some(Some(ms("2026-09-25T10:00:00+07:00"))),
                ..Default::default()
            },
            now_time,
        )
        .unwrap();

        // 4. Done task inside range (due 2026-10-03, done) -> INCLUDED with status: Done, overdue: false
        let t_done_in_range = tasks::create_task(
            &conn,
            &NewTask {
                title: "Done task in range".into(),
                status: TaskStatus::Done,
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();
        items::update(
            &conn,
            &t_done_in_range.id,
            &ItemPatch {
                due_at: Some(Some(ms("2026-10-03T10:00:00+07:00"))),
                ..Default::default()
            },
            now_time,
        )
        .unwrap();

        // 5. Spanning task overlapping range (start 2026-09-28, due 2026-10-02) -> INCLUDED
        let t_span = tasks::create_task(
            &conn,
            &NewTask {
                title: "Spanning task".into(),
                status: TaskStatus::Doing,
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();
        tasks::update_task(
            &conn,
            &t_span.id,
            &TaskPatch {
                start_at: Some(Some(ms("2026-09-28T09:00:00+07:00"))),
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();
        items::update(
            &conn,
            &t_span.id,
            &ItemPatch {
                due_at: Some(Some(ms("2026-10-02T18:00:00+07:00"))),
                ..Default::default()
            },
            now_time,
        )
        .unwrap();

        let sched = schedule(
            &conn,
            &ScheduleRange {
                from: "2026-10-01".into(),
                to: "2026-10-07".into(),
            },
            now_time,
            &tz,
        )
        .unwrap();

        let ids: Vec<&str> = sched.items.iter().map(|it| it.id.as_str()).collect();
        assert!(!ids.contains(&t_past_done.id.as_str()));
        assert!(!ids.contains(&t_future.id.as_str()));
        assert!(ids.contains(&t_late.id.as_str()));
        assert!(ids.contains(&t_done_in_range.id.as_str()));
        assert!(ids.contains(&t_span.id.as_str()));

        let late_item = sched.items.iter().find(|it| it.id == t_late.id).unwrap();
        assert!(late_item.overdue);
        assert_eq!(late_item.due_date, "2026-09-25");

        let done_item = sched.items.iter().find(|it| it.id == t_done_in_range.id).unwrap();
        assert_eq!(done_item.status, TaskStatus::Done);
        assert!(!done_item.overdue);
    }

    #[test]
    fn monthly_bills_are_projected() {
        let conn = open_in_memory();
        let tz = jakarta();
        let now_time = now();
        let bca = account(&conn, "BCA", 10_000_000);

        let b_monthly = bills::save_bill(
            &conn,
            &BillInput {
                name: "Internet".into(),
                amount: 300_000,
                account_id: bca.clone(),
                repeat: Repeat::Monthly,
                due_at: ms("2027-01-31T00:00:00+07:00"),
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();

        let b_once = bills::save_bill(
            &conn,
            &BillInput {
                name: "Servis".into(),
                amount: 150_000,
                account_id: bca,
                repeat: Repeat::Once,
                due_at: ms("2027-01-15T00:00:00+07:00"),
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();

        let sched = schedule(
            &conn,
            &ScheduleRange {
                from: "2027-01-01".into(),
                to: "2027-03-31".into(),
            },
            now_time,
            &tz,
        )
        .unwrap();

        let monthly_items: Vec<&ScheduleItem> =
            sched.items.iter().filter(|it| it.id == b_monthly.id).collect();
        assert_eq!(monthly_items.len(), 3);

        assert_eq!(monthly_items[0].due_date, "2027-01-31");
        assert!(monthly_items[0].checkable);
        assert_eq!(monthly_items[0].key, format!("bill:{}:2027-01-31", b_monthly.id));

        assert_eq!(monthly_items[1].due_date, "2027-02-28");
        assert!(!monthly_items[1].checkable);
        assert_eq!(monthly_items[1].key, format!("bill:{}:2027-02-28", b_monthly.id));

        assert_eq!(monthly_items[2].due_date, "2027-03-31");
        assert!(!monthly_items[2].checkable);
        assert_eq!(monthly_items[2].key, format!("bill:{}:2027-03-31", b_monthly.id));

        let once_items: Vec<&ScheduleItem> =
            sched.items.iter().filter(|it| it.id == b_once.id).collect();
        assert_eq!(once_items.len(), 1);
        assert_eq!(once_items[0].due_date, "2027-01-15");
        assert!(once_items[0].checkable);
    }

    #[test]
    fn paid_today_bill_is_done() {
        let conn = open_in_memory();
        let tz = jakarta();
        let now_time = now();
        let bca = account(&conn, "BCA", 1_000_000);

        let b_once = bills::save_bill(
            &conn,
            &BillInput {
                name: "Pulsa".into(),
                amount: 50_000,
                account_id: bca,
                repeat: Repeat::Once,
                due_at: ms("2026-09-29T00:00:00+07:00"),
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();

        bills::pay_bill(&conn, &b_once.id, now_time, &tz).unwrap();

        let sched = schedule(
            &conn,
            &ScheduleRange {
                from: "2026-09-01".into(),
                to: "2026-09-30".into(),
            },
            now_time,
            &tz,
        )
        .unwrap();

        let item = sched.items.iter().find(|it| it.id == b_once.id).unwrap();
        assert_eq!(item.status, TaskStatus::Done);
        assert_eq!(item.due_date, "2026-09-29");
    }

    #[test]
    fn project_deadlines_in_range() {
        let conn = open_in_memory();
        let tz = jakarta();
        let now_time = now();

        let p1 = projects::save_project(
            &conn,
            &ProjectInput {
                name: "Project in range".into(),
                deadline_at: Some(ms("2026-10-05T00:00:00+07:00")),
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();

        let _p2 = projects::save_project(
            &conn,
            &ProjectInput {
                name: "Project outside range".into(),
                deadline_at: Some(ms("2026-10-25T00:00:00+07:00")),
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();

        let _p3 = projects::save_project(
            &conn,
            &ProjectInput {
                name: "Project without deadline".into(),
                deadline_at: None,
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();

        let sched = schedule(
            &conn,
            &ScheduleRange {
                from: "2026-10-01".into(),
                to: "2026-10-10".into(),
            },
            now_time,
            &tz,
        )
        .unwrap();

        assert_eq!(sched.deadlines.len(), 1);
        assert_eq!(sched.deadlines[0].project_id, p1.summary.id);
        assert_eq!(sched.deadlines[0].name, "Project in range");
        assert_eq!(sched.deadlines[0].date, "2026-10-05");
    }

    #[test]
    fn deleted_items_are_left_out() {
        let conn = open_in_memory();
        let tz = jakarta();
        let now_time = now();
        let bca = account(&conn, "BCA", 1_000_000);

        let t = tasks::create_task(
            &conn,
            &NewTask {
                title: "Deleted task".into(),
                status: TaskStatus::Plan,
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();
        items::update(
            &conn,
            &t.id,
            &ItemPatch {
                due_at: Some(Some(ms("2026-10-05T00:00:00+07:00"))),
                ..Default::default()
            },
            now_time,
        )
        .unwrap();
        tasks::delete_task(&conn, &t.id, now_time).unwrap();

        let p = projects::save_project(
            &conn,
            &ProjectInput {
                name: "Deleted project".into(),
                deadline_at: Some(ms("2026-10-05T00:00:00+07:00")),
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();
        projects::delete_project(&conn, &p.summary.id, now_time).unwrap();

        let b = bills::save_bill(
            &conn,
            &BillInput {
                name: "Deleted bill".into(),
                amount: 50_000,
                account_id: bca,
                repeat: Repeat::Once,
                due_at: ms("2026-10-05T00:00:00+07:00"),
                ..Default::default()
            },
            now_time,
            &tz,
        )
        .unwrap();
        bills::delete_bill(&conn, &b.id, now_time, &tz).unwrap();

        let sched = schedule(
            &conn,
            &ScheduleRange {
                from: "2026-10-01".into(),
                to: "2026-10-10".into(),
            },
            now_time,
            &tz,
        )
        .unwrap();

        assert!(sched.items.is_empty());
        assert!(sched.deadlines.is_empty());
    }

    #[test]
    fn range_is_validated() {
        let conn = open_in_memory();
        let tz = jakarta();
        let now_time = now();

        // from > to
        let err_order = schedule(
            &conn,
            &ScheduleRange {
                from: "2026-10-10".into(),
                to: "2026-10-01".into(),
            },
            now_time,
            &tz,
        );
        assert!(matches!(err_order, Err(AppError::Invalid(_))));

        // range > 93 days (104 days)
        let err_long = schedule(
            &conn,
            &ScheduleRange {
                from: "2026-01-01".into(),
                to: "2026-04-15".into(),
            },
            now_time,
            &tz,
        );
        assert!(matches!(err_long, Err(AppError::Invalid(_))));

        // "2026-9-1" rejected
        let err_bad_format = schedule(
            &conn,
            &ScheduleRange {
                from: "2026-9-1".into(),
                to: "2026-09-30".into(),
            },
            now_time,
            &tz,
        );
        assert!(matches!(err_bad_format, Err(AppError::Invalid(_))));

        let err_bad_format2 = schedule(
            &conn,
            &ScheduleRange {
                from: "2026-09-01".into(),
                to: "2026-9-1".into(),
            },
            now_time,
            &tz,
        );
        assert!(matches!(err_bad_format2, Err(AppError::Invalid(_))));

        // Exactly 93 days is allowed
        let ok_93 = schedule(
            &conn,
            &ScheduleRange {
                from: "2026-01-01".into(),
                to: "2026-04-04".into(),
            },
            now_time,
            &tz,
        );
        assert!(ok_93.is_ok());

        // 94 days is rejected
        let err_94 = schedule(
            &conn,
            &ScheduleRange {
                from: "2026-01-01".into(),
                to: "2026-04-05".into(),
            },
            now_time,
            &tz,
        );
        assert!(matches!(err_94, Err(AppError::Invalid(_))));
    }

    #[test]
    fn wire_names_match_the_frontend() {
        let range: ScheduleRange = serde_json::from_str(r#"{"from":"2026-09-01","to":"2026-09-30"}"#).unwrap();
        assert_eq!(range.from, "2026-09-01");
        assert_eq!(range.to, "2026-09-30");

        let item = ScheduleItem {
            key: "task:1".into(),
            source: ItemSource::Task,
            id: "1".into(),
            kind: ItemKind::Project,
            title: "Task".into(),
            group_id: "p1".into(),
            group_name: "Project 1".into(),
            start_date: Some("2026-09-28".into()),
            due_date: "2026-09-29".into(),
            status: TaskStatus::Plan,
            overdue: false,
            checkable: true,
        };
        let val = serde_json::to_value(&item).unwrap();
        assert_eq!(val["groupId"], "p1");
        assert_eq!(val["groupName"], "Project 1");
        assert_eq!(val["startDate"], "2026-09-28");
        assert_eq!(val["dueDate"], "2026-09-29");
        assert_eq!(val["source"], "task");
        assert_eq!(val["kind"], "project");
        assert_eq!(val["status"], "plan");

        let item_no_start = ScheduleItem {
            start_date: None,
            ..item
        };
        let val_no_start = serde_json::to_value(&item_no_start).unwrap();
        assert!(val_no_start.get("startDate").is_none());

        let dl = ProjectDeadline {
            project_id: "p1".into(),
            name: "Project 1".into(),
            date: "2026-10-01".into(),
        };
        let dl_val = serde_json::to_value(&dl).unwrap();
        assert_eq!(dl_val["projectId"], "p1");
    }
}

