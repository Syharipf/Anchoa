//! Journal entries with kind, mood, tags, and trend (spec Fase 4 §3-4).
use std::collections::HashMap;

use jiff::civil::Date;
use jiff::tz::TimeZone;
use jiff::{Timestamp, ToSpan};
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Deserializer, Serialize};

use crate::error::AppError;
use crate::habits;
use crate::items;
use crate::tasks::TaskStatus;
use crate::time::{
    day_bounds, indonesian_long_month, indonesian_long_weekday, indonesian_short_month,
    indonesian_short_weekday, local_date,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    Idea,
    Vent,
    #[default]
    Note,
}

impl ToSql for EntryKind {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(match self {
            EntryKind::Idea => "idea",
            EntryKind::Vent => "vent",
            EntryKind::Note => "note",
        }
        .into())
    }
}

impl FromSql for EntryKind {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "idea" => Ok(EntryKind::Idea),
            "vent" => Ok(EntryKind::Vent),
            "note" => Ok(EntryKind::Note),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrySummary {
    pub id: String,
    pub kind: EntryKind,
    pub title: String,
    pub preview: String,
    pub mood: Option<i8>,
    pub created_at: i64,
    pub time: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub kind: EntryKind,
    pub title: String,
    pub body: String,
    pub mood: Option<i8>,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub when: String,
    pub task_id: Option<String>,
    pub pinned: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub key: String,
    pub label: String,
    pub entries: Vec<EntrySummary>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalList {
    pub groups: Vec<Group>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    pub query: Option<String>,
    pub kind: Option<EntryKind>,
    pub tag: Option<String>,
    pub mood: Option<i8>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryPatch {
    pub kind: Option<EntryKind>,
    #[serde(default, deserialize_with = "present_mood")]
    pub mood: Option<Option<i8>>,
    pub tags: Option<String>,
    pub pinned: Option<bool>,
}

fn present_mood<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<i8>>, D::Error> {
    Option::<i8>::deserialize(d).map(Some)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendDay {
    pub date: String,
    pub mood: Option<i8>,
    pub wrote: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Side {
    pub trend: Vec<TrendDay>,
    pub write_days: i64,
    pub ideas: Vec<EntrySummary>,
}

pub fn format_time(created_at: i64, now: i64, tz: &TimeZone) -> Result<String, AppError> {
    let entry_zoned = Timestamp::from_millisecond(created_at)?.to_zoned(tz.clone());
    let today = local_date(now, tz)?;
    let entry_date = entry_zoned.date();
    let hour = entry_zoned.hour();
    let minute = entry_zoned.minute();

    if entry_date >= today {
        Ok(format!("{hour:02}.{minute:02}"))
    } else {
        let days = today.since(entry_date).map(|s| s.get_days()).unwrap_or(0);
        if (1..=6).contains(&days) {
            let short_day = indonesian_short_weekday(entry_date.weekday());
            Ok(format!("{short_day} {hour:02}.{minute:02}"))
        } else {
            let short_month = indonesian_short_month(entry_date.month());
            Ok(format!("{} {short_month}", entry_date.day()))
        }
    }
}

pub fn format_when(created_at: i64, tz: &TimeZone) -> Result<String, AppError> {
    let entry_zoned = Timestamp::from_millisecond(created_at)?.to_zoned(tz.clone());
    let entry_date = entry_zoned.date();
    let long_day = indonesian_long_weekday(entry_date.weekday());
    let short_month = indonesian_short_month(entry_date.month());
    let hour = entry_zoned.hour();
    let minute = entry_zoned.minute();
    Ok(format!("{long_day}, {} {short_month} · {hour:02}.{minute:02}", entry_date.day()))
}

pub fn normalize_tags(raw: &str) -> Result<String, AppError> {
    let mut normalized = Vec::new();
    for token in raw.split_whitespace() {
        let tag = token.strip_prefix('#').unwrap_or(token);
        if tag.is_empty() {
            continue;
        }
        for c in tag.chars() {
            if !c.is_ascii_alphanumeric() && c != '-' {
                return Err(AppError::Invalid(format!("Tag hanya boleh huruf, angka, dan -: {token}")));
            }
        }
        let lower = tag.to_ascii_lowercase();
        if !normalized.contains(&lower) {
            normalized.push(lower);
        }
    }
    Ok(normalized.join(" "))
}

pub fn journal_entry(conn: &Connection, id: &str, _now: i64, tz: &TimeZone) -> Result<Entry, AppError> {
    let row = conn
        .query_row(
            "SELECT i.id, i.title, i.body, i.created_at, j.kind, j.mood, j.tags, j.task_id, COALESCE(j.pinned, 0)
             FROM items i
             LEFT JOIN journal_entries j ON j.item_id = i.id
             WHERE i.id = ?1 AND i.type = 'note' AND i.deleted_at IS NULL",
            [id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, Option<EntryKind>>(4)?,
                    r.get::<_, Option<i8>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                    r.get::<_, Option<String>>(7)?,
                    r.get::<_, i64>(8)?,
                ))
            },
        )
        .optional()?;

    let Some((id, title, body, created_at, kind, mood, tags_str, task_id, pinned)) = row else {
        return Err(AppError::NotFound);
    };

    let kind = kind.unwrap_or(EntryKind::Note);
    let tags = match tags_str {
        Some(s) if !s.trim().is_empty() => s.split_whitespace().map(String::from).collect(),
        _ => Vec::new(),
    };
    let when = format_when(created_at, tz)?;

    Ok(Entry {
        id,
        kind,
        title,
        body,
        mood,
        tags,
        created_at,
        when,
        task_id,
        pinned: pinned != 0,
    })
}

pub fn create_entry(
    conn: &Connection,
    kind: EntryKind,
    title: Option<&str>,
    now: i64,
    tz: &TimeZone,
) -> Result<Entry, AppError> {
    let title_str = title.unwrap_or("").trim();
    let id = items::insert(conn, "note", title_str, "", now)?;
    conn.execute(
        "INSERT INTO journal_entries (item_id, kind, mood, tags, task_id) VALUES (?1, ?2, NULL, '', NULL)",
        params![id, kind],
    )?;
    journal_entry(conn, &id, now, tz)
}

pub fn update_entry(
    conn: &Connection,
    id: &str,
    patch: &EntryPatch,
    now: i64,
    tz: &TimeZone,
) -> Result<Entry, AppError> {
    if let Some(Some(m)) = patch.mood
        && !(1..=5).contains(&m)
    {
        return Err(AppError::Invalid(format!("Suasana hati harus antara 1 dan 5: {m}")));
    }

    let normalized_tags = match &patch.tags {
        Some(raw) => Some(normalize_tags(raw)?),
        None => None,
    };

    if !note_exists(conn, id, false)? {
        return Err(AppError::NotFound);
    }

    conn.execute(
        "INSERT INTO journal_entries (item_id, kind, mood, tags) VALUES (?1, 'note', NULL, '')
         ON CONFLICT(item_id) DO NOTHING",
        [id],
    )?;

    if let Some(k) = patch.kind {
        conn.execute("UPDATE journal_entries SET kind = ?1 WHERE item_id = ?2", params![k, id])?;
    }
    if let Some(m) = patch.mood {
        conn.execute("UPDATE journal_entries SET mood = ?1 WHERE item_id = ?2", params![m, id])?;
    }
    if let Some(tags) = normalized_tags {
        conn.execute("UPDATE journal_entries SET tags = ?1 WHERE item_id = ?2", params![tags, id])?;
    }
    if let Some(pinned) = patch.pinned {
        conn.execute("UPDATE journal_entries SET pinned = ?1 WHERE item_id = ?2", params![pinned, id])?;
    }

    conn.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![id, now])?;

    journal_entry(conn, id, now, tz)
}

fn note_exists(conn: &Connection, id: &str, include_deleted: bool) -> Result<bool, AppError> {
    let sql = if include_deleted {
        "SELECT 1 FROM items WHERE id = ?1 AND type = 'note'"
    } else {
        "SELECT 1 FROM items WHERE id = ?1 AND type = 'note' AND deleted_at IS NULL"
    };
    Ok(conn.query_row(sql, [id], |_| Ok(())).optional()?.is_some())
}

/// Soft delete (V1). Tasks made from ideas and habit checks stay (V2).
pub fn delete_entry(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    if !note_exists(conn, id, false)? {
        return Err(AppError::NotFound);
    }
    conn.execute(
        "UPDATE items SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    Ok(())
}

/// Undo for `delete_entry`; a live entry is left alone.
pub fn restore_entry(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    if !note_exists(conn, id, true)? {
        return Err(AppError::NotFound);
    }
    conn.execute(
        "UPDATE items SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NOT NULL",
        params![id, now],
    )?;
    Ok(())
}

pub fn entry_to_task(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<Entry, AppError> {
    let entry = journal_entry(conn, id, now, tz)?;
    if entry.kind != EntryKind::Idea {
        return Err(AppError::Invalid("Hanya entri Ide yang dapat dijadikan tugas".into()));
    }
    if entry.task_id.is_some() {
        return Err(AppError::Invalid("Entri ini sudah dijadikan tugas".into()));
    }

    let task_title = if entry.title.trim().is_empty() { "Ide".to_string() } else { entry.title.clone() };
    let task_body = if entry.body.trim().is_empty() {
        format!("Dari ide: {task_title}")
    } else {
        format!("Dari ide: {task_title}\n\n{}", entry.body)
    };

    let tx = conn.unchecked_transaction()?;
    let task_id = items::insert(&tx, "task", &task_title, &task_body, now)?;
    tx.execute("INSERT INTO tasks (item_id, status) VALUES (?1, ?2)", params![task_id, TaskStatus::Plan])?;
    tx.execute("UPDATE journal_entries SET task_id = ?1 WHERE item_id = ?2", params![task_id, id])?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![id, now])?;
    tx.commit()?;

    journal_entry(conn, id, now, tz)
}

pub fn journal_list(
    conn: &Connection,
    query: &ListQuery,
    now: i64,
    tz: &TimeZone,
) -> Result<Vec<Group>, AppError> {
    let mut sql = String::from(
        "SELECT i.id, i.title, i.body, i.created_at, j.kind, j.mood, COALESCE(j.pinned, 0)
         FROM items i
         LEFT JOIN journal_entries j ON j.item_id = i.id
         WHERE i.type = 'note' AND i.deleted_at IS NULL",
    );
    let mut params_vec: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(kind) = query.kind {
        sql.push_str(" AND COALESCE(j.kind, 'note') = ?");
        params_vec.push(match kind {
            EntryKind::Idea => "idea".to_string().into(),
            EntryKind::Vent => "vent".to_string().into(),
            EntryKind::Note => "note".to_string().into(),
        });
    }

    if let Some(mood) = query.mood {
        if !(1..=5).contains(&mood) {
            return Err(AppError::Invalid(format!("Suasana hati harus antara 1 dan 5: {mood}")));
        }
        sql.push_str(" AND j.mood = ?");
        params_vec.push(i64::from(mood).into());
    }
    if let Some(raw) = &query.tag {
        let tag = normalize_tags(raw)?;
        if tag.is_empty() || tag.contains(' ') {
            return Err(AppError::Invalid("Saring satu tag saja".into()));
        }
        // Padding matches whole space-separated tags, so kerja excludes kerjaan.
        sql.push_str(" AND (' ' || COALESCE(j.tags, '') || ' ') LIKE ?");
        params_vec.push(format!("% {tag} %").into());
    }

    if let Some(ref q) = query.query {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            sql.push_str(" AND (LOWER(i.title) LIKE ? OR LOWER(i.body) LIKE ?)");
            let pattern = format!("%{}%", trimmed.to_lowercase());
            params_vec.push(pattern.clone().into());
            params_vec.push(pattern.into());
        }
    }

    sql.push_str(" ORDER BY COALESCE(j.pinned, 0) DESC, i.created_at DESC, i.id DESC");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(params_vec), |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, Option<EntryKind>>(4)?,
            r.get::<_, Option<i8>>(5)?,
            r.get::<_, i64>(6)?,
        ))
    })?;

    let today = local_date(now, tz)?;
    let mut groups: Vec<Group> = Vec::new();

    for row in rows {
        let (id, title, body, created_at, kind, mood, pinned) = row?;
        let entry_zoned = Timestamp::from_millisecond(created_at)?.to_zoned(tz.clone());
        let entry_date = entry_zoned.date();
        let diff_days = today.since(entry_date).map(|s| s.get_days()).unwrap_or(0);

        let (group_key, group_label) = if pinned != 0 {
            ("pinned".to_string(), "Disematkan".to_string())
        } else if diff_days <= 0 {
            ("today".to_string(), "Hari ini".to_string())
        } else if diff_days == 1 {
            ("yesterday".to_string(), "Kemarin".to_string())
        } else if diff_days <= 6 {
            ("last7".to_string(), "7 hari terakhir".to_string())
        } else {
            (
                format!("{}-{:02}", entry_date.year(), entry_date.month()),
                format!("{} {}", indonesian_long_month(entry_date.month()), entry_date.year()),
            )
        };

        let summary = EntrySummary {
            id,
            kind: kind.unwrap_or(EntryKind::Note),
            title,
            preview: body.trim().to_string(),
            mood,
            created_at,
            time: format_time(created_at, now, tz)?,
        };

        if let Some(last) = groups.last_mut()
            && last.key == group_key
        {
            last.entries.push(summary);
        } else {
            groups.push(Group {
                key: group_key,
                label: group_label,
                entries: vec![summary],
            });
        }
    }

    Ok(groups)
}

