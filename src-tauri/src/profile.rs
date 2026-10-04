//! Local profile and per-kind notification preferences.
use jiff::tz::TimeZone;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::{habits, time};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: String,
    pub since: Option<i64>,
    pub stats: ProfileStats,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStats {
    pub habit_streak: i64,
    pub tasks_done: i64,
    pub journal_entries: i64,
    pub notes: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyPrefs {
    pub task: bool,
    pub bill: bool,
    pub budget: bool,
    pub habit: bool,
    pub journal: bool,
    pub journal_at: String,
}

/// Validates an `HH:MM` string (00..23, 00..59).
pub fn valid_hhmm(s: &str) -> bool {
    if s.len() != 5 {
        return false;
    }
    let bytes = s.as_bytes();
    if bytes[2] != b':' {
        return false;
    }
    let Some(h) = s[..2].parse::<u8>().ok().filter(|&h| h <= 23) else { return false };
    let Some(m) = s[3..].parse::<u8>().ok().filter(|&m| m <= 59) else { return false };
    let _ = (h, m);
    true
}

fn setting(conn: &Connection, key: &str) -> Result<Option<String>, AppError> {
    Ok(conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?)
}

pub fn profile(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Profile, AppError> {
    let name = setting(conn, "profile.name")?.unwrap_or_else(|| "Kamu".into());
    let (since, tasks_done, journal_entries, notes) = conn.query_row(
        "SELECT MIN(created_at),
                COUNT(CASE WHEN type = 'task' AND completed_at IS NOT NULL THEN 1 END),
                COUNT(CASE WHEN type = 'note' THEN 1 END),
                COUNT(CASE WHEN type = 'page' THEN 1 END)
         FROM items WHERE deleted_at IS NULL",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )?;
    let habit_streak = habits::habits_overview(conn, now, tz)?.top_streak.map_or(0, |streak| streak.days);

    Ok(Profile { name, since, stats: ProfileStats { habit_streak, tasks_done, journal_entries, notes } })
}

pub fn set_name(conn: &Connection, name: &str) -> Result<Profile, AppError> {
    let name = name.trim();
    if name.chars().count() > 40 {
        return Err(AppError::Invalid("Nama tampilan maksimal 40 karakter".into()));
    }
    let name = if name.is_empty() { "Kamu" } else { name };

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO settings (key, value) VALUES ('profile.name', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [name],
    )?;
    let result = profile(&tx, time::now_ms(), &TimeZone::system())?;
    tx.commit()?;
    Ok(result)
}

pub fn notify_prefs(conn: &Connection) -> Result<NotifyPrefs, AppError> {
    Ok(NotifyPrefs {
        task: setting(conn, "notify.task")?.as_deref() != Some("0"),
        bill: setting(conn, "notify.bill")?.as_deref() != Some("0"),
        budget: setting(conn, "notify.budget")?.as_deref() != Some("0"),
        habit: setting(conn, "notify.habit")?.as_deref() != Some("0"),
        journal: setting(conn, "notify.journal")?.as_deref() == Some("1"),
        journal_at: setting(conn, "notify.journal_at")?.unwrap_or_else(|| "20:00".into()),
    })
}

pub fn set_notify_prefs(conn: &Connection, prefs: &NotifyPrefs) -> Result<NotifyPrefs, AppError> {
    if !valid_hhmm(&prefs.journal_at) {
        return Err(AppError::Invalid("Jam pengingat jurnal harus berformat JJ:MM".into()));
    }
    let tx = conn.unchecked_transaction()?;
    for (key, enabled) in [
        ("notify.task", prefs.task),
        ("notify.bill", prefs.bill),
        ("notify.budget", prefs.budget),
        ("notify.habit", prefs.habit),
        ("notify.journal", prefs.journal),
    ] {
        tx.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, if enabled { "1" } else { "0" }],
        )?;
    }
    tx.execute(
        "INSERT INTO settings (key, value) VALUES ('notify.journal_at', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![prefs.journal_at],
    )?;
    tx.commit()?;
    Ok(prefs.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::finance::testing::{jakarta, ms};
    use crate::habits::{self, HabitInput};
    use crate::items;
    use crate::journal::{self, EntryKind};
    use crate::tasks::{self, NewTask, TaskStatus};

    fn now() -> i64 {
        // Still September 28 in UTC: streaks must use the local September 29.
        ms("2026-09-29T00:30:00+07:00")
    }

    fn habit(conn: &Connection, days: u8, checked_days: &[&str]) -> String {
        let tz = jakarta();
        let row = habits::save_habit(
            conn,
            &HabitInput { name: "Baca".into(), days, ..Default::default() },
            ms("2026-09-20T00:00:00+07:00"),
            &tz,
        )
        .unwrap();
        for day in checked_days {
            habits::check_habit(conn, &row.id, true, ms(&format!("{day}T12:00:00+07:00")), &tz).unwrap();
        }
        row.id
    }

    #[test]
    fn profile_counts_done_tasks_journal_and_notes() {
        let conn = open_in_memory();
        let tz = jakarta();
        let empty = profile(&conn, now(), &tz).unwrap();
        assert_eq!(empty.name, "Kamu");
        assert_eq!(empty.stats, ProfileStats { habit_streak: 0, tasks_done: 0, journal_entries: 0, notes: 0 });

        for status in [TaskStatus::Done, TaskStatus::Done, TaskStatus::Plan, TaskStatus::Doing] {
            tasks::create_task(&conn, &NewTask { title: "Tugas".into(), status, ..Default::default() }, now(), &tz)
                .unwrap();
        }
        let deleted_task = tasks::create_task(
            &conn,
            &NewTask { title: "Dihapus".into(), status: TaskStatus::Done, ..Default::default() },
            now(),
            &tz,
        )
        .unwrap();
        items::soft_delete(&conn, &deleted_task.id, now()).unwrap();

        for kind in [EntryKind::Idea, EntryKind::Vent, EntryKind::Note] {
            journal::create_entry(&conn, kind, None, now(), &tz).unwrap();
        }
        // Bare notes are also journal entries, as in journal_list.
        items::insert(&conn, "note", "Catatan lama", "", now()).unwrap();
        let deleted_entry = journal::create_entry(&conn, EntryKind::Note, None, now(), &tz).unwrap();
        items::soft_delete(&conn, &deleted_entry.id, now()).unwrap();

        for _ in 0..2 {
            items::insert(&conn, "page", "Halaman", "", now()).unwrap();
        }
        let deleted_page = items::insert(&conn, "page", "Dihapus", "", now()).unwrap();
        items::soft_delete(&conn, &deleted_page, now()).unwrap();
        let unrelated = items::insert(&conn, "project", "Proyek", "", now()).unwrap();
        conn.execute(
            "UPDATE items SET completed_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            rusqlite::params![now(), unrelated],
        )
        .unwrap();

        // Days off and an unchecked today preserve the running streak.
        let live = habit(&conn, 31, &["2026-09-24", "2026-09-25", "2026-09-28"]);
        habits::check_habit(&conn, &live, true, now(), &tz).unwrap();
        habits::check_habit(&conn, &live, false, now(), &tz).unwrap();
        habit(&conn, 127, &["2026-09-28"]);
        // A longer historical streak has already broken.
        habit(&conn, 127, &["2026-09-20", "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"]);
        let deleted_habit = habit(&conn, 127, &["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28"]);
        items::soft_delete(&conn, &deleted_habit, now()).unwrap();

        let result = profile(&conn, now(), &tz).unwrap();
        assert_eq!(result.stats, ProfileStats { habit_streak: 3, tasks_done: 2, journal_entries: 4, notes: 2 });
    }

    #[test]
    fn profile_since_is_the_oldest_item() {
        let conn = open_in_memory();
        let tz = jakarta();
        assert_eq!(profile(&conn, now(), &tz).unwrap().since, None);

        let deleted = items::insert(&conn, "page", "Dihapus", "", -1).unwrap();
        items::soft_delete(&conn, &deleted, now()).unwrap();
        assert_eq!(profile(&conn, now(), &tz).unwrap().since, None);

        items::insert(&conn, "note", "Baru", "", now()).unwrap();
        let oldest = items::insert(&conn, "project", "Pertama", "", 0).unwrap();
        assert_eq!(profile(&conn, now(), &tz).unwrap().since, Some(0));

        items::soft_delete(&conn, &oldest, now()).unwrap();
        assert_eq!(profile(&conn, now(), &tz).unwrap().since, Some(now()));
    }

    #[test]
    fn profile_statistics_ignore_deleted_rows_of_every_counted_type() {
        let conn = open_in_memory();
        let tz = jakarta();
        let task = tasks::create_task(&conn, &NewTask { title: "Selesai".into(), status: TaskStatus::Done, ..Default::default() }, now(), &tz).unwrap();
        let note = journal::create_entry(&conn, EntryKind::Note, Some("Jurnal"), now(), &tz).unwrap();
        let page = crate::notes::create(&conn, None, "Catatan", now()).unwrap();
        for id in [&task.id, &note.id, &page.id] {
            items::soft_delete(&conn, id, now()).unwrap();
        }
        let profile = profile(&conn, now(), &tz).unwrap();
        assert_eq!(profile.since, None);
        assert_eq!((profile.stats.tasks_done, profile.stats.journal_entries, profile.stats.notes), (0, 0, 0));
    }

    #[test]
    fn set_name_trims_and_limits() {
        let conn = open_in_memory();
        let page = items::insert(&conn, "page", "Halaman", "", now()).unwrap();
        let saved = set_name(&conn, " \tDewi\n ").unwrap();
        assert_eq!(saved.name, "Dewi");
        assert_eq!(saved.since, Some(now()));
        assert_eq!(saved.stats.notes, 1);
        assert_eq!(profile(&conn, now(), &jakarta()).unwrap(), saved);

        let forty_chars = "🌻".repeat(40);
        assert_eq!(set_name(&conn, &format!("  {forty_chars}  ")).unwrap().name, forty_chars);
        for too_long in ["x".repeat(41), "🌻".repeat(41)] {
            assert!(matches!(set_name(&conn, &too_long), Err(AppError::Invalid(_))));
            assert_eq!(profile(&conn, now(), &jakarta()).unwrap().name, forty_chars);
        }
        assert_eq!(set_name(&conn, " A ").unwrap().name, "A");
        for empty in ["", " \t\n\u{2003}"] {
            assert_eq!(set_name(&conn, empty).unwrap().name, "Kamu");
            assert_eq!(profile(&conn, now(), &jakarta()).unwrap().name, "Kamu");
        }
        assert!(items::get(&conn, &page).is_ok());
    }

    #[test]
    fn valid_hhmm_accepts_and_rejects() {
        assert!(valid_hhmm("00:00"));
        assert!(valid_hhmm("23:59"));
        assert!(valid_hhmm("20:00"));
        assert!(valid_hhmm("09:05"));
        assert!(!valid_hhmm("24:00"));
        assert!(!valid_hhmm("23:60"));
        assert!(!valid_hhmm("2:00"));
        assert!(!valid_hhmm("20:0"));
        assert!(!valid_hhmm("ab:cd"));
        assert!(!valid_hhmm(""));
        assert!(!valid_hhmm("12-00"));
        assert!(!valid_hhmm("12:00:00"));
    }

    #[test]
    fn notify_prefs_default_on_and_round_trip() {
        let conn = open_in_memory();
        let default = NotifyPrefs {
            task: true, bill: true, budget: true, habit: true,
            journal: false, journal_at: "20:00".into(),
        };
        assert_eq!(notify_prefs(&conn).unwrap(), default);
        conn.execute("INSERT INTO settings (key, value) VALUES ('downloads.parallel', '3'), ('notify.task', '0')", [])
            .unwrap();
        assert_eq!(notify_prefs(&conn).unwrap(), NotifyPrefs { task: false, ..default.clone() });

        let all_on = NotifyPrefs {
            task: true, bill: true, budget: true, habit: true,
            journal: true, journal_at: "21:30".into(),
        };
        for prefs in [
            NotifyPrefs { task: false, bill: true, budget: false, habit: true, journal: false, journal_at: "08:00".into() },
            NotifyPrefs { task: true, bill: false, budget: true, habit: false, journal: true, journal_at: "19:00".into() },
            NotifyPrefs { task: false, bill: false, budget: false, habit: false, journal: false, journal_at: "00:00".into() },
            all_on.clone(),
        ] {
            assert_eq!(set_notify_prefs(&conn, &prefs).unwrap(), prefs);
            assert_eq!(notify_prefs(&conn).unwrap(), prefs);
            for (key, enabled) in [
                ("notify.task", prefs.task),
                ("notify.bill", prefs.bill),
                ("notify.budget", prefs.budget),
                ("notify.habit", prefs.habit),
                ("notify.journal", prefs.journal),
            ] {
                let stored: String =
                    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).unwrap();
                assert_eq!(stored, if enabled { "1" } else { "0" });
            }
            let stored_at: String =
                conn.query_row("SELECT value FROM settings WHERE key = 'notify.journal_at'", [], |r| r.get(0)).unwrap();
            assert_eq!(stored_at, prefs.journal_at);
        }
        let unrelated: String =
            conn.query_row("SELECT value FROM settings WHERE key = 'downloads.parallel'", [], |r| r.get(0)).unwrap();
        assert_eq!(unrelated, "3");
    }

    #[test]
    fn set_notify_prefs_rejects_invalid_journal_at() {
        let conn = open_in_memory();
        let bad = NotifyPrefs {
            task: true, bill: true, budget: true, habit: true,
            journal: true, journal_at: "25:00".into(),
        };
        assert!(matches!(set_notify_prefs(&conn, &bad), Err(AppError::Invalid(_))));
        // journal still at default
        assert_eq!(notify_prefs(&conn).unwrap().journal_at, "20:00");
    }
}
