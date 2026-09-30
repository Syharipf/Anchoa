//! Habits with day schedule, streaks, history, and reminders (spec Fase 3C §3-4).
#![allow(dead_code)]

use std::collections::HashSet;

use jiff::civil::{Date, Weekday};
use jiff::tz::TimeZone;
use jiff::{Timestamp, ToSpan};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::time::local_date;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DayState {
    Blank,
    Future,
    Off,
    Done,
    Todo,
    Miss,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitRow {
    pub id: String,
    pub name: String,
    pub days: u8,
    pub remind_at: Option<String>,
    pub remind_on: bool,
    pub scheduled_today: bool,
    pub done_today: bool,
    pub streak: i64,
    pub best: i64,
    pub rate30: i64,
    pub week: Vec<DayState>,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopStreak {
    pub name: String,
    pub days: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Consistency {
    pub percent: i64,
    pub done: i64,
    pub scheduled: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub today: String,
    pub today_done: i64,
    pub today_total: i64,
    pub top_streak: Option<TopStreak>,
    pub consistency: Consistency,
    pub habits: Vec<HabitRow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCell {
    pub date: String,
    pub day: i8,
    pub state: DayState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    pub month: String,
    pub cells: Vec<HistoryCell>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitReminder {
    pub id: String,
    pub name: String,
    pub remind_at: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitInput {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub days: u8,
    #[serde(default)]
    pub remind_at: Option<String>,
    pub remind_on: bool,
}

/// Bit 0 = Monday ... bit 6 = Sunday.
pub fn scheduled(days: u8, date: Date) -> bool {
    let bit = match date.weekday() {
        Weekday::Monday => 0,
        Weekday::Tuesday => 1,
        Weekday::Wednesday => 2,
        Weekday::Thursday => 3,
        Weekday::Friday => 4,
        Weekday::Saturday => 5,
        Weekday::Sunday => 6,
    };
    (days & (1 << bit)) != 0
}

/// Computes the state of a single day for a habit.
pub fn day_state(date: Date, today: Date, created: Date, days: u8, checked: &HashSet<Date>) -> DayState {
    if date < created {
        DayState::Blank
    } else if date > today {
        DayState::Future
    } else if !scheduled(days, date) {
        DayState::Off
    } else if checked.contains(&date) {
        DayState::Done
    } else if date == today {
        DayState::Todo
    } else {
        DayState::Miss
    }
}

/// Streak ending today if checked, or yesterday if not. Days off do not break the streak.
pub fn current_streak(today: Date, created: Date, days: u8, checked: &HashSet<Date>) -> i64 {
    let mut streak = 0;
    let mut curr = if scheduled(days, today) && checked.contains(&today) {
        today
    } else {
        match today.yesterday() {
            Ok(d) => d,
            Err(_) => return 0,
        }
    };

    while curr >= created {
        if scheduled(days, curr) {
            if checked.contains(&curr) {
                streak += 1;
            } else {
                break;
            }
        }
        match curr.yesterday() {
            Ok(prev) => curr = prev,
            Err(_) => break,
        }
    }
    streak
}

/// Longest streak across the habit's entire history up to today.
pub fn best_streak(today: Date, created: Date, days: u8, checked: &HashSet<Date>) -> i64 {
    if created > today {
        return 0;
    }
    let mut best = 0;
    let mut curr_streak = 0;
    let mut d = created;
    while d <= today {
        if scheduled(days, d) {
            if checked.contains(&d) {
                curr_streak += 1;
                if curr_streak > best {
                    best = curr_streak;
                }
            } else if d == today {
                // Today not checked yet does not break historical best
            } else {
                curr_streak = 0;
            }
        }
        match d.tomorrow() {
            Ok(next) => d = next,
            Err(_) => break,
        }
    }
    best.max(current_streak(today, created, days, checked))
}

/// Completed and scheduled days in the last 30 days (offset 0..30).
/// Days before creation are ignored. Today is only counted if checked.
pub fn rate30(today: Date, created: Date, days: u8, checked: &HashSet<Date>) -> (i64, i64) {
    let mut done = 0;
    let mut sched = 0;

    for offset in 0..30 {
        let Ok(date) = today.checked_sub(offset.days()) else { break };
        if date < created {
            continue;
        }
        if offset == 0 {
            if scheduled(days, today) && checked.contains(&today) {
                done += 1;
                sched += 1;
            }
        } else if scheduled(days, date) {
            sched += 1;
            if checked.contains(&date) {
                done += 1;
            }
        }
    }

    (done, sched)
}

fn parse_month(month: &str) -> Result<Date, AppError> {
    let invalid = || AppError::Invalid(format!("Bulan tidak valid: {month}"));
    let (year, mon) = month.split_once('-').ok_or_else(invalid)?;
    if year.len() != 4 || mon.len() != 2 {
        return Err(invalid());
    }
    let year: i16 = year.parse().map_err(|_| invalid())?;
    let mon: i8 = mon.parse().map_err(|_| invalid())?;
    Date::new(year, mon, 1).map_err(|_| invalid())
}

pub fn validate_time(s: &str) -> Result<String, AppError> {
    let trimmed = s.trim();
    let invalid = || AppError::Invalid(format!("Format jam tidak valid: {trimmed}"));
    if trimmed.len() != 5 || trimmed.as_bytes()[2] != b':' {
        return Err(invalid());
    }
    let h: u32 = trimmed[..2].parse().map_err(|_| invalid())?;
    let m: u32 = trimmed[3..].parse().map_err(|_| invalid())?;
    if h > 23 || m > 59 {
        return Err(invalid());
    }
    Ok(format!("{h:02}:{m:02}"))
}

fn week_strip(today: Date, created: Date, days: u8, checked: &HashSet<Date>) -> Vec<DayState> {
    let mut week = Vec::with_capacity(7);
    for offset in (0..=6).rev() {
        if let Ok(d) = today.checked_sub(offset.days()) {
            week.push(day_state(d, today, created, days, checked));
        } else {
            week.push(DayState::Blank);
        }
    }
    week
}

fn get_habit_row(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<HabitRow, AppError> {
    let row: Option<(String, u8, Option<String>, i64, i64)> = conn
        .query_row(
            "SELECT i.title, h.days, h.remind_at, h.remind_on, i.created_at
             FROM habits h JOIN items i ON i.id = h.item_id
             WHERE i.id = ?1 AND i.type = 'habit' AND i.deleted_at IS NULL",
            [id],
            |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as u8, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?;

    let Some((name, days, remind_at, remind_on, created_at)) = row else {
        return Err(AppError::NotFound);
    };

    let today = local_date(now, tz)?;
    let created = local_date(created_at, tz)?;

    let mut stmt = conn.prepare("SELECT date FROM habit_checks WHERE habit_id = ?1 AND deleted_at IS NULL")?;
    let checked_rows = stmt.query_map([id], |r| r.get::<_, String>(0))?;
    let mut checked = HashSet::new();
    for date_res in checked_rows {
        if let Ok(d) = date_res?.parse::<Date>() {
            checked.insert(d);
        }
    }

    let scheduled_today = scheduled(days, today);
    let done_today = checked.contains(&today);
    let streak = current_streak(today, created, days, &checked);
    let best = best_streak(today, created, days, &checked);
    let (done30, sched30) = rate30(today, created, days, &checked);
    let rate30_pct = if sched30 == 0 {
        0
    } else {
        ((done30 as f64 / sched30 as f64) * 100.0).round() as i64
    };
    let week = week_strip(today, created, days, &checked);

    Ok(HabitRow {
        id: id.to_string(),
        name,
        days,
        remind_at,
        remind_on: remind_on != 0,
        scheduled_today,
        done_today,
        streak,
        best,
        rate30: rate30_pct,
        week,
        created_at,
    })
}

pub fn habits_overview(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Overview, AppError> {
    let today = local_date(now, tz)?;
    let today_str = today.to_string();

    let mut stmt = conn.prepare(
        "SELECT i.id, i.title, h.days, h.remind_at, h.remind_on, i.created_at
         FROM habits h
         JOIN items i ON i.id = h.item_id
         WHERE i.deleted_at IS NULL AND i.type = 'habit'
         ORDER BY CASE WHEN h.remind_at IS NULL OR h.remind_at = '' THEN 1 ELSE 0 END,
                  h.remind_at ASC,
                  i.title COLLATE NOCASE ASC,
                  i.id ASC",
    )?;

    let habit_rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)? as u8,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, i64>(4)? != 0,
            r.get::<_, i64>(5)?,
        ))
    })?;

    let mut checks_stmt = conn.prepare("SELECT habit_id, date FROM habit_checks WHERE deleted_at IS NULL")?;
    let mut checks_map: std::collections::HashMap<String, HashSet<Date>> = std::collections::HashMap::new();
    let check_rows = checks_stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    for row in check_rows {
        let (hid, d_str) = row?;
        if let Ok(d) = d_str.parse::<Date>() {
            checks_map.entry(hid).or_default().insert(d);
        }
    }

    let mut habits = Vec::new();
    let mut total_done = 0;
    let mut total_sched = 0;

    for h in habit_rows {
        let (id, name, days, remind_at, remind_on, created_at) = h?;
        let created = local_date(created_at, tz)?;
        let checked = checks_map.remove(&id).unwrap_or_default();

        let scheduled_today = scheduled(days, today);
        let done_today = checked.contains(&today);
        let streak = current_streak(today, created, days, &checked);
        let best = best_streak(today, created, days, &checked);
        let (done30, sched30) = rate30(today, created, days, &checked);
        total_done += done30;
        total_sched += sched30;

        let rate30_pct = if sched30 == 0 {
            0
        } else {
            ((done30 as f64 / sched30 as f64) * 100.0).round() as i64
        };
        let week = week_strip(today, created, days, &checked);

        habits.push(HabitRow {
            id,
            name,
            days,
            remind_at,
            remind_on,
            scheduled_today,
            done_today,
            streak,
            best,
            rate30: rate30_pct,
            week,
            created_at,
        });
    }

    let today_total = habits.iter().filter(|h| h.scheduled_today).count() as i64;
    let today_done = habits.iter().filter(|h| h.scheduled_today && h.done_today).count() as i64;

    let top_streak = habits
        .iter()
        .filter(|h| h.streak > 0)
        .max_by(|a, b| a.streak.cmp(&b.streak))
        .map(|h| TopStreak {
            name: h.name.clone(),
            days: h.streak,
        });

    let percent = if total_sched == 0 {
        0
    } else {
        ((total_done as f64 / total_sched as f64) * 100.0).round() as i64
    };

    Ok(Overview {
        today: today_str,
        today_done,
        today_total,
        top_streak,
        consistency: Consistency {
            percent,
            done: total_done,
            scheduled: total_sched,
        },
        habits,
    })
}

pub fn habit_history(conn: &Connection, id: &str, month: &str, now: i64, tz: &TimeZone) -> Result<History, AppError> {
    let row: Option<(u8, i64)> = conn
        .query_row(
            "SELECT h.days, i.created_at FROM habits h JOIN items i ON i.id = h.item_id
             WHERE i.id = ?1 AND i.type = 'habit' AND i.deleted_at IS NULL",
            [id],
            |r| Ok((r.get::<_, i64>(0)? as u8, r.get(1)?)),
        )
        .optional()?;

    let Some((days, created_at)) = row else {
        return Err(AppError::NotFound);
    };

    let first_day = parse_month(month)?;
    let today = local_date(now, tz)?;
    let created = local_date(created_at, tz)?;

    let mut stmt = conn.prepare("SELECT date FROM habit_checks WHERE habit_id = ?1 AND deleted_at IS NULL")?;
    let checked_rows = stmt.query_map([id], |r| r.get::<_, String>(0))?;
    let mut checked = HashSet::new();
    for date_res in checked_rows {
        if let Ok(d) = date_res?.parse::<Date>() {
            checked.insert(d);
        }
    }

    let pad_start = match first_day.weekday() {
        Weekday::Monday => 0,
        Weekday::Tuesday => 1,
        Weekday::Wednesday => 2,
        Weekday::Thursday => 3,
        Weekday::Friday => 4,
        Weekday::Saturday => 5,
        Weekday::Sunday => 6,
    };

    let mut cells = Vec::new();
    for _ in 0..pad_start {
        cells.push(HistoryCell {
            date: String::new(),
            day: 0,
            state: DayState::Blank,
        });
    }

    let days_in_month = first_day.days_in_month();
    for d in 1..=days_in_month {
        let date = Date::new(first_day.year(), first_day.month(), d).map_err(|e| AppError::Other(e.to_string()))?;
        let state = day_state(date, today, created, days, &checked);
        cells.push(HistoryCell {
            date: date.to_string(),
            day: d,
            state,
        });
    }

    while cells.len() % 7 != 0 {
        cells.push(HistoryCell {
            date: String::new(),
            day: 0,
            state: DayState::Blank,
        });
    }

    Ok(History {
        month: month.to_string(),
        cells,
    })
}

pub fn save_habit(conn: &Connection, input: &HabitInput, now: i64, tz: &TimeZone) -> Result<HabitRow, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("Nama habit tidak boleh kosong".into()));
    }
    if input.days < 1 || input.days > 127 {
        return Err(AppError::Invalid(format!("Hari aktif tidak valid: {}", input.days)));
    }
    let remind_at = match &input.remind_at {
        Some(s) if !s.trim().is_empty() => Some(validate_time(s)?),
        _ => None,
    };

    let id = match &input.id {
        Some(id) => {
            let exists: bool = conn
                .query_row(
                    "SELECT 1 FROM items WHERE id = ?1 AND type = 'habit' AND deleted_at IS NULL",
                    [id],
                    |_| Ok(true),
                )
                .optional()?
                .unwrap_or(false);
            if !exists {
                return Err(AppError::NotFound);
            }
            conn.execute(
                "UPDATE items SET title = ?1, updated_at = ?2 WHERE id = ?3",
                params![name, now, id],
            )?;
            conn.execute(
                "UPDATE habits SET days = ?1, remind_at = ?2, remind_on = ?3 WHERE item_id = ?4",
                params![input.days, remind_at, input.remind_on as i64, id],
            )?;
            id.clone()
        }
        None => {
            let id = uuid::Uuid::now_v7().to_string();
            conn.execute(
                "INSERT INTO items (id, type, title, created_at, updated_at) VALUES (?1, 'habit', ?2, ?3, ?3)",
                params![id, name, now],
            )?;
            conn.execute(
                "INSERT INTO habits (item_id, days, remind_at, remind_on) VALUES (?1, ?2, ?3, ?4)",
                params![id, input.days, remind_at, input.remind_on as i64],
            )?;
            id
        }
    };

    get_habit_row(conn, &id, now, tz)
}

pub fn delete_habit(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    let affected = conn.execute(
        "UPDATE items SET deleted_at = ?1 WHERE id = ?2 AND type = 'habit' AND deleted_at IS NULL",
        params![now, id],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub fn check_habit(conn: &Connection, id: &str, done: bool, now: i64, tz: &TimeZone) -> Result<HabitRow, AppError> {
    let row: Option<u8> = conn
        .query_row(
            "SELECT h.days FROM habits h JOIN items i ON i.id = h.item_id
             WHERE i.id = ?1 AND i.type = 'habit' AND i.deleted_at IS NULL",
            [id],
            |r| Ok(r.get::<_, i64>(0)? as u8),
        )
        .optional()?;

    let Some(days) = row else {
        return Err(AppError::NotFound);
    };

    let today = local_date(now, tz)?;
    if !scheduled(days, today) {
        return Err(AppError::Invalid("Habit libur hari ini".into()));
    }
    let today_str = today.to_string();

    let existing: Option<Option<i64>> = conn
        .query_row(
            "SELECT deleted_at FROM habit_checks WHERE habit_id = ?1 AND date = ?2",
            params![id, today_str],
            |r| r.get(0),
        )
        .optional()?;

    if done {
        match existing {
            None => {
                conn.execute(
                    "INSERT INTO habit_checks (habit_id, date, created_at, deleted_at) VALUES (?1, ?2, ?3, NULL)",
                    params![id, today_str, now],
                )?;
            }
            Some(Some(_)) => {
                conn.execute(
                    "UPDATE habit_checks SET deleted_at = NULL WHERE habit_id = ?1 AND date = ?2",
                    params![id, today_str],
                )?;
            }
            Some(None) => {}
        }
    } else {
        if let Some(None) = existing {
            conn.execute(
                "UPDATE habit_checks SET deleted_at = ?1 WHERE habit_id = ?2 AND date = ?3",
                params![now, id, today_str],
            )?;
        }
    }

    get_habit_row(conn, id, now, tz)
}

pub fn due_reminders(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Vec<HabitReminder>, AppError> {
    let today = local_date(now, tz)?;
    let today_str = today.to_string();
    let zoned = Timestamp::from_millisecond(now)?.to_zoned(tz.clone());
    let current_time = zoned.strftime("%H:%M").to_string();

    let mut stmt = conn.prepare(
        "SELECT i.id, i.title, h.days, h.remind_at
         FROM habits h
         JOIN items i ON i.id = h.item_id
         WHERE i.deleted_at IS NULL
           AND i.type = 'habit'
           AND h.remind_on = 1
           AND h.remind_at IS NOT NULL
           AND h.remind_at != ''
           AND h.remind_at <= ?1
           AND NOT EXISTS (
               SELECT 1 FROM habit_checks hc
               WHERE hc.habit_id = i.id AND hc.date = ?2 AND hc.deleted_at IS NULL
           )
         ORDER BY h.remind_at ASC, i.title COLLATE NOCASE ASC, i.id ASC",
    )?;

    let rows = stmt.query_map(params![current_time, today_str], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)? as u8, r.get::<_, String>(3)?))
    })?;

    let mut reminders = Vec::new();
    for row in rows {
        let (id, title, days, remind_at) = row?;
        if scheduled(days, today) {
            reminders.push(HabitReminder {
                id,
                name: title,
                remind_at,
            });
        }
    }

    Ok(reminders)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::finance::testing::{jakarta, ms, now};

    fn date(s: &str) -> Date {
        s.parse::<Date>().unwrap()
    }

    #[test]
    fn scheduled_uses_monday_first_bits() {
        let mon = date("2026-09-28");
        let tue = date("2026-09-29");
        let wed = date("2026-09-30");
        let thu = date("2026-10-01");
        let fri = date("2026-10-02");
        let sat = date("2026-10-03");
        let sun = date("2026-10-04");

        assert!(scheduled(1, mon));
        assert!(!scheduled(1, tue));
        assert!(scheduled(2, tue));
        assert!(scheduled(4, wed));
        assert!(scheduled(8, thu));
        assert!(scheduled(16, fri));
        assert!(scheduled(32, sat));
        assert!(scheduled(64, sun));

        for d in [mon, tue, wed, thu, fri, sat, sun] {
            assert!(scheduled(127, d));
        }

        for d in [mon, tue, wed, thu, fri] {
            assert!(scheduled(31, d));
        }
        assert!(!scheduled(31, sat));
        assert!(!scheduled(31, sun));

        assert!(!scheduled(96, mon));
        assert!(scheduled(96, sat));
        assert!(scheduled(96, sun));
    }

    #[test]
    fn day_state_covers_every_case() {
        let today = date("2026-09-29");
        let created = date("2026-09-28");
        let days = 31; // Mon-Fri
        let mut checked = HashSet::new();
        checked.insert(date("2026-09-28"));

        // blank: before created
        assert_eq!(day_state(date("2026-09-27"), today, created, days, &checked), DayState::Blank);

        // future: after today
        assert_eq!(day_state(date("2026-09-30"), today, created, days, &checked), DayState::Future);

        // off: day not scheduled
        assert_eq!(day_state(date("2026-09-28"), today, created, 2, &checked), DayState::Off);

        // done: scheduled and checked
        assert_eq!(day_state(date("2026-09-28"), today, created, days, &checked), DayState::Done);

        // todo: scheduled today, not checked
        assert_eq!(day_state(today, today, created, days, &checked), DayState::Todo);

        // done today: scheduled today and checked
        checked.insert(today);
        assert_eq!(day_state(today, today, created, days, &checked), DayState::Done);
        checked.remove(&today);

        // miss: scheduled past day not checked
        checked.remove(&date("2026-09-28"));
        assert_eq!(day_state(date("2026-09-28"), today, created, days, &checked), DayState::Miss);
    }

    #[test]
    fn streak_skips_days_off_and_waits_for_today() {
        let today = date("2026-09-29"); // Tuesday
        let created = date("2026-09-01");
        let days = 31; // Sen-Jum

        let mut checked = HashSet::new();
        checked.insert(date("2026-09-24")); // Thu
        checked.insert(date("2026-09-25")); // Fri
        // 2026-09-26 (Sat) off, 2026-09-27 (Sun) off
        checked.insert(date("2026-09-28")); // Mon

        // Hari ini (Selasa) belum -> streak 3
        assert_eq!(current_streak(today, created, days, &checked), 3);

        // Setelah dicentang -> streak 4
        checked.insert(today);
        assert_eq!(current_streak(today, created, days, &checked), 4);

        // Kalau Senin terlewat -> 0 sebelum centang hari ini
        checked.remove(&today);
        checked.remove(&date("2026-09-28")); // Mon terlewat
        assert_eq!(current_streak(today, created, days, &checked), 0);
    }

    #[test]
    fn best_streak_scans_history() {
        let today = date("2026-09-29");
        let created = date("2026-09-01");
        let days = 127; // every day

        let mut checked = HashSet::new();
        for d in 1..=5 {
            checked.insert(Date::new(2026, 9, d).unwrap());
        }
        // 6th missed
        checked.insert(date("2026-09-27"));
        checked.insert(date("2026-09-28"));

        assert_eq!(current_streak(today, created, days, &checked), 2);
        assert_eq!(best_streak(today, created, days, &checked), 5);
    }

    #[test]
    fn rate30_ignores_days_before_creation_and_open_today() {
        let today = date("2026-09-29"); // Tuesday
        let created = date("2026-09-25"); // Friday, 4 days ago
        let days = 127; // every day

        let mut checked = HashSet::new();
        // Days before creation (2026-09-20..=24) must be ignored
        checked.insert(date("2026-09-20"));
        // Checked on 25, 26, 28 (3 of 4 days: 25, 26, 27, 28)
        checked.insert(date("2026-09-25"));
        checked.insert(date("2026-09-26"));
        checked.insert(date("2026-09-28"));

        // Today is not checked yet: ignored
        let (done, sched) = rate30(today, created, days, &checked);
        assert_eq!((done, sched), (3, 4));

        // When today is checked: adds to both
        checked.insert(today);
        let (done, sched) = rate30(today, created, days, &checked);
        assert_eq!((done, sched), (4, 5));
    }

    #[test]
    fn overview_cards() {
        let conn = open_in_memory();
        let tz = jakarta();
        let current = now(); // Tuesday 2026-09-29 12:00 WIB

        let h1 = save_habit(
            &conn,
            &HabitInput {
                name: "Olahraga".into(),
                days: 127,
                ..Default::default()
            },
            ms("2026-09-20T00:00:00+07:00"),
            &tz,
        )
        .unwrap();
        check_habit(&conn, &h1.id, true, ms("2026-09-27T12:00:00+07:00"), &tz).unwrap();
        check_habit(&conn, &h1.id, true, ms("2026-09-28T12:00:00+07:00"), &tz).unwrap();
        check_habit(&conn, &h1.id, true, current, &tz).unwrap(); // checked today, streak = 3

        let h2 = save_habit(
            &conn,
            &HabitInput {
                name: "Coding".into(),
                days: 31,
                ..Default::default()
            },
            ms("2026-09-20T00:00:00+07:00"),
            &tz,
        )
        .unwrap();
        check_habit(&conn, &h2.id, true, ms("2026-09-28T12:00:00+07:00"), &tz).unwrap();

        let _h3 = save_habit(
            &conn,
            &HabitInput {
                name: "Jalan".into(),
                days: 96,
                ..Default::default()
            },
            ms("2026-09-20T00:00:00+07:00"),
            &tz,
        )
        .unwrap();

        let ov = habits_overview(&conn, current, &tz).unwrap();
        assert_eq!(ov.today, "2026-09-29");
        assert_eq!((ov.today_done, ov.today_total), (1, 2));
        assert_eq!(ov.top_streak, Some(TopStreak { name: "Olahraga".into(), days: 3 }));
        assert_eq!(ov.consistency.done, 4);
        assert_eq!(ov.consistency.scheduled, 19);
        assert_eq!(ov.consistency.percent, 21);
    }

    #[test]
    fn check_habit_toggles_and_refuses_days_off() {
        let conn = open_in_memory();
        let tz = jakarta();
        let current = now(); // Tuesday 2026-09-29

        let h = save_habit(
            &conn,
            &HabitInput {
                name: "Olahraga".into(),
                days: 31,
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();

        let checked = check_habit(&conn, &h.id, true, current, &tz).unwrap();
        assert!(checked.done_today);
        let del: Option<i64> = conn
            .query_row(
                "SELECT deleted_at FROM habit_checks WHERE habit_id = ?1 AND date = '2026-09-29'",
                [&h.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(del.is_none());

        let unchecked = check_habit(&conn, &h.id, false, current, &tz).unwrap();
        assert!(!unchecked.done_today);
        let del: Option<i64> = conn
            .query_row(
                "SELECT deleted_at FROM habit_checks WHERE habit_id = ?1 AND date = '2026-09-29'",
                [&h.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(del.is_some());

        let checked_again = check_habit(&conn, &h.id, true, current, &tz).unwrap();
        assert!(checked_again.done_today);
        let del: Option<i64> = conn
            .query_row(
                "SELECT deleted_at FROM habit_checks WHERE habit_id = ?1 AND date = '2026-09-29'",
                [&h.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(del.is_none());

        let off_habit = save_habit(
            &conn,
            &HabitInput {
                name: "Weekend".into(),
                days: 96,
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();
        assert!(matches!(
            check_habit(&conn, &off_habit.id, true, current, &tz),
            Err(AppError::Invalid(_))
        ));
    }

    #[test]
    fn history_grid_is_monday_first_with_blank_and_future() {
        let conn = open_in_memory();
        let tz = jakarta();
        let current = now(); // Tuesday 2026-09-29 12:00 WIB

        let h = save_habit(
            &conn,
            &HabitInput {
                name: "Baca".into(),
                days: 127,
                ..Default::default()
            },
            ms("2026-09-10T00:00:00+07:00"),
            &tz,
        )
        .unwrap();

        let hist = habit_history(&conn, &h.id, "2026-09", current, &tz).unwrap();
        assert_eq!(hist.month, "2026-09");
        assert_eq!(hist.cells.len() % 7, 0);

        // 1 Sep 2026 is Tuesday. Monday (pad_start) must be Blank with day 0
        assert_eq!(hist.cells[0].day, 0);
        assert_eq!(hist.cells[0].state, DayState::Blank);

        // 1 Sep is before creation (10 Sep), so Blank
        assert_eq!(hist.cells[1].day, 1);
        assert_eq!(hist.cells[1].date, "2026-09-01");
        assert_eq!(hist.cells[1].state, DayState::Blank);

        // 30 Sep is tomorrow (future)
        let cell_30 = hist.cells.iter().find(|c| c.day == 30).unwrap();
        assert_eq!(cell_30.date, "2026-09-30");
        assert_eq!(cell_30.state, DayState::Future);

        // Trailing cells must be Blank
        let last = hist.cells.last().unwrap();
        assert_eq!(last.day, 0);
        assert_eq!(last.state, DayState::Blank);
    }

    #[test]
    fn habit_input_is_validated() {
        let conn = open_in_memory();
        let tz = jakarta();
        let current = now();

        for bad_name in ["", "   "] {
            let res = save_habit(
                &conn,
                &HabitInput {
                    name: bad_name.into(),
                    days: 127,
                    ..Default::default()
                },
                current,
                &tz,
            );
            assert!(matches!(res, Err(AppError::Invalid(_))));
        }

        for bad_days in [0, 128] {
            let res = save_habit(
                &conn,
                &HabitInput {
                    name: "Valid".into(),
                    days: bad_days,
                    ..Default::default()
                },
                current,
                &tz,
            );
            assert!(matches!(res, Err(AppError::Invalid(_))));
        }

        for bad_time in ["25:00", "7:5", "12:60", "abc"] {
            let res = save_habit(
                &conn,
                &HabitInput {
                    name: "Valid".into(),
                    days: 127,
                    remind_at: Some(bad_time.into()),
                    ..Default::default()
                },
                current,
                &tz,
            );
            assert!(matches!(res, Err(AppError::Invalid(_))));
        }
    }

    #[test]
    fn due_reminders_after_the_time_only() {
        let conn = open_in_memory();
        let tz = jakarta();
        let current = now(); // Tuesday 2026-09-29 12:00 WIB

        let h1 = save_habit(
            &conn,
            &HabitInput {
                name: "Pagi".into(),
                days: 127,
                remind_at: Some("06:30".into()),
                remind_on: true,
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();

        let _h2 = save_habit(
            &conn,
            &HabitInput {
                name: "Malam".into(),
                days: 127,
                remind_at: Some("18:00".into()),
                remind_on: true,
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();

        let h3 = save_habit(
            &conn,
            &HabitInput {
                name: "Sudah".into(),
                days: 127,
                remind_at: Some("06:30".into()),
                remind_on: true,
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();
        check_habit(&conn, &h3.id, true, current, &tz).unwrap();

        let _h4 = save_habit(
            &conn,
            &HabitInput {
                name: "Mati".into(),
                days: 127,
                remind_at: Some("06:30".into()),
                remind_on: false,
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();

        let due = due_reminders(&conn, current, &tz).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, h1.id);
        assert_eq!(due[0].name, "Pagi");
        assert_eq!(due[0].remind_at, "06:30");
    }

    #[test]
    fn deleted_habits_are_left_out() {
        let conn = open_in_memory();
        let tz = jakarta();
        let current = now();

        let h = save_habit(
            &conn,
            &HabitInput {
                name: "Olahraga".into(),
                days: 127,
                remind_at: Some("06:30".into()),
                remind_on: true,
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();

        delete_habit(&conn, &h.id, current).unwrap();

        let ov = habits_overview(&conn, current, &tz).unwrap();
        assert!(ov.habits.is_empty());
        assert_eq!(ov.today_total, 0);

        assert!(matches!(habit_history(&conn, &h.id, "2026-09", current, &tz), Err(AppError::NotFound)));
        assert!(matches!(check_habit(&conn, &h.id, true, current, &tz), Err(AppError::NotFound)));
        assert!(due_reminders(&conn, current, &tz).unwrap().is_empty());
    }
}