pub fn journal_side(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Side, AppError> {
    let today = local_date(now, tz)?;

    let mut trend = Vec::with_capacity(30);
    for offset in (0..30).rev() {
        let date = today.checked_sub(offset.days())?;
        trend.push(TrendDay {
            date: date.to_string(),
            mood: None,
            wrote: false,
        });
    }

    let mut stmt = conn.prepare(
        "SELECT i.created_at, j.mood
         FROM items i
         LEFT JOIN journal_entries j ON j.item_id = i.id
         WHERE i.type = 'note' AND i.deleted_at IS NULL",
    )?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<i8>>(1)?)))?;

    let mut day_data: HashMap<Date, (usize, Vec<i8>)> = HashMap::new();
    for row in rows {
        let (created_at, mood) = row?;
        if let Ok(d) = local_date(created_at, tz) {
            let entry = day_data.entry(d).or_insert((0, Vec::new()));
            entry.0 += 1;
            if let Some(m) = mood {
                entry.1.push(m);
            }
        }
    }

    let mut write_days = 0;
    for day in &mut trend {
        if let Ok(d) = day.date.parse::<Date>()
            && let Some((count, moods)) = day_data.get(&d)
        {
            if *count > 0 {
                day.wrote = true;
                write_days += 1;
            }
            if !moods.is_empty() {
                let sum: i64 = moods.iter().map(|&m| m as i64).sum();
                let avg = ((sum as f64) / (moods.len() as f64)).round() as i8;
                day.mood = Some(avg.clamp(1, 5));
            }
        }
    }

    let mut ideas_stmt = conn.prepare(
        "SELECT i.id, i.title, i.body, i.created_at, j.kind, j.mood
         FROM items i
         JOIN journal_entries j ON j.item_id = i.id
         WHERE i.type = 'note' AND i.deleted_at IS NULL
           AND j.kind = 'idea' AND j.task_id IS NULL
         ORDER BY i.created_at DESC, i.id DESC
         LIMIT 5",
    )?;
    let idea_rows = ideas_stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, EntryKind>(4)?,
            r.get::<_, Option<i8>>(5)?,
        ))
    })?;

    let mut ideas = Vec::new();
    for row in idea_rows {
        let (id, title, body, created_at, kind, mood) = row?;
        ideas.push(EntrySummary {
            id,
            kind,
            title,
            preview: body.trim().to_string(),
            mood,
            created_at,
            time: format_time(created_at, now, tz)?,
        });
    }

    Ok(Side {
        trend,
        write_days,
        ideas,
    })
}

