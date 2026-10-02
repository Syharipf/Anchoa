//! Downloads queue, yt-dlp arguments, and progress parsing (spec Fase 7 §3-4).
use std::path::{Path, PathBuf};

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadKind {
    Media,
    File,
}

impl ToSql for DownloadKind {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(match self {
            DownloadKind::Media => "media",
            DownloadKind::File => "file",
        }
        .into())
    }
}

impl FromSql for DownloadKind {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "media" => Ok(DownloadKind::Media),
            "file" => Ok(DownloadKind::File),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Queued,
    Running,
    Paused,
    Processing,
    Done,
    Failed,
}

impl ToSql for DownloadStatus {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(match self {
            DownloadStatus::Queued => "queued",
            DownloadStatus::Running => "running",
            DownloadStatus::Paused => "paused",
            DownloadStatus::Processing => "processing",
            DownloadStatus::Done => "done",
            DownloadStatus::Failed => "failed",
        }
        .into())
    }
}

impl FromSql for DownloadStatus {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "queued" => Ok(DownloadStatus::Queued),
            "running" => Ok(DownloadStatus::Running),
            "paused" => Ok(DownloadStatus::Paused),
            "processing" => Ok(DownloadStatus::Processing),
            "done" => Ok(DownloadStatus::Done),
            "failed" => Ok(DownloadStatus::Failed),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaOptions {
    pub audio_only: bool,
    pub quality: String, // "1080p" | "192 kbps"
    pub format: String,  // "MP4" | "MP3"
    pub subtitles: bool,
}

impl Default for MediaOptions {
    fn default() -> Self {
        Self {
            audio_only: false,
            quality: "1080p".to_string(),
            format: "MP4".to_string(),
            subtitles: false,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewDownload {
    pub url: String,
    pub kind: DownloadKind,
    pub options: Option<MediaOptions>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRow {
    pub id: String,
    pub title: String,
    pub url: String,
    pub kind: DownloadKind,
    pub options: Option<MediaOptions>,
    pub status: DownloadStatus,
    pub total_bytes: Option<i64>,
    pub done_bytes: i64,
    pub file_path: Option<String>,
    pub error: Option<String>,
    pub created_at: i64,
    pub finished_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadSettings {
    pub dir: String,
    pub parallel: u8,
    pub limit: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum YtEvent {
    Progress {
        done: u64,
        total: Option<u64>,
        speed: Option<f64>,
        eta: Option<u64>,
    },
    Post,
    Title(String),
    File(String),
    Error(String),
}

/// A plain file name: no separators, no NUL, and no leading dots, so it can
/// never be "." or ".." and never leaves the download folder.
pub fn safe_name(raw: &str) -> String {
    let s = raw.replace(['/', '\\', '\0'], "");
    let name = s
        .trim_start_matches(|c: char| c == '.' || c.is_whitespace())
        .trim_end();
    if name.is_empty() {
        "unduhan".to_string()
    } else {
        name.to_string()
    }
}

fn initial_title(url: &str, kind: DownloadKind) -> String {
    let clean = url.split('#').next().unwrap_or(url);
    let clean = clean.split('?').next().unwrap_or(clean);
    match kind {
        DownloadKind::Media => {
            let stripped = clean
                .strip_prefix("https://")
                .or_else(|| clean.strip_prefix("http://"))
                .unwrap_or(clean);
            let host = stripped.split('/').next().unwrap_or("media");
            let host = host.split(':').next().unwrap_or(host);
            if host.is_empty() {
                "media".to_string()
            } else {
                host.to_string()
            }
        }
        DownloadKind::File => {
            let segment = clean.rsplit('/').find(|s| !s.is_empty()).unwrap_or("unduhan");
            safe_name(segment)
        }
    }
}

fn row_from_sql(row: &rusqlite::Row<'_>) -> rusqlite::Result<DownloadRow> {
    let options_raw: String = row.get(4)?;
    let options: Option<MediaOptions> = if options_raw.trim().is_empty() || options_raw == "{}" {
        None
    } else {
        serde_json::from_str(&options_raw).ok()
    };
    Ok(DownloadRow {
        id: row.get(0)?,
        title: row.get(1)?,
        url: row.get(2)?,
        kind: row.get(3)?,
        options,
        status: row.get(5)?,
        total_bytes: row.get(6)?,
        done_bytes: row.get(7)?,
        file_path: row.get(8)?,
        error: row.get(9)?,
        created_at: row.get(10)?,
        finished_at: row.get(11)?,
    })
}

pub fn add(conn: &Connection, input: &NewDownload, now: i64) -> Result<DownloadRow, AppError> {
    let url = input.url.trim();
    if url.is_empty() {
        return Err(AppError::Invalid("URL tidak boleh kosong".into()));
    }
    if url.starts_with("magnet:") || url.ends_with(".torrent") || url.contains(".torrent?") {
        return Err(AppError::Invalid("Torrent belum didukung".into()));
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::Invalid("URL harus berawalan http:// atau https://".into()));
    }

    let id = uuid::Uuid::now_v7().to_string();
    let title = initial_title(url, input.kind);
    let options_json = match &input.options {
        Some(opts) => serde_json::to_string(opts).unwrap_or_else(|_| "{}".into()),
        None => "{}".to_string(),
    };

    conn.execute(
        "INSERT INTO items (id, type, title, body, created_at, updated_at) VALUES (?1, 'download', ?2, '', ?3, ?3)",
        params![id, title, now],
    )?;

    conn.execute(
        "INSERT INTO downloads (item_id, url, kind, options, status, total_bytes, done_bytes, file_path, error, finished_at)
         VALUES (?1, ?2, ?3, ?4, 'queued', NULL, 0, NULL, NULL, NULL)",
        params![id, url, input.kind, options_json],
    )?;

    get(conn, &id)
}

pub fn list(conn: &Connection) -> Result<Vec<DownloadRow>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.title, d.url, d.kind, d.options, d.status, d.total_bytes, d.done_bytes, d.file_path, d.error, i.created_at, d.finished_at
         FROM items i
         JOIN downloads d ON d.item_id = i.id
         WHERE i.deleted_at IS NULL
         ORDER BY i.created_at DESC",
    )?;
    let rows = stmt.query_map([], row_from_sql)?;
    let mut items = Vec::new();
    for r in rows {
        items.push(r?);
    }
    Ok(items)
}

pub fn get(conn: &Connection, id: &str) -> Result<DownloadRow, AppError> {
    conn.query_row(
        "SELECT i.id, i.title, d.url, d.kind, d.options, d.status, d.total_bytes, d.done_bytes, d.file_path, d.error, i.created_at, d.finished_at
         FROM items i
         JOIN downloads d ON d.item_id = i.id
         WHERE i.id = ?1 AND i.deleted_at IS NULL",
        params![id],
        row_from_sql,
    )
    .optional()?
    .ok_or(AppError::NotFound)
}

pub fn set_status(
    conn: &Connection,
    id: &str,
    status: DownloadStatus,
    error: Option<&str>,
    now: i64,
) -> Result<(), AppError> {
    // A retried or resumed download is unfinished again.
    let finished_at = matches!(status, DownloadStatus::Done | DownloadStatus::Failed).then_some(now);
    let updated = conn.execute(
        "UPDATE downloads SET status = ?1, error = ?2, finished_at = ?3 WHERE item_id = ?4",
        params![status, error, finished_at, id],
    )?;

    if updated == 0 {
        return Err(AppError::NotFound);
    }

    conn.execute(
        "UPDATE items SET updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
        params![now, id],
    )?;

    Ok(())
}

pub fn set_progress(
    conn: &Connection,
    id: &str,
    done: i64,
    total: Option<i64>,
) -> Result<(), AppError> {
    let updated = conn.execute(
        "UPDATE downloads
         SET done_bytes = ?1,
             total_bytes = CASE WHEN ?2 IS NOT NULL THEN ?2 ELSE total_bytes END
         WHERE item_id = ?3",
        params![done, total, id],
    )?;
    if updated == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub fn set_title(conn: &Connection, id: &str, title: &str, now: i64) -> Result<(), AppError> {
    let updated = conn.execute(
        "UPDATE items SET title = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
        params![title, now, id],
    )?;
    if updated == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub fn set_file(conn: &Connection, id: &str, file_path: &str) -> Result<(), AppError> {
    let updated = conn.execute(
        "UPDATE downloads SET file_path = ?1 WHERE item_id = ?2",
        params![file_path, id],
    )?;
    if updated == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub fn next_queued(conn: &Connection, limit: usize) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT i.id
         FROM items i
         JOIN downloads d ON d.item_id = i.id
         WHERE i.deleted_at IS NULL AND d.status = 'queued'
         ORDER BY i.created_at ASC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit as i64], |row| row.get(0))?;
    let mut ids = Vec::new();
    for r in rows {
        ids.push(r?);
    }
    Ok(ids)
}

pub fn pause_interrupted(conn: &Connection) -> Result<usize, AppError> {
    let count = conn.execute(
        "UPDATE downloads
         SET status = 'paused'
         WHERE status IN ('running', 'queued', 'processing')
           AND item_id IN (SELECT id FROM items WHERE deleted_at IS NULL)",
        [],
    )?;
    Ok(count)
}

pub fn remove(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    let count = conn.execute(
        "UPDATE items SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
        params![now, id],
    )?;
    if count == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub fn settings(conn: &Connection, default_dir: &Path) -> Result<DownloadSettings, AppError> {
    let dir: String = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'downloads.dir'",
            [],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or_else(|| default_dir.to_string_lossy().to_string());

    let parallel: u8 = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'downloads.parallel'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .and_then(|v| v.parse::<u8>().ok())
        .map(|v| v.clamp(1, 5))
        .unwrap_or(2);

    let limit: u64 = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'downloads.limit'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);

    Ok(DownloadSettings {
        dir,
        parallel,
        limit,
    })
}

pub fn save_settings(
    conn: &Connection,
    s: &DownloadSettings,
    home: &Path,
) -> Result<DownloadSettings, AppError> {
    if !(1..=5).contains(&s.parallel) {
        return Err(AppError::Invalid(
            "Unduhan bersamaan harus antara 1 dan 5".into(),
        ));
    }

    let dir_path = PathBuf::from(&s.dir);
    let canon_dir = std::fs::canonicalize(&dir_path)
        .map_err(|_| AppError::Invalid("Folder unduhan tidak ditemukan".into()))?;
    if !canon_dir.is_dir() {
        return Err(AppError::Invalid("Folder unduhan tidak valid".into()));
    }

    let canon_home = std::fs::canonicalize(home)
        .map_err(|_| AppError::Invalid("Folder home tidak ditemukan".into()))?;
    if !canon_dir.starts_with(&canon_home) {
        return Err(AppError::Invalid(
            "Folder harus berada di dalam folder home".into(),
        ));
    }

    let dir_str = canon_dir.to_string_lossy().to_string();
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('downloads.dir', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![dir_str],
    )?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('downloads.parallel', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![s.parallel.to_string()],
    )?;
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('downloads.limit', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![s.limit.to_string()],
    )?;

    Ok(DownloadSettings {
        dir: dir_str,
        parallel: s.parallel,
        limit: s.limit,
    })
}

pub fn build_ytdlp_args(
    opts: &MediaOptions,
    dir: &Path,
    part_dir: &Path,
    limit: u64,
) -> Vec<String> {
    let mut args = vec![
        "-P".to_string(),
        dir.to_string_lossy().to_string(),
        "-P".to_string(),
        format!("temp:{}", part_dir.to_string_lossy()),
        "-o".to_string(),
        "%(title)s.%(ext)s".to_string(),
    ];

    let fmt_lower = opts.format.to_lowercase();
    if opts.audio_only {
        args.push("-x".to_string());
        args.push("--audio-format".to_string());
        args.push(fmt_lower);
        args.push("--audio-quality".to_string());
        let kbps: String = opts.quality.chars().filter(|c| c.is_ascii_digit()).collect();
        let kbps = if kbps.is_empty() {
            "192".to_string()
        } else {
            kbps
        };
        args.push(format!("{kbps}K"));
    } else {
        let height: String = opts.quality.chars().filter(|c| c.is_ascii_digit()).collect();
        let height = if height.is_empty() {
            "1080".to_string()
        } else {
            height
        };
        args.push("-S".to_string());
        args.push(format!("res:{height},ext:{fmt_lower}"));
        args.push("--merge-output-format".to_string());
        args.push(fmt_lower);
    }

    if opts.subtitles {
        args.push("--write-subs".to_string());
        args.push("--sub-langs".to_string());
        args.push("id,en".to_string());
        args.push("--embed-subs".to_string());
    }

    if limit > 0 {
        args.push("--limit-rate".to_string());
        args.push(limit.to_string());
    }

    args.push("--newline".to_string());
    args.push("--no-colors".to_string());
    args.push("--no-playlist".to_string());
    args.push("--progress".to_string());
    args.push("--progress-template".to_string());
    args.push(
        "download:PROGRESS %(progress.downloaded_bytes)s/%(progress.total_bytes,progress.total_bytes_estimate)s/%(progress.speed)s/%(progress.eta)s".to_string(),
    );
    args.push("--progress-template".to_string());
    args.push("postprocess:POST".to_string());
    args.push("--print".to_string());
    args.push("before_dl:TITLE %(title)s".to_string());
    args.push("--print".to_string());
    args.push("after_move:FILE %(filepath)s".to_string());
    args.push("--".to_string());

    args
}

pub fn parse_line(line: &str) -> Option<YtEvent> {
    let trimmed = line.trim();
    if let Some(rest) = trimmed
        .strip_prefix("PROGRESS ")
        .or_else(|| trimmed.strip_prefix("download:PROGRESS "))
    {
        let parts: Vec<&str> = rest.split('/').collect();
        // Estimated totals come as floats ("1234.0"); "NA" does not parse and becomes None.
        let num = |i: usize| parts.get(i).and_then(|s| s.parse::<f64>().ok());
        let done = num(0).unwrap_or(0.0) as u64;
        let total = num(1).map(|v| v as u64);
        let speed = num(2);
        let eta = num(3).map(|v| v as u64);
        return Some(YtEvent::Progress {
            done,
            total,
            speed,
            eta,
        });
    }
    if trimmed == "POST" || trimmed.starts_with("POST") || trimmed == "postprocess:POST" {
        return Some(YtEvent::Post);
    }
    if let Some(rest) = trimmed
        .strip_prefix("TITLE ")
        .or_else(|| trimmed.strip_prefix("before_dl:TITLE "))
    {
        return Some(YtEvent::Title(rest.trim().to_string()));
    }
    if let Some(rest) = trimmed
        .strip_prefix("FILE ")
        .or_else(|| trimmed.strip_prefix("after_move:FILE "))
    {
        return Some(YtEvent::File(rest.trim().to_string()));
    }
    if let Some(rest) = trimmed.strip_prefix("ERROR: ") {
        return Some(YtEvent::Error(rest.trim().to_string()));
    }
    if let Some(rest) = trimmed.strip_prefix("ERROR:") {
        return Some(YtEvent::Error(rest.trim().to_string()));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn removed_downloads_leave_the_queue_restart_and_dashboard_queries() {
        let conn = open_in_memory();
        let queued = add(&conn, &NewDownload { url: "https://example.com/queued.zip".into(), kind: DownloadKind::File, options: None }, 1).unwrap();
        let running = add(&conn, &NewDownload { url: "https://example.com/running.zip".into(), kind: DownloadKind::File, options: None }, 2).unwrap();
        set_status(&conn, &running.id, DownloadStatus::Running, None, 3).unwrap();
        for id in [&queued.id, &running.id] {
            remove(&conn, id, 4).unwrap();
            assert!(matches!(get(&conn, id), Err(AppError::NotFound)));
        }
        assert!(next_queued(&conn, 10).unwrap().is_empty());
        assert_eq!(pause_interrupted(&conn).unwrap(), 0);
        assert!(crate::dashboard::downloads_summary(&conn, &std::collections::HashMap::new()).unwrap().items.is_empty());
    }

    #[test]
    fn add_rejects_bad_urls_and_torrents() {
        let conn = open_in_memory();

        let empty = NewDownload {
            url: "   ".into(),
            kind: DownloadKind::File,
            options: None,
        };
        assert!(matches!(add(&conn, &empty, 1000), Err(AppError::Invalid(_))));

        let magnet = NewDownload {
            url: "magnet:?xt=urn:btih:1234567890abcdef".into(),
            kind: DownloadKind::File,
            options: None,
        };
        let err = add(&conn, &magnet, 1000).unwrap_err();
        assert_eq!(err.to_string(), "Torrent belum didukung");

        let torrent_file = NewDownload {
            url: "https://example.com/distro.iso.torrent".into(),
            kind: DownloadKind::File,
            options: None,
        };
        let err = add(&conn, &torrent_file, 1000).unwrap_err();
        assert_eq!(err.to_string(), "Torrent belum didukung");

        let bad_proto = NewDownload {
            url: "ftp://example.com/file.zip".into(),
            kind: DownloadKind::File,
            options: None,
        };
        assert!(matches!(add(&conn, &bad_proto, 1000), Err(AppError::Invalid(_))));

        let valid_file = NewDownload {
            url: "https://example.com/files/archive.tar.gz".into(),
            kind: DownloadKind::File,
            options: None,
        };
        let row = add(&conn, &valid_file, 1000).unwrap();
        assert_eq!(row.title, "archive.tar.gz");
        assert_eq!(row.kind, DownloadKind::File);
        assert_eq!(row.status, DownloadStatus::Queued);

        let valid_media = NewDownload {
            url: "https://youtube.com/watch?v=abcdef".into(),
            kind: DownloadKind::Media,
            options: Some(MediaOptions {
                audio_only: false,
                quality: "1080p".into(),
                format: "MP4".into(),
                subtitles: true,
            }),
        };
        let row_media = add(&conn, &valid_media, 2000).unwrap();
        assert_eq!(row_media.title, "youtube.com");
        assert_eq!(row_media.kind, DownloadKind::Media);
    }

    #[test]
    fn list_is_newest_first_and_skips_removed() {
        let conn = open_in_memory();

        let d1 = add(
            &conn,
            &NewDownload {
                url: "https://example.com/one.zip".into(),
                kind: DownloadKind::File,
                options: None,
            },
            1000,
        )
        .unwrap();

        let d2 = add(
            &conn,
            &NewDownload {
                url: "https://example.com/two.zip".into(),
                kind: DownloadKind::File,
                options: None,
            },
            2000,
        )
        .unwrap();

        let d3 = add(
            &conn,
            &NewDownload {
                url: "https://example.com/three.zip".into(),
                kind: DownloadKind::File,
                options: None,
            },
            3000,
        )
        .unwrap();

        remove(&conn, &d2.id, 4000).unwrap();

        let rows = list(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, d3.id);
        assert_eq!(rows[1].id, d1.id);
    }

    #[test]
    fn next_queued_is_fifo_and_respects_the_limit() {
        let conn = open_in_memory();

        let d1 = add(
            &conn,
            &NewDownload {
                url: "https://example.com/d1.zip".into(),
                kind: DownloadKind::File,
                options: None,
            },
            1000,
        )
        .unwrap();

        let d2 = add(
            &conn,
            &NewDownload {
                url: "https://example.com/d2.zip".into(),
                kind: DownloadKind::File,
                options: None,
            },
            2000,
        )
        .unwrap();

        let d3 = add(
            &conn,
            &NewDownload {
                url: "https://example.com/d3.zip".into(),
                kind: DownloadKind::File,
                options: None,
            },
            3000,
        )
        .unwrap();

        // Mark d1 as running
        set_status(&conn, &d1.id, DownloadStatus::Running, None, 2500).unwrap();

        let q1 = next_queued(&conn, 1).unwrap();
        assert_eq!(q1, vec![d2.id.clone()]);

        let q2 = next_queued(&conn, 5).unwrap();
        assert_eq!(q2, vec![d2.id, d3.id]);
    }

    #[test]
    fn interrupted_downloads_become_paused() {
        let conn = open_in_memory();

        let d1 = add(
            &conn,
            &NewDownload {
                url: "https://example.com/d1.zip".into(),
                kind: DownloadKind::File,
                options: None,
            },
            1000,
        )
        .unwrap();

        let d2 = add(
            &conn,
            &NewDownload {
                url: "https://example.com/d2.zip".into(),
                kind: DownloadKind::File,
                options: None,
            },
            2000,
        )
        .unwrap();

        let d3 = add(
            &conn,
            &NewDownload {
                url: "https://example.com/d3.zip".into(),
                kind: DownloadKind::File,
                options: None,
            },
            3000,
        )
        .unwrap();

        let d4 = add(
            &conn,
            &NewDownload {
                url: "https://example.com/d4.zip".into(),
                kind: DownloadKind::File,
                options: None,
            },
            4000,
        )
        .unwrap();

        set_status(&conn, &d1.id, DownloadStatus::Running, None, 5000).unwrap();
        // d2 is queued
        set_status(&conn, &d3.id, DownloadStatus::Processing, None, 5000).unwrap();
        set_status(&conn, &d4.id, DownloadStatus::Done, None, 5000).unwrap();

        let count = pause_interrupted(&conn).unwrap();
        assert_eq!(count, 3);

        assert_eq!(get(&conn, &d1.id).unwrap().status, DownloadStatus::Paused);
        assert_eq!(get(&conn, &d2.id).unwrap().status, DownloadStatus::Paused);
        assert_eq!(get(&conn, &d3.id).unwrap().status, DownloadStatus::Paused);
        assert_eq!(get(&conn, &d4.id).unwrap().status, DownloadStatus::Done);
    }

    #[test]
    fn settings_default_and_validate() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let default_downloads = home.join("Downloads");
        std::fs::create_dir_all(&default_downloads).unwrap();

        let conn = open_in_memory();

        let s = settings(&conn, &default_downloads).unwrap();
        assert_eq!(s.dir, default_downloads.to_string_lossy());
        assert_eq!(s.parallel, 2);
        assert_eq!(s.limit, 0);

        // invalid parallel
        let bad_p1 = DownloadSettings {
            dir: default_downloads.to_string_lossy().to_string(),
            parallel: 0,
            limit: 0,
        };
        assert!(matches!(save_settings(&conn, &bad_p1, home), Err(AppError::Invalid(_))));

        let bad_p2 = DownloadSettings {
            dir: default_downloads.to_string_lossy().to_string(),
            parallel: 6,
            limit: 0,
        };
        assert!(matches!(save_settings(&conn, &bad_p2, home), Err(AppError::Invalid(_))));

        // non-existent dir
        let bad_dir = DownloadSettings {
            dir: home.join("non_existent").to_string_lossy().to_string(),
            parallel: 2,
            limit: 0,
        };
        assert!(matches!(save_settings(&conn, &bad_dir, home), Err(AppError::Invalid(_))));

        // dir outside home
        let other_dir = tempfile::tempdir().unwrap();
        let bad_outside = DownloadSettings {
            dir: other_dir.path().to_string_lossy().to_string(),
            parallel: 2,
            limit: 0,
        };
        assert!(matches!(save_settings(&conn, &bad_outside, home), Err(AppError::Invalid(_))));

        // valid save
        let custom_dir = home.join("UnduhanSaya");
        std::fs::create_dir_all(&custom_dir).unwrap();
        let good = DownloadSettings {
            dir: custom_dir.to_string_lossy().to_string(),
            parallel: 4,
            limit: 5242880,
        };
        let saved = save_settings(&conn, &good, home).unwrap();
        assert_eq!(saved.parallel, 4);
        assert_eq!(saved.limit, 5242880);

        let retrieved = settings(&conn, &default_downloads).unwrap();
        assert_eq!(retrieved.parallel, 4);
        assert_eq!(retrieved.limit, 5242880);
        assert_eq!(
            std::fs::canonicalize(&retrieved.dir).unwrap(),
            std::fs::canonicalize(&custom_dir).unwrap()
        );
    }

    #[test]
    fn ytdlp_args_for_video_audio_subtitles_and_limit() {
        let dir = Path::new("/downloads");
        let part_dir = Path::new("/downloads/.anchoa-part/test-id");

        let video_opts = MediaOptions {
            audio_only: false,
            quality: "1080p".into(),
            format: "MP4".into(),
            subtitles: true,
        };
        let args_video = build_ytdlp_args(&video_opts, dir, part_dir, 1048576);

        assert!(args_video.contains(&"-P".to_string()));
        assert!(args_video.contains(&"/downloads".to_string()));
        assert!(args_video.contains(&"temp:/downloads/.anchoa-part/test-id".to_string()));
        assert!(args_video.contains(&"-S".to_string()));
        assert!(args_video.contains(&"res:1080,ext:mp4".to_string()));
        assert!(args_video.contains(&"--merge-output-format".to_string()));
        assert!(args_video.contains(&"mp4".to_string()));
        assert!(args_video.contains(&"--write-subs".to_string()));
        assert!(args_video.contains(&"--sub-langs".to_string()));
        assert!(args_video.contains(&"id,en".to_string()));
        assert!(args_video.contains(&"--embed-subs".to_string()));
        assert!(args_video.contains(&"--limit-rate".to_string()));
        assert!(args_video.contains(&"1048576".to_string()));
        assert!(args_video.contains(&"--newline".to_string()));
        assert!(args_video.contains(&"--no-colors".to_string()));
        assert!(args_video.contains(&"--no-playlist".to_string()));
        assert!(args_video.contains(&"--progress".to_string()));
        assert_eq!(args_video.last(), Some(&"--".to_string()));

        let audio_opts = MediaOptions {
            audio_only: true,
            quality: "192 kbps".into(),
            format: "MP3".into(),
            subtitles: false,
        };
        let args_audio = build_ytdlp_args(&audio_opts, dir, part_dir, 0);

        assert!(args_audio.contains(&"-x".to_string()));
        assert!(args_audio.contains(&"--audio-format".to_string()));
        assert!(args_audio.contains(&"mp3".to_string()));
        assert!(args_audio.contains(&"--audio-quality".to_string()));
        assert!(args_audio.contains(&"192K".to_string()));
        assert!(!args_audio.contains(&"-S".to_string()));
        assert!(!args_audio.contains(&"--write-subs".to_string()));
        assert!(!args_audio.contains(&"--limit-rate".to_string()));
        assert_eq!(args_audio.last(), Some(&"--".to_string()));
    }

    #[test]
    fn parse_progress_post_title_file_and_error_lines() {
        let p1 = parse_line("PROGRESS 1048576/10485760/524288/18");
        assert_eq!(
            p1,
            Some(YtEvent::Progress {
                done: 1048576,
                total: Some(10485760),
                speed: Some(524288.0),
                eta: Some(18),
            })
        );

        let p2 = parse_line("download:PROGRESS 500000/NA/NA/NA");
        assert_eq!(
            p2,
            Some(YtEvent::Progress {
                done: 500000,
                total: None,
                speed: None,
                eta: None,
            })
        );

        let estimated = parse_line("PROGRESS 2048/4096.5/NA/3");
        assert_eq!(
            estimated,
            Some(YtEvent::Progress {
                done: 2048,
                total: Some(4096),
                speed: None,
                eta: Some(3),
            })
        );

        let post1 = parse_line("POST");
        assert_eq!(post1, Some(YtEvent::Post));

        let post2 = parse_line("postprocess:POST");
        assert_eq!(post2, Some(YtEvent::Post));

        let title = parse_line("TITLE Lagu Keren");
        assert_eq!(title, Some(YtEvent::Title("Lagu Keren".into())));

        let file = parse_line("FILE /home/user/Downloads/lagu.mp3");
        assert_eq!(file, Some(YtEvent::File("/home/user/Downloads/lagu.mp3".into())));

        let err = parse_line("ERROR: Private video");
        assert_eq!(err, Some(YtEvent::Error("Private video".into())));

        let random = parse_line("[download] Downloading webpage");
        assert_eq!(random, None);
    }

    #[test]
    fn safe_name_strips_path_parts() {
        assert_eq!(safe_name("../../etc/passwd"), "etcpasswd");
        assert_eq!(safe_name("/root/secret.mp4"), "rootsecret.mp4");
        assert_eq!(safe_name("normal_name.mp4"), "normal_name.mp4");
        assert_eq!(safe_name("a/b/c.mkv"), "abc.mkv");
        assert_eq!(safe_name("null\0byte.mp3"), "nullbyte.mp3");
        assert_eq!(safe_name("///"), "unduhan");
        assert_eq!(safe_name(""), "unduhan");
        assert_eq!(safe_name("   "), "unduhan");
        assert_eq!(safe_name(".."), "unduhan");
        assert_eq!(safe_name(" .. "), "unduhan");
        assert_eq!(safe_name(". ./x"), "x");
        assert_eq!(safe_name("...video.mp4"), "video.mp4");
    }
}
