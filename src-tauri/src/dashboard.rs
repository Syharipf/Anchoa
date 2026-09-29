use jiff::tz::TimeZone;
use rusqlite::{Connection, params};
use serde::Serialize;

use crate::error::AppError;
use crate::items::{ItemSummary, summaries};
use crate::time::day_bounds;

pub const RECENT_LIMIT: usize = 8;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Today {
    pub due_today: Vec<ItemSummary>,
    pub overdue: Vec<ItemSummary>,
}

/// Fase 2 adds a `finance` field.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub today: Today,
    pub recent: Vec<ItemSummary>,
}

pub fn get(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Dashboard, AppError> {
    let (start, end) = day_bounds(now, tz)?;
    Ok(Dashboard {
        today: Today {
            due_today: summaries(conn, "due_at >= ?1 AND due_at < ?2 ORDER BY due_at, title", params![start, end])?,
            overdue: summaries(conn, "due_at < ?1 ORDER BY due_at, title", params![start])?,
        },
        recent: summaries(
            conn,
            "1 ORDER BY last_activity_at DESC, id DESC LIMIT ?1",
            params![RECENT_LIMIT as i64],
        )?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::items::{ItemPatch, capture_note, delete, open, update};
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

    fn titles(list: &[ItemSummary]) -> Vec<&str> {
        list.iter().map(|s| s.title.as_str()).collect()
    }

    #[test]
    fn splits_due_items_by_local_day() {
        let conn = open_in_memory();
        note_due(&conn, "kemarin", "2026-09-28T00:00:00+07:00");
        note_due(&conn, "b hari ini", "2026-09-29T00:00:00+07:00");
        note_due(&conn, "a hari ini", "2026-09-29T00:00:00+07:00");
        note_due(&conn, "besok", "2026-09-30T00:00:00+07:00");
        let gone = note_due(&conn, "dihapus", "2026-09-29T00:00:00+07:00");
        delete(&conn, &gone, 2).unwrap();

        // 01:30 in Jakarta is still 28 Sep in UTC: the local day must win.
        let d = get(&conn, ms("2026-09-29T01:30:00+07:00"), &jakarta()).unwrap();

        assert_eq!(titles(&d.today.due_today), ["a hari ini", "b hari ini"]);
        assert_eq!(titles(&d.today.overdue), ["kemarin"]);
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

        assert_eq!(d.recent.len(), RECENT_LIMIT);
        assert_eq!(titles(&d.recent)[..3], ["n0", "n9", "n8"]);
        assert_eq!(d.recent[0].last_activity_at, 5000);
    }
}