pub fn after_note_saved(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<(), AppError> {
    let item = match items::get(conn, id) {
        Ok(it) => it,
        Err(AppError::NotFound) => return Ok(()),
        Err(e) => return Err(e),
    };
    if item.kind == "note" && !item.body.trim().is_empty() {
        habits::auto_check_journal(conn, now, tz)?;
    }
    Ok(())
}

/// True when the journal reminder should fire: notifications on, past the
/// configured hour, not dismissed today, and no note created today.
pub fn due_reminder(conn: &Connection, now: i64, tz: &TimeZone) -> Result<bool, AppError> {
    let prefs = crate::profile::notify_prefs(conn)?;
    if !prefs.journal {
        return Ok(false);
    }
    let zoned = Timestamp::from_millisecond(now)?.to_zoned(tz.clone());
    let current_time = zoned.strftime("%H:%M").to_string();
    if current_time.as_str() < prefs.journal_at.as_str() {
        return Ok(false);
    }
    let today_str = local_date(now, tz)?.to_string();
    let dismissed: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'notify.journal_dismissed'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    if dismissed.as_deref() == Some(today_str.as_str()) {
        return Ok(false);
    }
    let (start, end) = day_bounds(now, tz)?;
    let has_entry: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM items WHERE deleted_at IS NULL AND type = 'note' AND created_at >= ?1 AND created_at < ?2)",
        params![start, end],
        |r| r.get(0),
    )?;
    if has_entry {
        return Ok(false);
    }
    Ok(true)
}

