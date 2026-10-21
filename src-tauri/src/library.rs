//! Library media tracker: film, series, anime, book, manga (spec 2026-10-21).
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::time::{self, day_bounds, month_bounds};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Film,
    Series,
    Anime,
    Book,
    Manga,
}

impl MediaKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Film => "film",
            Self::Series => "series",
            Self::Anime => "anime",
            Self::Book => "book",
            Self::Manga => "manga",
        }
    }
}

impl TryFrom<&str> for MediaKind {
    type Error = AppError;

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s {
            "film" => Ok(Self::Film),
            "series" => Ok(Self::Series),
            "anime" => Ok(Self::Anime),
            "book" => Ok(Self::Book),
            "manga" => Ok(Self::Manga),
            _ => Err(AppError::Invalid(format!("Jenis media tidak valid: {s}"))),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaStatus {
    Want,
    Active,
    Finished,
    Dropped,
}

impl MediaStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Want => "want",
            Self::Active => "active",
            Self::Finished => "finished",
            Self::Dropped => "dropped",
        }
    }
}

impl TryFrom<&str> for MediaStatus {
    type Error = AppError;

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s {
            "want" => Ok(Self::Want),
            "active" => Ok(Self::Active),
            "finished" => Ok(Self::Finished),
            "dropped" => Ok(Self::Dropped),
            _ => Err(AppError::Invalid(format!("Status media tidak valid: {s}"))),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInput {
    pub id: Option<String>,
    pub title: String,
    pub body: String,
    pub kind: MediaKind,
    pub status: MediaStatus,
    pub progress: Option<i64>,
    pub progress_total: Option<i64>,
    pub rating: Option<i64>,
    pub year: Option<i64>,
    pub creator: String,
    pub tags: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaRow {
    pub id: String,
    pub title: String,
    pub body: String,
    pub kind: MediaKind,
    pub status: MediaStatus,
    pub progress: Option<i64>,
    pub progress_total: Option<i64>,
    pub rating: Option<i64>,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub year: Option<i64>,
    pub creator: String,
    pub tags: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCounts {
    pub all: i64,
    pub want: i64,
    pub active: i64,
    pub finished: i64,
    pub dropped: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryList {
    pub items: Vec<MediaRow>,
    pub counts: LibraryCounts,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryOverview {
    pub active: Vec<MediaRow>,
    pub finished_this_month: i64,
    pub want: i64,
}

fn validate_input(input: &MediaInput) -> Result<(String, Option<i64>, Option<i64>), AppError> {
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Invalid("Judul media tidak boleh kosong".into()));
    }
    if title.chars().count() > 200 {
        return Err(AppError::Invalid("Judul media maksimal 200 karakter".into()));
    }

    if let Some(r) = input.rating
        && !(1..=5).contains(&r)
    {
        return Err(AppError::Invalid("Rating harus bernilai antara 1 sampai 5".into()));
    }

    if input.kind == MediaKind::Film {
        return Ok((title, None, None));
    }

    if let Some(total) = input.progress_total
        && total <= 0
    {
        return Err(AppError::Invalid("Total progres harus lebih besar dari 0".into()));
    }

    if let Some(p) = input.progress {
        if p < 0 {
            return Err(AppError::Invalid("Progres tidak boleh negatif".into()));
        }
        if let Some(total) = input.progress_total
            && p > total
        {
            return Err(AppError::Invalid("Progres tidak boleh melebihi total progres".into()));
        }
    }

    Ok((title, input.progress, input.progress_total))
}

fn parse_media_row(row: &rusqlite::Row) -> rusqlite::Result<MediaRow> {
    let kind_str: String = row.get(3)?;
    let status_str: String = row.get(4)?;
    let kind = MediaKind::try_from(kind_str.as_str())
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e)))?;
    let status = MediaStatus::try_from(status_str.as_str())
        .map_err(|e| rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e)))?;

    Ok(MediaRow {
        id: row.get(0)?,
        title: row.get(1)?,
        body: row.get(2)?,
        kind,
        status,
        progress: row.get(5)?,
        progress_total: row.get(6)?,
        rating: row.get(7)?,
        started_at: row.get(8)?,
        finished_at: row.get(9)?,
        year: row.get(10)?,
        creator: row.get(11)?,
        tags: row.get(12)?,
    })
}

