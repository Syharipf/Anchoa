use jiff::tz::TimeZone;
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

/// Fase 2 adds a `finance` field.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub today: Vec<DayTask>,
    pub recent: Vec<ItemSummary>,
    pub inbox_count: i64,
}

/// Due today (done or not), overdue and still open, or finished today.
/// Ordered by due date only, so a row does not jump when it is ticked.
fn today_tasks(conn: &Connection, start: i64, end: i64) -> Result<Vec<DayTask>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, due_at, completed_at FROM items
         WHERE deleted_at IS NULL AND due_at IS NOT NULL AND (
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

pub fn get(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Dashboard, AppError> {
    let (start, end) = day_bounds(now, tz)?;
    Ok(Dashboard {
        today: today_tasks(conn, start, end)?,
        recent: summaries(
            conn,
            "1 ORDER BY last_activity_at DESC, id DESC LIMIT ?1",
            params![RECENT_LIMIT as i64],
        )?,
        inbox_count: conn.query_row(
            "SELECT COUNT(*) FROM items WHERE deleted_at IS NULL AND parent_id IS NULL",
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
    use jiff::Timestamp;

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
}
