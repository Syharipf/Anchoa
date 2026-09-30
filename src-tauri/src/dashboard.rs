use jiff::{Timestamp, ToSpan, tz::TimeZone};
use rusqlite::{Connection, params};
use serde::Serialize;

use crate::error::AppError;
use crate::items::{ItemSummary, summaries};
use crate::time::day_bounds;

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

/// Fase 2 adds a `finance` field.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub today: Vec<DayTask>,
    pub upcoming: Vec<UpcomingDay>,
    pub recent: Vec<ItemSummary>,
    pub inbox_count: i64,
}

/// Due today (done or not), overdue and still open, or finished today.
/// Ordered by due date only, so a row does not jump when it is ticked.
fn today_tasks(conn: &Connection, start: i64, end: i64) -> Result<Vec<DayTask>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, due_at, completed_at FROM items
         WHERE deleted_at IS NULL AND type = 'note' AND due_at IS NOT NULL AND (
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
         WHERE deleted_at IS NULL AND type = 'note' AND completed_at IS NULL AND due_at >= ?1 AND due_at < ?2
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

pub fn get(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Dashboard, AppError> {
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
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::items::{ItemPatch, capture_note, complete, delete, open, update};

    fn ms(rfc3339: &str) -> i64 {
        rfc3339.parse::<Timestamp>().unwrap().as_millisecond()
    }

    fn jakarta() -> TimeZone {
        TimeZone::fixed(jiff::tz::offset(7))
    }

    fn note_due(conn: &Connection, title: &str, due: &str) -> String {
        let item = capture_note(conn, title, 1).unwrap();
        update(conn, &item.id, &ItemPatch { due_at: Some(Some(ms(due))), ..Default::default() }, 1).unwrap();
        item.id
    }

    #[test]
    fn today_lists_due_overdue_and_finished_today() {
        let conn = open_in_memory();
        note_due(&conn, "terlambat", "2026-09-28T00:00:00+07:00");
        let old = note_due(&conn, "selesai kemarin", "2026-09-27T00:00:00+07:00");
        complete(&conn, &old, true, ms("2026-09-28T20:00:00+07:00")).unwrap();
        let late_done = note_due(&conn, "terlambat tapi selesai hari ini", "2026-09-26T00:00:00+07:00");
        complete(&conn, &late_done, true, ms("2026-09-29T01:00:00+07:00")).unwrap();
        note_due(&conn, "b hari ini", "2026-09-29T00:00:00+07:00");
        note_due(&conn, "a hari ini", "2026-09-29T00:00:00+07:00");
        note_due(&conn, "besok", "2026-09-30T00:00:00+07:00");
        let gone = note_due(&conn, "dihapus", "2026-09-29T00:00:00+07:00");
        delete(&conn, &gone, 2).unwrap();

        // 01:30 in Jakarta is still 28 Sep in UTC: the local day must win.
        let d = get(&conn, ms("2026-09-29T01:30:00+07:00"), &jakarta()).unwrap();

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
        note_due(&conn, "hari ini", "2026-10-01T00:00:00+07:00");
        note_due(&conn, "besok", "2026-10-02T00:00:00+07:00");
        note_due(&conn, "besok juga", "2026-10-02T00:00:00+07:00");
        note_due(&conn, "hari ketujuh", "2026-10-08T00:00:00+07:00");
        note_due(&conn, "hari kedelapan", "2026-10-09T00:00:00+07:00");
        let done = note_due(&conn, "selesai", "2026-10-03T00:00:00+07:00");
        complete(&conn, &done, true, 2).unwrap();
        let gone = note_due(&conn, "dihapus", "2026-10-04T00:00:00+07:00");
        delete(&conn, &gone, 2).unwrap();

        // 01:30 on 1 Oct in Jakarta is still 30 Sep in UTC: tomorrow must be 2 Oct.
        let d = get(&conn, ms("2026-10-01T01:30:00+07:00"), &jakarta()).unwrap();

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
        assert_eq!(get(&conn, 4, &jakarta()).unwrap().inbox_count, 1);
    }

    #[test]
    fn recent_is_capped_and_ordered_by_last_activity() {
        let conn = open_in_memory();
        let mut ids = Vec::new();
        for i in 0..10 {
            ids.push(capture_note(&conn, &format!("n{i}"), 1000 + i).unwrap().id);
        }
        open(&conn, &ids[0], 5000).unwrap();

        let d = get(&conn, 6000, &jakarta()).unwrap();

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

        let d = get(&conn, ms("2026-09-29T12:00:00+07:00"), &jakarta()).unwrap();

        assert!(d.today.is_empty());
        assert!(d.upcoming.iter().all(|day| day.tasks.is_empty()));
        let titles: Vec<&str> = d.recent.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, ["catatan"]);
        assert_eq!(d.inbox_count, 1);
    }
}