pub fn get_media(conn: &Connection, id: &str) -> Result<MediaRow, AppError> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.title, i.body, m.kind, m.status, m.progress, m.progress_total, m.rating,
                m.started_at, m.finished_at, m.year, m.creator, m.tags
         FROM items i
         JOIN media m ON m.item_id = i.id
         WHERE i.id = ?1 AND i.type = 'media' AND i.deleted_at IS NULL",
    )?;
    stmt.query_row([id], parse_media_row).optional()?.ok_or(AppError::NotFound)
}

pub fn save_media(
    conn: &Connection,
    input: &MediaInput,
    now: i64,
    tz: &jiff::tz::TimeZone,
) -> Result<MediaRow, AppError> {
    let (clean_title, progress, progress_total) = validate_input(input)?;
    let tx = conn.unchecked_transaction()?;

    let (item_id, started_at, finished_at, progress, progress_total) = match &input.id {
        None => {
            let id = uuid::Uuid::now_v7().to_string();
            let (started_at, finished_at, adj_prog) = match input.status {
                MediaStatus::Active => {
                    let (start_of_day, _) = day_bounds(now, tz).map_err(AppError::from)?;
                    (Some(start_of_day), None, progress)
                }
                MediaStatus::Finished => {
                    let final_prog = if input.kind == MediaKind::Film {
                        None
                    } else {
                        progress_total.or(progress)
                    };
                    (None, Some(now), final_prog)
                }
                MediaStatus::Want | MediaStatus::Dropped => (None, None, progress),
            };

            tx.execute(
                "INSERT INTO items (id, type, title, body, created_at, updated_at) VALUES (?1, 'media', ?2, ?3, ?4, ?4)",
                params![id, clean_title, input.body, now],
            )?;

            tx.execute(
                "INSERT INTO media (item_id, kind, status, progress, progress_total, rating, started_at, finished_at, year, creator, tags)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    id,
                    input.kind.as_str(),
                    input.status.as_str(),
                    adj_prog,
                    progress_total,
                    input.rating,
                    started_at,
                    finished_at,
                    input.year,
                    input.creator.trim(),
                    input.tags.trim()
                ],
            )?;

            (id, started_at, finished_at, adj_prog, progress_total)
        }
        Some(id) => {
            let existing: Option<(Option<i64>, Option<i64>)> = tx
                .query_row(
                    "SELECT m.started_at, m.finished_at
                     FROM items i
                     JOIN media m ON m.item_id = i.id
                     WHERE i.id = ?1 AND i.type = 'media' AND i.deleted_at IS NULL",
                    [id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;

            let (old_started, old_finished) = existing.ok_or(AppError::NotFound)?;

            let (started_at, finished_at, adj_prog) = match input.status {
                MediaStatus::Active => {
                    let (start_of_day, _) = day_bounds(now, tz).map_err(AppError::from)?;
                    (Some(old_started.unwrap_or(start_of_day)), None, progress)
                }
                MediaStatus::Finished => {
                    let final_prog = if input.kind == MediaKind::Film {
                        None
                    } else {
                        progress_total.or(progress)
                    };
                    (old_started, Some(old_finished.unwrap_or(now)), final_prog)
                }
                MediaStatus::Want => (None, None, progress),
                MediaStatus::Dropped => (old_started, None, progress),
            };

            tx.execute(
                "UPDATE items SET title = ?1, body = ?2, updated_at = ?3 WHERE id = ?4",
                params![clean_title, input.body, now, id],
            )?;

            tx.execute(
                "INSERT INTO media (item_id, kind, status, progress, progress_total, rating, started_at, finished_at, year, creator, tags)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                 ON CONFLICT(item_id) DO UPDATE SET
                   kind = excluded.kind,
                   status = excluded.status,
                   progress = excluded.progress,
                   progress_total = excluded.progress_total,
                   rating = excluded.rating,
                   started_at = excluded.started_at,
                   finished_at = excluded.finished_at,
                   year = excluded.year,
                   creator = excluded.creator,
                   tags = excluded.tags",
                params![
                    id,
                    input.kind.as_str(),
                    input.status.as_str(),
                    adj_prog,
                    progress_total,
                    input.rating,
                    started_at,
                    finished_at,
                    input.year,
                    input.creator.trim(),
                    input.tags.trim()
                ],
            )?;

            (id.clone(), started_at, finished_at, adj_prog, progress_total)
        }
    };

    tx.commit()?;

    Ok(MediaRow {
        id: item_id,
        title: clean_title,
        body: input.body.clone(),
        kind: input.kind,
        status: input.status,
        progress,
        progress_total,
        rating: input.rating,
        started_at,
        finished_at,
        year: input.year,
        creator: input.creator.trim().to_string(),
        tags: input.tags.trim().to_string(),
    })
}

pub fn set_media_status(
    conn: &Connection,
    id: &str,
    status: MediaStatus,
    now: i64,
    tz: &jiff::tz::TimeZone,
) -> Result<MediaRow, AppError> {
    let current = get_media(conn, id)?;

    let (started_at, finished_at, progress) = match status {
        MediaStatus::Active => {
            let (start_of_day, _) = day_bounds(now, tz).map_err(AppError::from)?;
            (Some(current.started_at.unwrap_or(start_of_day)), None, current.progress)
        }
        MediaStatus::Finished => {
            let final_prog = if current.kind == MediaKind::Film {
                None
            } else if let Some(tot) = current.progress_total {
                Some(tot)
            } else {
                current.progress
            };
            (current.started_at, Some(current.finished_at.unwrap_or(now)), final_prog)
        }
        MediaStatus::Want => (None, None, current.progress),
        MediaStatus::Dropped => (current.started_at, None, current.progress),
    };

    let tx = conn.unchecked_transaction()?;

    tx.execute("UPDATE items SET updated_at = ?1 WHERE id = ?2", params![now, id])?;

    tx.execute(
        "UPDATE media SET status = ?1, started_at = ?2, finished_at = ?3, progress = ?4 WHERE item_id = ?5",
        params![status.as_str(), started_at, finished_at, progress, id],
    )?;

    tx.commit()?;

    Ok(MediaRow {
        id: current.id,
        title: current.title,
        body: current.body,
        kind: current.kind,
        status,
        progress,
        progress_total: current.progress_total,
        rating: current.rating,
        started_at,
        finished_at,
        year: current.year,
        creator: current.creator,
        tags: current.tags,
    })
}

pub fn delete_media(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    let changed = conn.execute(
        "UPDATE items SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND type = 'media' AND deleted_at IS NULL",
        params![now, id],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub fn restore_media(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    let changed = conn.execute(
        "UPDATE items SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2 AND type = 'media' AND deleted_at IS NOT NULL",
        params![now, id],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub fn library_list(
    conn: &Connection,
    kind: Option<MediaKind>,
    status: Option<MediaStatus>,
    query: Option<&str>,
) -> Result<LibraryList, AppError> {
    // 1. Calculate counts across all live media
    let mut count_stmt = conn.prepare(
        "SELECT
            COUNT(*),
            COUNT(CASE WHEN m.status = 'want' THEN 1 END),
            COUNT(CASE WHEN m.status = 'active' THEN 1 END),
            COUNT(CASE WHEN m.status = 'finished' THEN 1 END),
            COUNT(CASE WHEN m.status = 'dropped' THEN 1 END)
         FROM items i
         JOIN media m ON m.item_id = i.id
         WHERE i.type = 'media' AND i.deleted_at IS NULL",
    )?;

    let counts = count_stmt.query_row([], |r| {
        Ok(LibraryCounts {
            all: r.get(0)?,
            want: r.get(1)?,
            active: r.get(2)?,
            finished: r.get(3)?,
            dropped: r.get(4)?,
        })
    })?;

    // 2. Fetch filtered items
    let mut sql = String::from(
        "SELECT i.id, i.title, i.body, m.kind, m.status, m.progress, m.progress_total, m.rating,
                m.started_at, m.finished_at, m.year, m.creator, m.tags
         FROM items i
         JOIN media m ON m.item_id = i.id
         WHERE i.type = 'media' AND i.deleted_at IS NULL",
    );

    let mut values = Vec::<rusqlite::types::Value>::new();

    if let Some(k) = kind {
        values.push(rusqlite::types::Value::Text(k.as_str().to_string()));
        sql.push_str(&format!(" AND m.kind = ?{}", values.len()));
    }

    if let Some(s) = status {
        values.push(rusqlite::types::Value::Text(s.as_str().to_string()));
        sql.push_str(&format!(" AND m.status = ?{}", values.len()));
    }

    if let Some(q) = query {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            values.push(rusqlite::types::Value::Text(format!("%{trimmed}%")));
            sql.push_str(&format!(" AND i.title LIKE ?{} COLLATE NOCASE", values.len()));
        }
    }

    sql.push_str(" ORDER BY i.updated_at DESC, i.id DESC");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(values), parse_media_row)?;

    let mut items = Vec::new();
    for r in rows {
        items.push(r?);
    }

    Ok(LibraryList { items, counts })
}

pub fn library_overview(
    conn: &Connection,
    now: i64,
    tz: &jiff::tz::TimeZone,
) -> Result<LibraryOverview, AppError> {
    // 2 most recently updated active media
    let mut active_stmt = conn.prepare(
        "SELECT i.id, i.title, i.body, m.kind, m.status, m.progress, m.progress_total, m.rating,
                m.started_at, m.finished_at, m.year, m.creator, m.tags
         FROM items i
         JOIN media m ON m.item_id = i.id
         WHERE i.type = 'media' AND i.deleted_at IS NULL AND m.status = 'active'
         ORDER BY i.updated_at DESC, i.id DESC
         LIMIT 2",
    )?;
    let active_rows = active_stmt.query_map([], parse_media_row)?;
    let mut active = Vec::new();
    for r in active_rows {
        active.push(r?);
    }

    // Finished this month (using local month bounds)
    let current_month = time::month_of(now, tz).map_err(AppError::from)?;
    let (month_start, month_end) = month_bounds(&current_month, tz)?;

    let finished_this_month: i64 = conn.query_row(
        "SELECT COUNT(*)
         FROM items i
         JOIN media m ON m.item_id = i.id
         WHERE i.type = 'media' AND i.deleted_at IS NULL
           AND m.status = 'finished'
           AND m.finished_at >= ?1 AND m.finished_at < ?2",
        params![month_start, month_end],
        |r| r.get(0),
    )?;

    // Want count
    let want: i64 = conn.query_row(
        "SELECT COUNT(*)
         FROM items i
         JOIN media m ON m.item_id = i.id
         WHERE i.type = 'media' AND i.deleted_at IS NULL AND m.status = 'want'",
        [],
        |r| r.get(0),
    )?;

    Ok(LibraryOverview {
        active,
        finished_this_month,
        want,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use jiff::tz::TimeZone;

    fn sample_input(title: &str, kind: MediaKind, status: MediaStatus) -> MediaInput {
        MediaInput {
            id: None,
            title: title.into(),
            body: "Catatan pribadi".into(),
            kind,
            status,
            progress: None,
            progress_total: None,
            rating: None,
            year: Some(2024),
            creator: "Creator".into(),
            tags: "action, anime".into(),
        }
    }

    #[test]
    fn validation_rejects_bad_input() {
        let tz = TimeZone::system();
        let conn = open_in_memory();
        let now = time::now_ms();

        // Empty title
        let mut bad = sample_input("   ", MediaKind::Anime, MediaStatus::Want);
        assert!(save_media(&conn, &bad, now, &tz).is_err());

        // Title > 200 chars
        bad.title = "a".repeat(201);
        assert!(save_media(&conn, &bad, now, &tz).is_err());

        // Negative progress
        let mut bad_prog = sample_input("Anime", MediaKind::Anime, MediaStatus::Active);
        bad_prog.progress = Some(-1);
        assert!(save_media(&conn, &bad_prog, now, &tz).is_err());

        // Total <= 0
        bad_prog.progress = Some(1);
        bad_prog.progress_total = Some(0);
        assert!(save_media(&conn, &bad_prog, now, &tz).is_err());

        // Progress > total
        bad_prog.progress = Some(15);
        bad_prog.progress_total = Some(12);
        assert!(save_media(&conn, &bad_prog, now, &tz).is_err());

        // Rating out of 1..=5
        let mut bad_rating = sample_input("Film", MediaKind::Film, MediaStatus::Finished);
        bad_rating.rating = Some(6);
        assert!(save_media(&conn, &bad_rating, now, &tz).is_err());
        bad_rating.rating = Some(0);
        assert!(save_media(&conn, &bad_rating, now, &tz).is_err());
    }

    #[test]
    fn film_forces_progress_to_none() {
        let tz = TimeZone::system();
        let conn = open_in_memory();
        let now = time::now_ms();

        let mut film = sample_input("Past Lives", MediaKind::Film, MediaStatus::Want);
        film.progress = Some(120);
        film.progress_total = Some(120);

        let row = save_media(&conn, &film, now, &tz).unwrap();
        assert_eq!(row.progress, None);
        assert_eq!(row.progress_total, None);
    }

    #[test]
    fn status_transitions_and_idempotence() {
        let tz = TimeZone::system();
        let conn = open_in_memory();
        let now = 1770000000000; // arbitrary timestamp

        let mut input = sample_input("Frieren", MediaKind::Anime, MediaStatus::Want);
        input.progress_total = Some(28);

        let item = save_media(&conn, &input, now, &tz).unwrap();
        assert_eq!(item.status, MediaStatus::Want);
        assert_eq!(item.started_at, None);
        assert_eq!(item.finished_at, None);

        // Transition to active -> started_at filled with start of local day
        let (today_start, _) = day_bounds(now, &tz).unwrap();
        let active = set_media_status(&conn, &item.id, MediaStatus::Active, now, &tz).unwrap();
        assert_eq!(active.status, MediaStatus::Active);
        assert_eq!(active.started_at, Some(today_start));
        assert_eq!(active.finished_at, None);

        // Idempotent active
        let active2 = set_media_status(&conn, &item.id, MediaStatus::Active, now + 1000, &tz).unwrap();
        assert_eq!(active2.started_at, Some(today_start));

        // Transition to finished -> finished_at filled with now, progress = progress_total
        let finished = set_media_status(&conn, &item.id, MediaStatus::Finished, now + 2000, &tz).unwrap();
        assert_eq!(finished.status, MediaStatus::Finished);
        assert_eq!(finished.finished_at, Some(now + 2000));
        assert_eq!(finished.progress, Some(28));

        // Transition to dropped -> retains started_at, clears finished_at
        let dropped = set_media_status(&conn, &item.id, MediaStatus::Dropped, now + 3000, &tz).unwrap();
        assert_eq!(dropped.status, MediaStatus::Dropped);
        assert_eq!(dropped.started_at, Some(today_start));
        assert_eq!(dropped.finished_at, None);

        // Transition to want -> clears both dates, keeps progress (spec L4)
        let want = set_media_status(&conn, &item.id, MediaStatus::Want, now + 4000, &tz).unwrap();
        assert_eq!(want.status, MediaStatus::Want);
        assert_eq!(want.started_at, None);
        assert_eq!(want.finished_at, None);
        assert_eq!(want.progress, Some(28));
    }

    #[test]
    fn soft_delete_and_restore() {
        let tz = TimeZone::system();
        let conn = open_in_memory();
        let now = time::now_ms();

        let input = sample_input("Severance", MediaKind::Series, MediaStatus::Active);
        let saved = save_media(&conn, &input, now, &tz).unwrap();

        // Listing shows it
        let list = library_list(&conn, None, None, None).unwrap();
        assert_eq!(list.counts.all, 1);
        assert_eq!(list.items.len(), 1);

        // Soft delete
        delete_media(&conn, &saved.id, now).unwrap();

        // Not found via get_media or library_list
        assert!(matches!(get_media(&conn, &saved.id), Err(AppError::NotFound)));
        let list_after_delete = library_list(&conn, None, None, None).unwrap();
        assert_eq!(list_after_delete.counts.all, 0);
        assert_eq!(list_after_delete.items.len(), 0);

        // Restore
        restore_media(&conn, &saved.id, now + 10).unwrap();
        let restored = get_media(&conn, &saved.id).unwrap();
        assert_eq!(restored.title, "Severance");
        let list_after_restore = library_list(&conn, None, None, None).unwrap();
        assert_eq!(list_after_restore.counts.all, 1);
    }

    #[test]
    fn counts_and_overview_aggregation() {
        let tz = TimeZone::system();
        let conn = open_in_memory();
        let now = 1770000000000;

        let a = sample_input("Item 1", MediaKind::Book, MediaStatus::Want);
        save_media(&conn, &a, now, &tz).unwrap();

        let b = sample_input("Item 2", MediaKind::Manga, MediaStatus::Active);
        save_media(&conn, &b, now, &tz).unwrap();

        let mut c = sample_input("Item 3", MediaKind::Film, MediaStatus::Finished);
        c.rating = Some(5);
        save_media(&conn, &c, now, &tz).unwrap();

        let list = library_list(&conn, Some(MediaKind::Book), None, None).unwrap();
        // counts reflects all live media, not just book
        assert_eq!(list.counts.all, 3);
        assert_eq!(list.counts.want, 1);
        assert_eq!(list.counts.active, 1);
        assert_eq!(list.counts.finished, 1);
        assert_eq!(list.counts.dropped, 0);
        // items filtered to 1 book
        assert_eq!(list.items.len(), 1);
        assert_eq!(list.items[0].title, "Item 1");

        let overview = library_overview(&conn, now, &tz).unwrap();
        assert_eq!(overview.active.len(), 1);
        assert_eq!(overview.active[0].title, "Item 2");
        assert_eq!(overview.want, 1);
        assert_eq!(overview.finished_this_month, 1);
    }
}