/// Dismiss the journal reminder for today.
pub fn dismiss_reminder(conn: &Connection, now: i64, tz: &TimeZone) -> Result<(), AppError> {
    let today_str = local_date(now, tz)?.to_string();
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('notify.journal_dismissed', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![today_str],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::finance::testing::{jakarta, ms, now};
    use crate::habits::HabitInput;

    #[test]
    fn delete_hides_entry_and_restore_brings_it_back() {
        let conn = open_in_memory();
        let tz = jakarta();
        let t = now();
        let e = create_entry(&conn, EntryKind::Note, Some("Hapus aku"), t, &tz).unwrap();

        delete_entry(&conn, &e.id, t + 1).unwrap();
        assert!(matches!(journal_entry(&conn, &e.id, t, &tz), Err(AppError::NotFound)));
        let groups = journal_list(&conn, &ListQuery::default(), t, &tz).unwrap();
        assert!(groups.iter().all(|g| g.entries.iter().all(|x| x.id != e.id)));
        let timestamps = || {
            conn.query_row("SELECT deleted_at, updated_at FROM items WHERE id = ?1", [&e.id], |r| {
                Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, i64>(1)?))
            }).unwrap()
        };
        assert_eq!(timestamps(), (Some(t + 1), t + 1));
        assert!(matches!(delete_entry(&conn, &e.id, t + 2), Err(AppError::NotFound)));
        assert_eq!(timestamps(), (Some(t + 1), t + 1));

        restore_entry(&conn, &e.id, t + 2).unwrap();
        assert_eq!(journal_entry(&conn, &e.id, t, &tz).unwrap().title, "Hapus aku");
        assert_eq!(timestamps(), (None, t + 2));
        let groups = journal_list(&conn, &ListQuery::default(), t, &tz).unwrap();
        assert_eq!(groups[0].entries[0].id, e.id);
        restore_entry(&conn, &e.id, t + 3).unwrap();
        assert_eq!(timestamps(), (None, t + 2));
    }

    #[test]
    fn delete_rejects_unknown_and_non_note_items() {
        let conn = open_in_memory();
        let t = now();
        assert!(matches!(delete_entry(&conn, "missing", t), Err(AppError::NotFound)));
        assert!(matches!(restore_entry(&conn, "missing", t), Err(AppError::NotFound)));
        for kind in ["task", "page", "habit"] {
            let id = items::insert(&conn, kind, "Item lain", "", t).unwrap();
            assert!(matches!(delete_entry(&conn, &id, t + 1), Err(AppError::NotFound)));
            assert!(matches!(restore_entry(&conn, &id, t + 1), Err(AppError::NotFound)));
            assert_eq!(items::get(&conn, &id).unwrap().updated_at, t);
            items::delete(&conn, &id, t + 1).unwrap();
            assert!(matches!(restore_entry(&conn, &id, t + 2), Err(AppError::NotFound)));
            assert!(matches!(items::get(&conn, &id), Err(AppError::NotFound)));
        }
    }

    #[test]
    fn delete_keeps_task_made_from_idea() {
        let conn = open_in_memory();
        let tz = jakarta();
        let t = now();
        let idea = create_entry(&conn, EntryKind::Idea, Some("Ide"), t, &tz).unwrap();
        let task_id = entry_to_task(&conn, &idea.id, t, &tz).unwrap().task_id.unwrap();
        delete_entry(&conn, &idea.id, t + 1).unwrap();
        assert_eq!(items::get(&conn, &task_id).unwrap().updated_at, t);
        restore_entry(&conn, &idea.id, t + 2).unwrap();
        assert_eq!(journal_entry(&conn, &idea.id, t, &tz).unwrap().task_id.as_deref(), Some(task_id.as_str()));
        assert!(matches!(entry_to_task(&conn, &idea.id, t + 3, &tz), Err(AppError::Invalid(_))));
    }

    #[test]
    fn pinned_entries_come_first_in_their_own_group() {
        let conn = open_in_memory();
        let tz = jakarta();
        let t = now();
        let a = create_entry(&conn, EntryKind::Note, Some("Lama"), t - 3 * 86_400_000, &tz).unwrap();
        let b = create_entry(&conn, EntryKind::Note, Some("Baru"), t, &tz).unwrap();
        assert!(!a.pinned);
        let patch = EntryPatch { pinned: Some(true), ..Default::default() };
        assert!(update_entry(&conn, &a.id, &patch, t, &tz).unwrap().pinned);

        let groups = journal_list(&conn, &ListQuery::default(), t, &tz).unwrap();
        assert_eq!(groups[0].key, "pinned");
        assert_eq!(groups[0].label, "Disematkan");
        assert_eq!(groups[0].entries.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), vec![a.id.as_str()]);
        assert!(groups[1..].iter().all(|g| g.entries.iter().all(|e| e.id != a.id)));
        assert!(groups[1..].iter().any(|g| g.entries.iter().any(|e| e.id == b.id)));

        update_entry(&conn, &b.id, &patch, t, &tz).unwrap();
        let groups = journal_list(&conn, &ListQuery::default(), t, &tz).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].entries.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), [b.id.as_str(), a.id.as_str()]);

        let patch = EntryPatch { pinned: Some(false), ..Default::default() };
        assert!(!update_entry(&conn, &a.id, &patch, t + 1, &tz).unwrap().pinned);
        update_entry(&conn, &b.id, &patch, t + 1, &tz).unwrap();
        let groups = journal_list(&conn, &ListQuery::default(), t, &tz).unwrap();
        assert_eq!(groups.iter().map(|g| g.key.as_str()).collect::<Vec<_>>(), ["today", "last7"]);
    }

    #[test]
    fn list_filters_by_tag_and_mood() {
        let conn = open_in_memory();
        let tz = jakarta();
        let t = now();
        let a = create_entry(&conn, EntryKind::Note, Some("A"), t, &tz).unwrap();
        let b = create_entry(&conn, EntryKind::Note, Some("B"), t, &tz).unwrap();
        let c = create_entry(&conn, EntryKind::Note, Some("C"), t, &tz).unwrap();
        let tag = |s: &str, m: i8| EntryPatch { tags: Some(s.into()), mood: Some(Some(m)), ..Default::default() };
        update_entry(&conn, &a.id, &tag("kerja rumah", 4), t, &tz).unwrap();
        update_entry(&conn, &b.id, &tag("kerjaan", 4), t, &tz).unwrap();
        update_entry(&conn, &c.id, &tag("kerja", 2), t, &tz).unwrap();

        let ids = |q: ListQuery| -> Vec<String> {
            let mut v: Vec<String> = journal_list(&conn, &q, t, &tz).unwrap()
                .into_iter().flat_map(|g| g.entries).map(|e| e.id).collect();
            v.sort();
            v
        };
        let mut want = vec![a.id.clone(), c.id.clone()];
        want.sort();
        assert_eq!(ids(ListQuery { tag: Some("#Kerja".into()), ..Default::default() }), want);
        assert_eq!(ids(ListQuery { tag: Some("rumah".into()), ..Default::default() }), vec![a.id.clone()]);
        assert_eq!(ids(ListQuery { tag: Some("kerja".into()), mood: Some(4), ..Default::default() }), vec![a.id.clone()]);
        for mood in [0, 6, 9] {
            assert!(matches!(journal_list(&conn, &ListQuery { mood: Some(mood), ..Default::default() }, t, &tz), Err(AppError::Invalid(_))));
        }
        for tag in ["", "#", "dua kata", "%", "ker_ja", "kerja'"] {
            assert!(matches!(journal_list(&conn, &ListQuery { tag: Some(tag.into()), ..Default::default() }, t, &tz), Err(AppError::Invalid(_))));
        }
    }

    #[test]
    fn list_combines_all_filters_including_pinned_entries() {
        let conn = open_in_memory();
        let tz = jakarta();
        let t = now();
        let patch = EntryPatch { tags: Some("kerja".into()), mood: Some(Some(4)), pinned: Some(true), ..Default::default() };
        let mut matching = Vec::new();
        for (kind, title) in [(EntryKind::Idea, "Kopi lama"), (EntryKind::Vent, "Kopi curhat"), (EntryKind::Idea, "Teh"), (EntryKind::Idea, "Kopi baru")] {
            let entry = create_entry(&conn, kind, Some(title), t, &tz).unwrap();
            update_entry(&conn, &entry.id, &patch, t, &tz).unwrap();
            if kind == EntryKind::Idea && title.starts_with("Kopi") {
                matching.push(entry.id);
            }
        }
        let query = ListQuery { query: Some("KOPI".into()), kind: Some(EntryKind::Idea), tag: Some("#Kerja".into()), mood: Some(4) };
        let groups = journal_list(&conn, &query, t, &tz).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].key, "pinned");
        matching.reverse();
        assert_eq!(groups[0].entries.iter().map(|e| &e.id).collect::<Vec<_>>(), matching.iter().collect::<Vec<_>>());
        let no_match = ListQuery { mood: Some(1), ..query };
        assert!(journal_list(&conn, &no_match, t, &tz).unwrap().is_empty());
    }

    #[test]
    fn deleting_journal_keeps_habit_checks_and_deleted_notes_cannot_check_habits() {
        let conn = open_in_memory();
        let tz = jakarta();
        let t = now();
        let habit = habits::save_habit(&conn, &HabitInput { name: "Jurnal".into(), days: 127, auto_journal: true, ..Default::default() }, t, &tz).unwrap();
        let entry = create_entry(&conn, EntryKind::Note, Some("Refleksi"), t, &tz).unwrap();
        items::update(&conn, &entry.id, &items::ItemPatch { body: Some("Isi refleksi".into()), ..Default::default() }, t).unwrap();
        after_note_saved(&conn, &entry.id, t, &tz).unwrap();
        assert!(habits::habits_overview(&conn, t, &tz).unwrap().habits[0].done_today);

        delete_entry(&conn, &entry.id, t + 1).unwrap();
        assert!(habits::habits_overview(&conn, t, &tz).unwrap().habits[0].done_today);
        habits::check_habit(&conn, &habit.id, false, t + 2, &tz).unwrap();
        after_note_saved(&conn, &entry.id, t + 3, &tz).unwrap();
        assert!(!habits::habits_overview(&conn, t, &tz).unwrap().habits[0].done_today);
        restore_entry(&conn, &entry.id, t + 4).unwrap();
        assert!(!habits::habits_overview(&conn, t, &tz).unwrap().habits[0].done_today);
        after_note_saved(&conn, &entry.id, t + 5, &tz).unwrap();
        assert!(habits::habits_overview(&conn, t, &tz).unwrap().habits[0].done_today);
    }

    #[test]
    fn old_notes_are_journal_notes() {
        let conn = open_in_memory();
        let tz = jakarta();
        let current = now();

        // Note inserted without any row in journal_entries (pre-v7 or bare note)
        let note_id = items::insert(&conn, "note", "Catatan lama", "Isi lama", current).unwrap();

        let entry = journal_entry(&conn, &note_id, current, &tz).unwrap();
        assert_eq!(entry.kind, EntryKind::Note);
        assert_eq!(entry.mood, None);
        assert!(!entry.pinned);
        assert!(entry.tags.is_empty());
        assert_eq!(entry.title, "Catatan lama");
        assert_eq!(entry.body, "Isi lama");

        let groups = journal_list(&conn, &ListQuery::default(), current, &tz).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].entries.len(), 1);
        assert_eq!(groups[0].entries[0].kind, EntryKind::Note);
        assert_eq!(groups[0].entries[0].title, "Catatan lama");

        update_entry(&conn, &note_id, &EntryPatch { pinned: Some(true), ..Default::default() }, current, &tz).unwrap();
        delete_entry(&conn, &note_id, current + 1).unwrap();
        restore_entry(&conn, &note_id, current + 2).unwrap();
        assert!(journal_entry(&conn, &note_id, current, &tz).unwrap().pinned);
    }

    #[test]
    fn groups_follow_local_days() {
        let conn = open_in_memory();
        let tz = jakarta();
        let current = now(); // Tuesday 2026-09-29 12:00:00+07:00

        // Today
        create_entry(&conn, EntryKind::Note, Some("Hari ini"), current, &tz).unwrap();
        // Yesterday (2026-09-28)
        create_entry(
            &conn,
            EntryKind::Idea,
            Some("Kemarin"),
            ms("2026-09-28T10:00:00+07:00"),
            &tz,
        )
        .unwrap();
        // 4 days ago (2026-09-25) -> in 7 hari terakhir
        create_entry(
            &conn,
            EntryKind::Vent,
            Some("4 hari lalu"),
            ms("2026-09-25T15:00:00+07:00"),
            &tz,
        )
        .unwrap();
        // Previous month (2026-08-15)
        create_entry(
            &conn,
            EntryKind::Note,
            Some("Bulan lalu"),
            ms("2026-08-15T08:00:00+07:00"),
            &tz,
        )
        .unwrap();

        let groups = journal_list(&conn, &ListQuery::default(), current, &tz).unwrap();
        assert_eq!(groups.len(), 4);

        assert_eq!(groups[0].key, "today");
        assert_eq!(groups[0].label, "Hari ini");
        assert_eq!(groups[0].entries[0].title, "Hari ini");

        assert_eq!(groups[1].key, "yesterday");
        assert_eq!(groups[1].label, "Kemarin");
        assert_eq!(groups[1].entries[0].title, "Kemarin");

        assert_eq!(groups[2].key, "last7");
        assert_eq!(groups[2].label, "7 hari terakhir");
        assert_eq!(groups[2].entries[0].title, "4 hari lalu");

        assert_eq!(groups[3].key, "2026-08");
        assert_eq!(groups[3].label, "Agustus 2026");
        assert_eq!(groups[3].entries[0].title, "Bulan lalu");
    }

    #[test]
    fn search_and_kind_filter() {
        let conn = open_in_memory();
        let tz = jakarta();
        let current = now();

        let e1 = create_entry(&conn, EntryKind::Idea, Some("Beli Kopi Enak"), current, &tz).unwrap();
        conn.execute("UPDATE items SET body = 'resep espresso' WHERE id = ?1", [&e1.id]).unwrap();

        let e2 = create_entry(&conn, EntryKind::Vent, Some("Hari Capek"), current, &tz).unwrap();
        conn.execute("UPDATE items SET body = 'kerjaan KOPI tumpah' WHERE id = ?1", [&e2.id]).unwrap();

        let e3 = create_entry(&conn, EntryKind::Note, Some("Catatan Belajar"), current, &tz).unwrap();
        conn.execute("UPDATE items SET body = 'baca buku' WHERE id = ?1", [&e3.id]).unwrap();

        // Search case-insensitive in title and body
        let res = journal_list(
            &conn,
            &ListQuery {
                query: Some("kopi".into()),
                kind: None,
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();
        let titles: Vec<&str> = res[0].entries.iter().map(|e| e.title.as_str()).collect();
        assert_eq!(titles, ["Hari Capek", "Beli Kopi Enak"]);

        let res_upper = journal_list(
            &conn,
            &ListQuery {
                query: Some("KOPI".into()),
                kind: None,
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();
        let titles_upper: Vec<&str> = res_upper[0].entries.iter().map(|e| e.title.as_str()).collect();
        assert_eq!(titles_upper, ["Hari Capek", "Beli Kopi Enak"]);

        // Search in body
        let res_body = journal_list(
            &conn,
            &ListQuery {
                query: Some("buku".into()),
                kind: None,
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();
        assert_eq!(res_body[0].entries[0].title, "Catatan Belajar");

        // Filter by kind
        let res_idea = journal_list(
            &conn,
            &ListQuery {
                query: None,
                kind: Some(EntryKind::Idea),
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();
        assert_eq!(res_idea[0].entries.len(), 1);
        assert_eq!(res_idea[0].entries[0].title, "Beli Kopi Enak");

        let res_vent = journal_list(
            &conn,
            &ListQuery {
                query: None,
                kind: Some(EntryKind::Vent),
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();
        assert_eq!(res_vent[0].entries.len(), 1);
        assert_eq!(res_vent[0].entries[0].title, "Hari Capek");

        let res_note = journal_list(
            &conn,
            &ListQuery {
                query: None,
                kind: Some(EntryKind::Note),
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();
        assert_eq!(res_note[0].entries.len(), 1);
        assert_eq!(res_note[0].entries[0].title, "Catatan Belajar");
    }

    #[test]
    fn update_entry_validates_and_normalises_tags() {
        let conn = open_in_memory();
        let tz = jakarta();
        let current = now();

        let e = create_entry(&conn, EntryKind::Note, Some("Test"), current, &tz).unwrap();

        // Normalise tags
        let updated = update_entry(
            &conn,
            &e.id,
            &EntryPatch {
                tags: Some("#Anchoa  kuliah".into()),
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();
        assert_eq!(updated.tags, ["anchoa", "kuliah"]);

        // "a b!" rejected
        let bad_tag = update_entry(
            &conn,
            &e.id,
            &EntryPatch {
                tags: Some("a b!".into()),
                ..Default::default()
            },
            current,
            &tz,
        );
        assert!(matches!(bad_tag, Err(AppError::Invalid(_))));

        // Mood 0 rejected
        let bad_mood_0 = update_entry(
            &conn,
            &e.id,
            &EntryPatch {
                mood: Some(Some(0)),
                ..Default::default()
            },
            current,
            &tz,
        );
        assert!(matches!(bad_mood_0, Err(AppError::Invalid(_))));

        // Mood 6 rejected
        let bad_mood_6 = update_entry(
            &conn,
            &e.id,
            &EntryPatch {
                mood: Some(Some(6)),
                ..Default::default()
            },
            current,
            &tz,
        );
        assert!(matches!(bad_mood_6, Err(AppError::Invalid(_))));

        // Valid mood 1-5
        let ok_mood = update_entry(
            &conn,
            &e.id,
            &EntryPatch {
                mood: Some(Some(4)),
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();
        assert_eq!(ok_mood.mood, Some(4));

        // Clear mood with null
        let cleared = update_entry(
            &conn,
            &e.id,
            &EntryPatch {
                mood: Some(None),
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();
        assert_eq!(cleared.mood, None);
    }

    #[test]
    fn entry_to_task_once_for_ideas() {
        let conn = open_in_memory();
        let tz = jakarta();
        let current = now();

        // Non-idea rejected
        let note = create_entry(&conn, EntryKind::Note, Some("Catatan"), current, &tz).unwrap();
        assert!(matches!(entry_to_task(&conn, &note.id, current, &tz), Err(AppError::Invalid(_))));

        let vent = create_entry(&conn, EntryKind::Vent, Some("Curhat"), current, &tz).unwrap();
        assert!(matches!(entry_to_task(&conn, &vent.id, current, &tz), Err(AppError::Invalid(_))));

        // Idea succeeds
        let idea = create_entry(&conn, EntryKind::Idea, Some("Fitur X"), current, &tz).unwrap();
        let converted = entry_to_task(&conn, &idea.id, current, &tz).unwrap();
        assert!(converted.task_id.is_some());
        let task_id = converted.task_id.as_ref().unwrap();

        // Check task is created as 'plan'
        let status: String = conn
            .query_row("SELECT status FROM tasks WHERE item_id = ?1", [task_id], |r| r.get(0))
            .unwrap();
        assert_eq!(status, "plan");

        // Second conversion fails
        assert!(matches!(entry_to_task(&conn, &idea.id, current, &tz), Err(AppError::Invalid(_))));
    }

    #[test]
    fn trend_averages_mood_per_day() {
        let conn = open_in_memory();
        let tz = jakarta();
        let current = now(); // 2026-09-29

        // Today: two entries with mood 4 and 5 -> avg 4.5 rounded to 5
        let e1 = create_entry(&conn, EntryKind::Note, Some("N1"), current, &tz).unwrap();
        update_entry(
            &conn,
            &e1.id,
            &EntryPatch {
                mood: Some(Some(4)),
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();

        let e2 = create_entry(&conn, EntryKind::Note, Some("N2"), current, &tz).unwrap();
        update_entry(
            &conn,
            &e2.id,
            &EntryPatch {
                mood: Some(Some(5)),
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();

        // Yesterday: one entry without mood -> wrote: true, mood: None
        create_entry(
            &conn,
            EntryKind::Vent,
            Some("N3"),
            ms("2026-09-28T12:00:00+07:00"),
            &tz,
        )
        .unwrap();

        let side = journal_side(&conn, current, &tz).unwrap();
        assert_eq!(side.trend.len(), 30);
        assert_eq!(side.write_days, 2);

        let today_day = side.trend.last().unwrap();
        assert_eq!(today_day.date, "2026-09-29");
        assert!(today_day.wrote);
        assert_eq!(today_day.mood, Some(5));

        let yesterday_day = &side.trend[side.trend.len() - 2];
        assert_eq!(yesterday_day.date, "2026-09-28");
        assert!(yesterday_day.wrote);
        assert_eq!(yesterday_day.mood, None);

        // Day before yesterday: no entries -> wrote: false, mood: None
        let day_before = &side.trend[side.trend.len() - 3];
        assert_eq!(day_before.date, "2026-09-27");
        assert!(!day_before.wrote);
        assert_eq!(day_before.mood, None);
    }

    #[test]
    fn ideas_leave_out_those_with_tasks() {
        let conn = open_in_memory();
        let tz = jakarta();
        let current = now();

        let i1 = create_entry(
            &conn,
            EntryKind::Idea,
            Some("Ide 1"),
            ms("2026-09-29T10:00:00+07:00"),
            &tz,
        )
        .unwrap();
        let i2 = create_entry(
            &conn,
            EntryKind::Idea,
            Some("Ide 2"),
            ms("2026-09-29T11:00:00+07:00"),
            &tz,
        )
        .unwrap();

        // Convert i2 to task
        entry_to_task(&conn, &i2.id, current, &tz).unwrap();

        let side = journal_side(&conn, current, &tz).unwrap();
        assert_eq!(side.ideas.len(), 1);
        assert_eq!(side.ideas[0].id, i1.id);
        assert_eq!(side.ideas[0].title, "Ide 1");
    }

    #[test]
    fn saving_a_note_checks_journal_habits() {
        let conn = open_in_memory();
        let tz = jakarta();
        let current = now(); // Tuesday 2026-09-29

        // Habit 1: auto_journal enabled, scheduled today
        let h1 = habits::save_habit(
            &conn,
            &HabitInput {
                name: "Jurnal Harian".into(),
                days: 127,
                auto_journal: true,
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();

        // Habit 2: auto_journal disabled, scheduled today
        let h2 = habits::save_habit(
            &conn,
            &HabitInput {
                name: "Coding".into(),
                days: 127,
                auto_journal: false,
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();

        // Habit 3: auto_journal enabled, but day off today (weekends only: days=96)
        let h3 = habits::save_habit(
            &conn,
            &HabitInput {
                name: "Jurnal Akhir Pekan".into(),
                days: 96,
                auto_journal: true,
                ..Default::default()
            },
            current,
            &tz,
        )
        .unwrap();

        // Note with empty body: does NOT check habits
        let note = items::capture_note(&conn, "Catatan kosong", current).unwrap();
        after_note_saved(&conn, &note.id, current, &tz).unwrap();

        let ov = habits::habits_overview(&conn, current, &tz).unwrap();
        let h1_row = ov.habits.iter().find(|h| h.id == h1.id).unwrap();
        assert!(!h1_row.done_today);

        // Note with non-empty body: checks h1, leaves h2 and h3 alone
        conn.execute("UPDATE items SET body = 'Menulis catatan refleksi' WHERE id = ?1", [&note.id]).unwrap();
        after_note_saved(&conn, &note.id, current, &tz).unwrap();

        let ov = habits::habits_overview(&conn, current, &tz).unwrap();
        let h1_row = ov.habits.iter().find(|h| h.id == h1.id).unwrap();
        let h2_row = ov.habits.iter().find(|h| h.id == h2.id).unwrap();
        let h3_row = ov.habits.iter().find(|h| h.id == h3.id).unwrap();

        assert!(h1_row.done_today);
        assert!(!h2_row.done_today);
        assert!(!h3_row.done_today);
    }

    #[test]
    fn time_and_when_labels() {
        let tz = jakarta();
        let current = ms("2026-09-29T12:00:00+07:00"); // Tuesday 29 Sep 2026 12:00

        // Hari ini: "21.10"
        let t_today = ms("2026-09-29T21:10:00+07:00");
        assert_eq!(format_time(t_today, current, &tz).unwrap(), "21.10");

        // 1 hari lalu (Senin): "Sen 22.05"
        let t_sen = ms("2026-09-28T22:05:00+07:00");
        assert_eq!(format_time(t_sen, current, &tz).unwrap(), "Sen 22.05");

        // 9 hari lalu (20 Sep): "20 Sep"
        let t_older = ms("2026-09-20T10:00:00+07:00");
        assert_eq!(format_time(t_older, current, &tz).unwrap(), "20 Sep");

        // when label: "Selasa, 29 Sep · 21.10"
        assert_eq!(format_when(t_today, &tz).unwrap(), "Selasa, 29 Sep · 21.10");
    }

    #[test]
    fn deleted_entries_leave_lists_search_moods_and_ideas() {
        let conn = open_in_memory();
        let tz = jakarta();
        let live = create_entry(&conn, EntryKind::Idea, Some("Ide hidup"), now(), &tz).unwrap();
        let gone = create_entry(&conn, EntryKind::Idea, Some("Ide dihapus"), now(), &tz).unwrap();
        update_entry(&conn, &live.id, &EntryPatch { mood: Some(Some(5)), ..Default::default() }, now(), &tz).unwrap();
        update_entry(&conn, &gone.id, &EntryPatch { mood: Some(Some(1)), ..Default::default() }, now(), &tz).unwrap();
        let yesterday = create_entry(&conn, EntryKind::Vent, Some("Kemarin dihapus"), ms("2026-09-28T23:59:59.999+07:00"), &tz).unwrap();
        for id in [&gone.id, &yesterday.id] {
            update_entry(&conn, id, &EntryPatch { pinned: Some(true), tags: Some("hilang".into()), ..Default::default() }, now(), &tz).unwrap();
            delete_entry(&conn, id, now()).unwrap();
            let changes = conn.total_changes();
            assert!(matches!(journal_entry(&conn, id, now(), &tz), Err(AppError::NotFound)));
            assert!(matches!(update_entry(&conn, id, &EntryPatch { pinned: Some(false), kind: Some(EntryKind::Note), mood: Some(Some(3)), tags: Some("diubah".into()) }, now(), &tz), Err(AppError::NotFound)));
            assert!(matches!(items::update(&conn, id, &items::ItemPatch { title: Some("Diubah".into()), body: Some("Isi diubah".into()), ..Default::default() }, now()), Err(AppError::NotFound)));
            assert!(matches!(entry_to_task(&conn, id, now(), &tz), Err(AppError::NotFound)));
            assert_eq!(conn.total_changes(), changes);
        }
        let groups = journal_list(&conn, &ListQuery::default(), now(), &tz).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].entries.iter().map(|entry| entry.id.as_str()).collect::<Vec<_>>(), [live.id.as_str()]);
        for kind in [None, Some(EntryKind::Idea), Some(EntryKind::Vent)] {
            let query = ListQuery { query: Some("dihapus".into()), kind, ..Default::default() };
            assert!(journal_list(&conn, &query, now(), &tz).unwrap().is_empty());
        }
        for query in [ListQuery { tag: Some("hilang".into()), ..Default::default() }, ListQuery { mood: Some(1), ..Default::default() }] {
            assert!(journal_list(&conn, &query, now(), &tz).unwrap().is_empty());
        }
        assert_eq!(items::list_inbox(&conn).unwrap().iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), [live.id.as_str()]);
        assert!(crate::search::search(&conn, "dihapus", false, 50).unwrap().is_empty());
        let side = journal_side(&conn, now(), &tz).unwrap();
        assert_eq!(side.write_days, 1);
        assert_eq!(side.trend.last().unwrap().mood, Some(5));
        assert!(!side.trend[28].wrote);
        assert_eq!(side.ideas.iter().map(|entry| entry.id.as_str()).collect::<Vec<_>>(), [live.id.as_str()]);
    }

    #[test]
    fn journal_groups_and_trend_cross_jakarta_midnight_together() {
        let conn = open_in_memory();
        let tz = jakarta();
        let midnight = ms("2026-10-01T00:00:00+07:00");
        let before = create_entry(&conn, EntryKind::Note, Some("Sebelum"), midnight - 1, &tz).unwrap();
        let after = create_entry(&conn, EntryKind::Note, Some("Sesudah"), midnight, &tz).unwrap();
        let groups = journal_list(&conn, &ListQuery::default(), midnight, &tz).unwrap();
        assert_eq!(groups.iter().map(|group| (group.key.as_str(), group.entries[0].id.as_str())).collect::<Vec<_>>(), [("today", after.id.as_str()), ("yesterday", before.id.as_str())]);
        let side = journal_side(&conn, midnight, &tz).unwrap();
        assert_eq!(side.trend[28].date, "2026-09-30");
        assert_eq!(side.trend[29].date, "2026-10-01");
        assert_eq!(side.write_days, 2);
    }

    #[test]
    fn journal_reminder_deduplication_and_day_rollover() {
        let conn = open_in_memory();
        let tz = jakarta();

        // Enable journal reminders at 20:00.
        let prefs = crate::profile::NotifyPrefs {
            task: true, bill: true, budget: true, habit: true,
            journal: true, journal_at: "20:00".into(),
        };
        crate::profile::set_notify_prefs(&conn, &prefs).unwrap();

        // Before 20:00 → no reminder.
        let before_time = ms("2026-09-29T19:59:00+07:00");
        assert!(!due_reminder(&conn, before_time, &tz).unwrap());

        // At 20:00 → reminder fires.
        let at_time = ms("2026-09-29T20:00:00+07:00");
        assert!(due_reminder(&conn, at_time, &tz).unwrap());

        // Repeated call same time → still true (idempotent).
        assert!(due_reminder(&conn, at_time, &tz).unwrap());

        // Dismiss → no reminder.
        dismiss_reminder(&conn, at_time, &tz).unwrap();
        assert!(!due_reminder(&conn, at_time, &tz).unwrap());

        // Later same day → still dismissed.
        let later = ms("2026-09-29T23:00:00+07:00");
        assert!(!due_reminder(&conn, later, &tz).unwrap());

        // Next day at 20:00 → reminder fires again (day rollover).
        let next_day = ms("2026-09-30T20:00:00+07:00");
        assert!(due_reminder(&conn, next_day, &tz).unwrap());

        // Creating a note today suppresses reminder.
        create_entry(&conn, EntryKind::Note, Some("Jurnal hari ini"), next_day, &tz).unwrap();
        assert!(!due_reminder(&conn, next_day, &tz).unwrap());

        // Disabled → no reminder.
        let off = crate::profile::NotifyPrefs { journal: false, ..prefs };
        crate::profile::set_notify_prefs(&conn, &off).unwrap();
        let day3 = ms("2026-10-01T20:00:00+07:00");
        assert!(!due_reminder(&conn, day3, &tz).unwrap());
    }
}
