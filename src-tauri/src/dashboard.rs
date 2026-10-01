use jiff::{Timestamp, ToSpan, tz::TimeZone};
use rusqlite::{Connection, params};
use serde::Serialize;

use crate::bills::{self, BillStatus, BillView};
use crate::downloader::LiveProgress;
use crate::downloads::{self, DownloadStatus};
use crate::error::AppError;
use crate::finance;
use crate::habits::{self, HabitReminder};
use crate::items::{ItemSummary, summaries};
use crate::overview::{self, BudgetView};
use crate::projects::{self, ProjectSummary};
use crate::time::{day_bounds, month_of};

pub const RECENT_LIMIT: usize = 8;

/// A row of the "Hari ini" list.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayTask {
    pub id: String,
    pub title: String,
    pub due_at: i64,
    pub completed_at: Option<i64>,
    /// Due before today (whether or not it is done now).
    pub overdue: bool,
}

pub const UPCOMING_DAYS: i64 = 7;

/// One column of the "7 hari ke depan" card.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingDay {
    /// Local date, e.g. `2026-10-01`.
    pub date: String,
    pub tasks: Vec<DayTask>,
}

/// An active download row on the dashboard card.
#[derive(Debug, PartialEq, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSummaryRow {
    pub id: String,
    pub title: String,
    pub progress: u32,
    pub done_bytes: i64,
    pub total_bytes: Option<i64>,
    pub speed: Option<f64>,
    pub eta: Option<u64>,
    pub status: DownloadStatus,
}

/// The Unduhan card summary on the dashboard (spec Fase 7 §5).
#[derive(Debug, PartialEq, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadsSummary {
    pub speed: f64,
    pub items: Vec<DownloadSummaryRow>,
}

/// Data for the dashboard, the palette and the notification bell.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub today: Vec<DayTask>,
    pub upcoming: Vec<UpcomingDay>,
    pub recent: Vec<ItemSummary>,
    pub inbox_count: i64,
    pub finance: FinanceSummary,
    pub projects: Vec<ProjectSummary>,
    pub habit_reminders: Vec<HabitReminder>,
    pub downloads: DownloadsSummary,
}

/// The Keuangan card, the bell and the notification panel (spec Fase 2 §5).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceSummary {
    pub has_accounts: bool,
    pub balance: i64,
    /// Spent this local month.
    pub expense: i64,
    pub budget: Option<BudgetView>,
    /// Overdue or due today.
    pub due_bills: Vec<BillView>,
}

fn finance_summary(conn: &Connection, now: i64, tz: &TimeZone) -> Result<FinanceSummary, AppError> {
    let accounts = finance::list_accounts(conn, now, tz)?;
    let expense = overview::month_flow(conn, &month_of(now, tz)?, tz)?.expense;
    let due_bills =
        bills::list_bills(conn, now, tz)?.into_iter().filter(|b| matches!(b.status, BillStatus::Overdue | BillStatus::DueToday)).collect();
    Ok(FinanceSummary {
        has_accounts: !accounts.is_empty(),
        balance: accounts.iter().map(|a| a.balance).sum(),
        expense,
        budget: overview::budget_view(conn, expense)?,
        due_bills,
    })
}

/// Due today (done or not), overdue and still open, or finished today.
/// Ordered by due date only, so a row does not jump when it is ticked.
fn today_tasks(conn: &Connection, start: i64, end: i64) -> Result<Vec<DayTask>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, due_at, completed_at FROM items
         WHERE deleted_at IS NULL AND type = 'task' AND due_at IS NOT NULL AND (
               (due_at >= ?1 AND due_at < ?2)
            OR (due_at < ?1 AND completed_at IS NULL)
            OR (completed_at >= ?1 AND completed_at < ?2))
         ORDER BY due_at, title, id",
    )?;
    let rows = stmt.query_map(params![start, end], |r| {
        let due_at: i64 = r.get(2)?;
        Ok(DayTask { id: r.get(0)?, title: r.get(1)?, due_at, completed_at: r.get(3)?, overdue: due_at < start })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Open tasks due on each of the next seven local days, starting tomorrow.
fn upcoming(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Vec<UpcomingDay>, AppError> {
    let today = Timestamp::from_millisecond(now)?.to_zoned(tz.clone()).date();
    let mut stmt = conn.prepare(
        "SELECT id, title, due_at FROM items
         WHERE deleted_at IS NULL AND type = 'task' AND completed_at IS NULL AND due_at >= ?1 AND due_at < ?2
         ORDER BY due_at, title, id",
    )?;
    let mut days = Vec::new();
    for offset in 1..=UPCOMING_DAYS {
        let date = today.checked_add(offset.days())?;
        let start = date.to_zoned(tz.clone())?.timestamp().as_millisecond();
        let end = date.tomorrow()?.to_zoned(tz.clone())?.timestamp().as_millisecond();
        let tasks = stmt
            .query_map(params![start, end], |r| {
                Ok(DayTask { id: r.get(0)?, title: r.get(1)?, due_at: r.get(2)?, completed_at: None, overdue: false })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        days.push(UpcomingDay { date: date.to_string(), tasks });
    }
    Ok(days)
}

pub fn downloads_summary(
    conn: &Connection,
    live: &std::collections::HashMap<String, LiveProgress>,
) -> Result<DownloadsSummary, AppError> {
    let rows = downloads::list(conn)?;
    let mut active_items: Vec<DownloadSummaryRow> = Vec::new();

    for mut row in rows {
        if !matches!(
            row.status,
            DownloadStatus::Running | DownloadStatus::Processing | DownloadStatus::Queued
        ) {
            continue;
        }

        let l = live.get(&row.id);
        if let Some(l) = l.filter(|l| l.done > 0) {
            row.done_bytes = l.done as i64;
            row.total_bytes = l.total.map(|t| t as i64).or(row.total_bytes);
        }

        let progress = match row.total_bytes {
            Some(total) if total > 0 && row.status != DownloadStatus::Queued => {
                ((row.done_bytes as f64 / total as f64 * 100.0).round() as u32).min(100)
            }
            _ => 0,
        };

        active_items.push(DownloadSummaryRow {
            id: row.id,
            title: row.title,
            progress,
            done_bytes: row.done_bytes,
            total_bytes: row.total_bytes,
            speed: l.and_then(|l| l.speed),
            eta: l.and_then(|l| l.eta),
            status: row.status,
        });
    }

    // Sort active items: running, then processing, then queued
    active_items.sort_by_key(|item| match item.status {
        DownloadStatus::Running => 0,
        DownloadStatus::Processing => 1,
        DownloadStatus::Queued => 2,
        _ => 3,
    });

    let speed = active_items.iter().filter_map(|i| i.speed).sum();
    let items = active_items.into_iter().take(2).collect();

    Ok(DownloadsSummary { speed, items })
}

pub fn get(
    conn: &Connection,
    live: &std::collections::HashMap<String, LiveProgress>,
    now: i64,
    tz: &TimeZone,
) -> Result<Dashboard, AppError> {
    let (start, end) = day_bounds(now, tz)?;
    Ok(Dashboard {
        today: today_tasks(conn, start, end)?,
        upcoming: upcoming(conn, now, tz)?,
        recent: summaries(
            conn,
            "type = 'note' ORDER BY last_activity_at DESC, id DESC LIMIT ?1",
            params![RECENT_LIMIT as i64],
        )?,
        inbox_count: conn.query_row(
            "SELECT COUNT(*) FROM items WHERE deleted_at IS NULL AND type = 'note' AND parent_id IS NULL",
            [],
            |r| r.get(0),
        )?,
        finance: finance_summary(conn, now, tz)?,
        projects: projects::active_projects(conn, now, tz, 2)?,
        habit_reminders: habits::due_reminders(conn, now, tz)?,
        downloads: downloads_summary(conn, live)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::items::{ItemPatch, capture_note, delete, open, update};
    use crate::tasks;

    fn ms(rfc3339: &str) -> i64 {
        rfc3339.parse::<Timestamp>().unwrap().as_millisecond()
    }

    fn jakarta() -> TimeZone {
        TimeZone::fixed(jiff::tz::offset(7))
    }

    fn task_due(conn: &Connection, title: &str, due: &str) -> String {
        let card = tasks::create_task(
            conn,
            &tasks::NewTask { title: title.into(), status: tasks::TaskStatus::Plan, ..Default::default() },
            1,
            &jakarta(),
        )
        .unwrap();
        update(conn, &card.id, &ItemPatch { due_at: Some(Some(ms(due))), ..Default::default() }, 1).unwrap();
        card.id
    }

    fn complete_task(conn: &Connection, id: &str, now: i64) {
        tasks::update_task(
            conn,
            id,
            &tasks::TaskPatch { status: Some(tasks::TaskStatus::Done), ..Default::default() },
            now,
            &jakarta(),
        )
        .unwrap();
    }

    fn get_test(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Dashboard, AppError> {
        get(conn, &std::collections::HashMap::new(), now, tz)
    }

    #[test]
    fn today_lists_due_overdue_and_finished_today() {
        let conn = open_in_memory();
        task_due(&conn, "terlambat", "2026-09-28T00:00:00+07:00");
        let old = task_due(&conn, "selesai kemarin", "2026-09-27T00:00:00+07:00");
        complete_task(&conn, &old, ms("2026-09-28T20:00:00+07:00"));
        let late_done = task_due(&conn, "terlambat tapi selesai hari ini", "2026-09-26T00:00:00+07:00");
        complete_task(&conn, &late_done, ms("2026-09-29T01:00:00+07:00"));
        task_due(&conn, "b hari ini", "2026-09-29T00:00:00+07:00");
        task_due(&conn, "a hari ini", "2026-09-29T00:00:00+07:00");
        task_due(&conn, "besok", "2026-09-30T00:00:00+07:00");
        let gone = task_due(&conn, "dihapus", "2026-09-29T00:00:00+07:00");
        delete(&conn, &gone, 2).unwrap();

        // 01:30 in Jakarta is still 28 Sep in UTC: the local day must win.
        let d = get_test(&conn, ms("2026-09-29T01:30:00+07:00"), &jakarta()).unwrap();

        let rows: Vec<(&str, bool, bool)> =
            d.today.iter().map(|t| (t.title.as_str(), t.overdue, t.completed_at.is_some())).collect();
        assert_eq!(
            rows,
            [
                ("terlambat tapi selesai hari ini", true, true),
                ("terlambat", true, false),
                ("a hari ini", false, false),
                ("b hari ini", false, false),
            ]
        );
    }

    #[test]
    fn upcoming_covers_the_next_seven_local_days() {
        let conn = open_in_memory();
        task_due(&conn, "hari ini", "2026-10-01T00:00:00+07:00");
        task_due(&conn, "besok", "2026-10-02T00:00:00+07:00");
        task_due(&conn, "besok juga", "2026-10-02T00:00:00+07:00");
        task_due(&conn, "hari ketujuh", "2026-10-08T00:00:00+07:00");
        task_due(&conn, "hari kedelapan", "2026-10-09T00:00:00+07:00");
        let done = task_due(&conn, "selesai", "2026-10-03T00:00:00+07:00");
        complete_task(&conn, &done, 2);
        let gone = task_due(&conn, "dihapus", "2026-10-04T00:00:00+07:00");
        delete(&conn, &gone, 2).unwrap();

        // 01:30 on 1 Oct in Jakarta is still 30 Sep in UTC: tomorrow must be 2 Oct.
        let d = get_test(&conn, ms("2026-10-01T01:30:00+07:00"), &jakarta()).unwrap();

        let days: Vec<(&str, Vec<&str>)> = d
            .upcoming
            .iter()
            .map(|day| (day.date.as_str(), day.tasks.iter().map(|t| t.title.as_str()).collect()))
            .collect();
        assert_eq!(
            days,
            [
                ("2026-10-02", vec!["besok", "besok juga"]),
                ("2026-10-03", vec![]),
                ("2026-10-04", vec![]),
                ("2026-10-05", vec![]),
                ("2026-10-06", vec![]),
                ("2026-10-07", vec![]),
                ("2026-10-08", vec!["hari ketujuh"]),
            ]
        );
        assert!(d.upcoming.iter().flat_map(|day| &day.tasks).all(|t| !t.overdue && t.completed_at.is_none()));
    }

    #[test]
    fn inbox_count_skips_deleted_items() {
        let conn = open_in_memory();
        capture_note(&conn, "a", 1).unwrap();
        let b = capture_note(&conn, "b", 2).unwrap();
        delete(&conn, &b.id, 3).unwrap();
        assert_eq!(get_test(&conn, 4, &jakarta()).unwrap().inbox_count, 1);
    }

    #[test]
    fn recent_is_capped_and_ordered_by_last_activity() {
        let conn = open_in_memory();
        let mut ids = Vec::new();
        for i in 0..10 {
            ids.push(capture_note(&conn, &format!("n{i}"), 1000 + i).unwrap().id);
        }
        open(&conn, &ids[0], 5000).unwrap();

        let d = get_test(&conn, 6000, &jakarta()).unwrap();

        let titles: Vec<&str> = d.recent.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(d.recent.len(), RECENT_LIMIT);
        assert_eq!(titles[..3], ["n0", "n9", "n8"]);
        assert_eq!(d.recent[0].last_activity_at, 5000);
    }

    #[test]
    fn finance_items_stay_out_of_note_lists() {
        let conn = open_in_memory();
        capture_note(&conn, "catatan", 1).unwrap();
        let today = ms("2026-09-29T00:00:00+07:00");
        let tomorrow = ms("2026-09-30T00:00:00+07:00");
        for (id, kind, due) in [("a1", "account", None), ("b1", "bill", Some(today)), ("b2", "bill", Some(tomorrow))] {
            conn.execute(
                "INSERT INTO items (id, type, title, due_at, created_at, updated_at) VALUES (?1, ?2, ?1, ?3, 5, 5)",
                params![id, kind, due],
            )
            .unwrap();
        }

        let d = get_test(&conn, ms("2026-09-29T12:00:00+07:00"), &jakarta()).unwrap();

        assert!(d.today.is_empty());
        assert!(d.upcoming.iter().all(|day| day.tasks.is_empty()));
        let titles: Vec<&str> = d.recent.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, ["catatan"]);
        assert_eq!(d.inbox_count, 1);
    }

    #[test]
    fn finance_summary_covers_the_current_month() {
        use crate::bills::{BillInput, BillStatus, save_bill};
        use crate::finance::testing::{account, now, spend};
        use crate::overview::{BudgetLevel, BudgetView, set_budget};

        let conn = open_in_memory();
        assert!(!get_test(&conn, now(), &jakarta()).unwrap().finance.has_accounts);
        let bca = account(&conn, "BCA", 1_000_000);
        spend(&conn, &bca, 25_000, "Makan & minum", "2026-09-29T00:00:00+07:00");
        spend(&conn, &bca, 10_000, "Belanja", "2026-08-31T00:00:00+07:00");
        set_budget(&conn, Some(30_000), now()).unwrap();
        for (name, due) in [
            ("Listrik", "2026-09-28T00:00:00+07:00"),
            ("Air", "2026-09-29T00:00:00+07:00"),
            ("Internet", "2026-10-05T00:00:00+07:00"),
        ] {
            let input = BillInput { name: name.into(), amount: 1_000, account_id: bca.clone(), due_at: ms(due), ..Default::default() };
            save_bill(&conn, &input, now(), &jakarta()).unwrap();
        }

        let d = get_test(&conn, now(), &jakarta()).unwrap();

        let f = d.finance;
        assert_eq!((f.has_accounts, f.balance, f.expense), (true, 965_000, 25_000));
        assert_eq!(f.budget, Some(BudgetView { amount: 30_000, level: BudgetLevel::Warn }));
        let due: Vec<(&str, BillStatus)> = f.due_bills.iter().map(|b| (b.name.as_str(), b.status)).collect();
        assert_eq!(due, [("Listrik", BillStatus::Overdue), ("Air", BillStatus::DueToday)]);
        assert!(d.today.is_empty(), "bills never show up as tasks");
    }

    #[test]
    fn dashboard_lists_two_active_projects() {
        use crate::projects::{self, ProjectInput};
        let conn = open_in_memory();
        let p1 = projects::save_project(&conn, &ProjectInput { name: "Proyek 1".into(), ..Default::default() }, 1, &jakarta()).unwrap();
        let p2 = projects::save_project(&conn, &ProjectInput { name: "Proyek 2".into(), ..Default::default() }, 1, &jakarta()).unwrap();
        let _p3 = projects::save_project(&conn, &ProjectInput { name: "Proyek 3".into(), ..Default::default() }, 1, &jakarta()).unwrap();

        let d = get_test(&conn, 1, &jakarta()).unwrap();
        assert_eq!(d.projects.len(), 2);
        assert_eq!(d.projects[0].id, p1.summary.id);
        assert_eq!(d.projects[1].id, p2.summary.id);
    }

    #[test]
    fn dashboard_includes_due_habit_reminders() {
        use crate::finance::testing::now;
        use crate::habits::{HabitInput, check_habit, save_habit};
        let conn = open_in_memory();
        let tz = jakarta();
        let current = now(); // Tuesday 29 Sep 2026 12:00 WIB

        let h1 = save_habit(
            &conn,
            &HabitInput {
                name: "Minum air".into(),
                days: 127,
                remind_at: Some("07:00".into()),
                remind_on: true,
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();

        let d = get_test(&conn, current, &tz).unwrap();
        assert_eq!(d.habit_reminders.len(), 1);
        assert_eq!(d.habit_reminders[0].id, h1.id);
        assert_eq!(d.habit_reminders[0].name, "Minum air");
        assert_eq!(d.habit_reminders[0].remind_at, "07:00");

        // After checking the habit, it leaves the reminders
        check_habit(&conn, &h1.id, true, current, &tz).unwrap();
        let d = get_test(&conn, current, &tz).unwrap();
        assert!(d.habit_reminders.is_empty());
    }

    #[test]
    fn downloads_summary_lists_up_to_two_active_with_speed_and_progress() {
        use std::collections::HashMap;
        use crate::downloads::{self, DownloadKind, DownloadStatus, NewDownload};
        use crate::downloader::LiveProgress;

        let conn = open_in_memory();
        let mut live = HashMap::new();

        // Empty summary
        let empty = downloads_summary(&conn, &live).unwrap();
        assert_eq!(empty.items.len(), 0);
        assert_eq!(empty.speed, 0.0);

        // Add 1 done, 2 running, 1 queued
        let done = downloads::add(&conn, &NewDownload {
            url: "https://example.com/done.mp4".into(),
            kind: DownloadKind::Media,
            options: None,
        }, 1000).unwrap();
        downloads::set_status(&conn, &done.id, DownloadStatus::Done, None, 1100).unwrap();

        let run1 = downloads::add(&conn, &NewDownload {
            url: "https://example.com/run1.mp4".into(),
            kind: DownloadKind::Media,
            options: None,
        }, 2000).unwrap();
        downloads::set_status(&conn, &run1.id, DownloadStatus::Running, None, 2100).unwrap();

        let run2 = downloads::add(&conn, &NewDownload {
            url: "https://example.com/run2.mp4".into(),
            kind: DownloadKind::Media,
            options: None,
        }, 3000).unwrap();
        downloads::set_status(&conn, &run2.id, DownloadStatus::Running, None, 3100).unwrap();

        let _queued = downloads::add(&conn, &NewDownload {
            url: "https://example.com/queued.mp4".into(),
            kind: DownloadKind::Media,
            options: None,
        }, 4000).unwrap();

        // Add live progress for run1 and run2
        live.insert(run1.id.clone(), LiveProgress {
            done: 500,
            total: Some(1000),
            speed: Some(150_000.0),
            eta: Some(10),
        });
        live.insert(run2.id.clone(), LiveProgress {
            done: 250,
            total: Some(1000),
            speed: Some(250_000.0),
            eta: Some(20),
        });

        let summary = downloads_summary(&conn, &live).unwrap();
        assert_eq!(summary.speed, 400_000.0);
        assert_eq!(summary.items.len(), 2);
        // Only 2 active items (run2 and run1, queued is excluded by limit of 2)
        assert_eq!(summary.items[0].id, run2.id);
        assert_eq!(summary.items[0].progress, 25);
        assert_eq!(summary.items[0].speed, Some(250_000.0));
        assert_eq!(summary.items[0].eta, Some(20));
        assert_eq!(summary.items[1].id, run1.id);
        assert_eq!(summary.items[1].progress, 50);
        assert_eq!(summary.items[1].speed, Some(150_000.0));
        assert_eq!(summary.items[1].eta, Some(10));

        let d = get(&conn, &live, 5000, &jakarta()).unwrap();
        assert_eq!(d.downloads.speed, 400_000.0);
        assert_eq!(d.downloads.items.len(), 2);
    }
}
