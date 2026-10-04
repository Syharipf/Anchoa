//! Background download runner and process scheduler (spec Fase 7 §4).
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::db::Db;
use crate::downloads::{self, DownloadKind, DownloadRow, DownloadSettings, DownloadStatus, YtEvent};
use crate::error::AppError;
use crate::time;

pub struct Live {
    pub cancel: Arc<AtomicBool>,
    pub child: Option<std::process::Child>,
    pub done: u64,
    pub total: Option<u64>,
    pub speed: Option<f64>,
    pub eta: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveProgress {
    pub done: u64,
    pub total: Option<u64>,
    pub speed: Option<f64>,
    pub eta: Option<u64>,
}

#[derive(Default)]
pub struct Downloader {
    inner: Mutex<HashMap<String, Live>>,
}

/// Download settings, with the XDG Unduhan folder as the default folder.
pub fn current_settings(app: &AppHandle, conn: &Connection) -> Result<DownloadSettings, AppError> {
    let home = app.path().home_dir()?;
    let user_dirs = std::fs::read_to_string(home.join(".config/user-dirs.dirs")).ok();
    let default_dir =
        crate::files::xdg_dir(&home, user_dirs.as_deref(), "XDG_DOWNLOAD_DIR", "Downloads");
    downloads::settings(conn, &default_dir)
}

impl Downloader {
    fn map(&self) -> Result<MutexGuard<'_, HashMap<String, Live>>, AppError> {
        self.inner
            .lock()
            .map_err(|_| AppError::Other("Mutex poisoned".into()))
    }

    /// Starts queued or due interrupted downloads until the parallel limit is reached.
    /// Locks the database, so callers must not hold it.
    pub fn schedule(&self, app: &AppHandle) -> Result<(), AppError> {
        let db = app.state::<Db>();
        let conn = db.conn()?;
        let settings = current_settings(app, &conn)?;
        let mut map = self.map()?;

        let parallel = settings.parallel as usize;
        if map.len() >= parallel {
            return Ok(());
        }
        let limit = settings.limit / u64::from(settings.parallel);
        let now = time::now_ms();

        for id in downloads::next_runnable(&conn, now, parallel - map.len())? {
            if map.contains_key(&id) {
                continue;
            }
            downloads::set_status(&conn, &id, DownloadStatus::Running, None, now)?;
            let cancel = Arc::new(AtomicBool::new(false));
            map.insert(
                id.clone(),
                Live {
                    cancel: cancel.clone(),
                    child: None,
                    done: 0,
                    total: None,
                    speed: None,
                    eta: None,
                },
            );
            let app = app.clone();
            let dir = PathBuf::from(&settings.dir);
            std::thread::spawn(move || worker(app, id, cancel, limit, dir));
        }
        Ok(())
    }

    /// Stops a running download: kills yt-dlp, or ends the file loop at its next chunk.
    pub fn stop(&self, id: &str) -> Result<(), AppError> {
        if let Some(live) = self.map()?.get_mut(id) {
            stop_live(live);
        }
        Ok(())
    }

    /// Called when the app exits, so no yt-dlp keeps downloading on its own (spec U9).
    pub fn stop_all(&self) {
        if let Ok(mut map) = self.map() {
            map.values_mut().for_each(stop_live);
        }
    }

    pub fn live(&self) -> HashMap<String, LiveProgress> {
        let Ok(map) = self.map() else {
            return HashMap::new();
        };
        map.iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    LiveProgress {
                        done: v.done,
                        total: v.total,
                        speed: v.speed,
                        eta: v.eta,
                    },
                )
            })
            .collect()
    }
}

pub fn spawn_scheduler(app: AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(5));
            if app
                .try_state::<crate::security::SecurityState>()
                .is_none_or(|s| s.is_locked())
            {
                continue;
            }
            if let Some(dl) = app.try_state::<Downloader>() {
                let _ = dl.schedule(&app);
            }
        }
    });
}

fn stop_live(live: &mut Live) {
    live.cancel.store(true, Ordering::SeqCst);
    if let Some(child) = &mut live.child {
        let _ = child.kill();
    }
}

fn with_live<R>(app: &AppHandle, id: &str, f: impl FnOnce(&mut Live) -> R) -> Option<R> {
    let downloader = app.try_state::<Downloader>()?;
    let mut map = downloader.map().ok()?;
    let live = map.get_mut(id)?;
    Some(f(live))
}

fn with_db<T>(app: &AppHandle, f: impl FnOnce(&Connection) -> Result<T, AppError>) {
    if let Some(db) = app.try_state::<Db>()
        && let Ok(conn) = db.conn()
    {
        let _ = f(&conn);
    }
}

enum Outcome {
    Done,
    Stopped,
    Failed(String),
}

fn worker(app: AppHandle, id: String, cancel: Arc<AtomicBool>, limit: u64, dir: PathBuf) {
    let part_dir = dir.join(".anchoa-part").join(&id);
    let row = match app.try_state::<Db>() {
        Some(db) => db.conn().and_then(|conn| downloads::get(&conn, &id)),
        None => Err(AppError::DbUnavailable),
    };
    let outcome = match row {
        Ok(row) if row.kind == DownloadKind::File => {
            run_file(&app, &id, &row, &dir, &part_dir, limit, &cancel)
        }
        Ok(row) => run_media(&app, &id, &row, &dir, &part_dir, limit, &cancel),
        // Removed from the list before it started.
        Err(_) => Outcome::Stopped,
    };
    finish(&app, &id, &part_dir, outcome);
    cleanup(&app, &id);
}

fn run_file(
    app: &AppHandle,
    id: &str,
    row: &DownloadRow,
    dir: &Path,
    part_dir: &Path,
    limit: u64,
    cancel: &AtomicBool,
) -> Outcome {
    let opts = FetchFileOptions {
        url: &row.url,
        dir,
        part_dir,
        limit,
        expected_sha256: row.expected_sha256.as_deref(),
    };
    let mut last: Option<(Instant, u64)> = None;
    let result = fetch_file(&opts, cancel, |done, total| {
        let (at, from) = *last.get_or_insert((Instant::now(), done));
        let elapsed = at.elapsed().as_secs_f64();
        let speed = (elapsed >= 0.5).then(|| done.saturating_sub(from) as f64 / elapsed);
        if speed.is_some() {
            last = Some((Instant::now(), done));
        }
        with_live(app, id, |live| {
            live.done = done;
            live.total = total;
            if let Some(speed) = speed {
                live.speed = Some(speed);
                live.eta = total
                    .filter(|_| speed > 0.0)
                    .map(|t| (t.saturating_sub(done) as f64 / speed) as u64);
            }
        });
    });
    match result {
        Ok(fetch_res) => {
            with_db(app, |conn| {
                downloads::set_actual_sha256(conn, id, &fetch_res.actual_sha256)?;
                downloads::set_file(conn, id, &fetch_res.path.to_string_lossy())?;
                match fetch_res.path.file_name() {
                    Some(name) => {
                        downloads::set_title(conn, id, &name.to_string_lossy(), time::now_ms())
                    }
                    None => Ok(()),
                }
            });
            Outcome::Done
        }
        Err(_) if cancel.load(Ordering::SeqCst) => Outcome::Stopped,
        Err(e) => Outcome::Failed(e.to_string()),
    }
}

fn run_media(
    app: &AppHandle,
    id: &str,
    row: &DownloadRow,
    dir: &Path,
    part_dir: &Path,
    limit: u64,
    cancel: &AtomicBool,
) -> Outcome {
    let opts = row.options.clone().unwrap_or_default();
    let mut child = match Command::new("yt-dlp")
        .args(downloads::build_ytdlp_args(&opts, dir, part_dir, limit))
        .arg(&row.url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Outcome::Failed(
                "yt-dlp belum terpasang: sudo dnf install yt-dlp ffmpeg".into(),
            );
        }
        Err(e) => return Outcome::Failed(format!("yt-dlp gagal: {e}")),
    };

    let stdout = child.stdout.take();
    let stderr_reader = child.stderr.take().map(|pipe| {
        std::thread::spawn(move || {
            BufReader::new(pipe)
                .lines()
                .map_while(Result::ok)
                .filter_map(|line| match downloads::parse_line(&line) {
                    Some(YtEvent::Error(e)) => Some(e),
                    _ => None,
                })
                .last()
        })
    });
    with_live(app, id, |live| live.child = Some(child));

    let mut stdout_error = None;
    let mut processing = false;
    let lines = stdout
        .into_iter()
        .flat_map(|pipe| BufReader::new(pipe).lines().map_while(Result::ok));
    for line in lines {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        match downloads::parse_line(&line) {
            Some(YtEvent::Progress {
                done,
                total,
                speed,
                eta,
            }) => {
                with_live(app, id, |live| {
                    live.done = done;
                    live.total = total;
                    if speed.is_some() {
                        live.speed = speed;
                    }
                    if eta.is_some() {
                        live.eta = eta;
                    }
                });
            }
            Some(YtEvent::Post) if !processing => {
                processing = true;
                with_db(app, |conn| {
                    downloads::set_status(conn, id, DownloadStatus::Processing, None, time::now_ms())
                });
            }
            Some(YtEvent::Title(title)) => {
                with_db(app, |conn| downloads::set_title(conn, id, &title, time::now_ms()))
            }
            Some(YtEvent::File(path)) => with_db(app, |conn| downloads::set_file(conn, id, &path)),
            Some(YtEvent::Error(e)) => stdout_error = Some(e),
            _ => {}
        }
    }

    let child = with_live(app, id, |live| live.child.take()).flatten();
    let status = child.and_then(|mut child| {
        if cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
        }
        child.wait().ok()
    });
    let stderr_error = stderr_reader.and_then(|reader| reader.join().ok().flatten());

    match status {
        Some(s) if s.success() => Outcome::Done,
        _ if cancel.load(Ordering::SeqCst) => Outcome::Stopped,
        s => Outcome::Failed(stderr_error.or(stdout_error).unwrap_or_else(|| {
            let code = s
                .and_then(|s| s.code())
                .map_or_else(|| "tidak diketahui".to_string(), |c| c.to_string());
            format!("yt-dlp gagal (kode {code})")
        })),
    }
}

/// Writes the final state. A download that finished wins over a pause that came too late.
fn finish(app: &AppHandle, id: &str, part_dir: &Path, outcome: Outcome) {
    let (done, total) = with_live(app, id, |live| (live.done, live.total)).unwrap_or((0, None));
    with_db(app, |conn| {
        let now = time::now_ms();
        let total = match outcome {
            Outcome::Done => total.or(Some(done)),
            _ => total,
        };
        if done > 0 {
            let _ = downloads::set_progress(conn, id, done as i64, total.map(|t| t as i64));
        }
        match outcome {
            Outcome::Done => {
                let _ = std::fs::remove_dir_all(part_dir);
                downloads::set_status(conn, id, DownloadStatus::Done, None, now)
            }
            Outcome::Failed(msg) => {
                if msg.contains("SHA-256")
                    || msg.contains("401")
                    || msg.contains("403")
                    || msg.contains("404")
                    || msg.contains("Torrent")
                {
                    downloads::set_status(conn, id, DownloadStatus::Failed, Some(&msg), now)
                } else {
                    downloads::set_interrupted(conn, id, &msg, now)
                }
            }
            // Removed from the list while running: its temp folder goes too (spec U10).
            Outcome::Stopped => {
                if downloads::get(conn, id).is_err() {
                    let _ = std::fs::remove_dir_all(part_dir);
                }
                Ok(())
            }
        }
    });
}

fn cleanup(app: &AppHandle, id: &str) {
    if let Some(downloader) = app.try_state::<Downloader>() {
        if let Ok(mut map) = downloader.map() {
            map.remove(id);
        }
        let _ = downloader.schedule(app);
    }
}

/// `filename*=` wins over `filename=` when both are present (RFC 6266 §4.3).
fn filename_from_content_disposition(cd: &str) -> Option<String> {
    let mut plain = None;
    for part in cd.split(';') {
        let part = part.trim();
        if let Some(rest) = part.strip_prefix("filename*=") {
            let rest = rest.trim();
            let value = rest.split_once("''").map_or(rest, |(_, encoded)| encoded);
            let decoded = percent_decode(value);
            if !decoded.is_empty() {
                return Some(decoded);
            }
        } else if let Some(rest) = part.strip_prefix("filename=") {
            let val = rest.trim().trim_matches(|c| c == '"' || c == '\'');
            if !val.is_empty() && plain.is_none() {
                plain = Some(val.to_string());
            }
        }
    }
    plain
}

/// Decodes `%XX` escapes. An invalid escape stays as it is.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let escaped = bytes
            .get(i + 1..i + 3)
            .filter(|hex| bytes[i] == b'%' && hex.iter().all(u8::is_ascii_hexdigit))
            .and_then(|hex| std::str::from_utf8(hex).ok())
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());
        match escaped {
            Some(b) => {
                out.push(b);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn filename_from_url(url: &str) -> String {
    let clean = url.split('#').next().unwrap_or(url);
    let clean = clean.split('?').next().unwrap_or(clean);
    let segment = clean.rsplit('/').find(|s| !s.is_empty()).unwrap_or("");
    downloads::safe_name(&percent_decode(segment))
}

#[derive(Debug, Clone)]
pub struct FetchFileOptions<'a> {
    pub url: &'a str,
    pub dir: &'a Path,
    pub part_dir: &'a Path,
    pub limit: u64,
    pub expected_sha256: Option<&'a str>,
}

impl<'a> FetchFileOptions<'a> {
    pub fn new(url: &'a str, dir: &'a Path, part_dir: &'a Path) -> Self {
        Self {
            url,
            dir,
            part_dir,
            limit: 0,
            expected_sha256: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchResult {
    pub path: PathBuf,
    pub actual_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeState {
    pub start: u64,
    pub end: u64,
    pub done: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeMetadata {
    pub version: u32,
    pub url: String,
    pub validator: Option<String>,
    pub total: Option<u64>,
    pub safe_name: String,
    pub ranges: Vec<RangeState>,
}

pub fn save_resume_metadata(part_dir: &Path, meta: &ResumeMetadata) -> Result<(), AppError> {
    let tmp = part_dir.join("resume.json.tmp");
    let target = part_dir.join("resume.json");
    let json = serde_json::to_string(meta).map_err(|e| AppError::Other(e.to_string()))?;
    let mut file = std::fs::File::create(&tmp)?;
    file.write_all(json.as_bytes())?;
    file.sync_data()?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

pub fn load_resume_metadata(part_dir: &Path, url: &str) -> Option<ResumeMetadata> {
    let path = part_dir.join("resume.json");
    let content = std::fs::read_to_string(path).ok()?;
    let meta: ResumeMetadata = serde_json::from_str(&content).ok()?;
    if meta.url == url {
        Some(meta)
    } else {
        None
    }
}

fn create_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(15)))
        .timeout_recv_response(Some(Duration::from_secs(30)))
        .timeout_global(Some(Duration::from_secs(3600)))
        .build()
        .into()
}

pub struct ProbeResult {
    pub supports_range: bool,
    pub total: Option<u64>,
    pub validator: Option<String>,
    pub filename: Option<String>,
    pub is_strong_etag: bool,
}

pub fn probe_url(agent: &ureq::Agent, url: &str) -> Result<ProbeResult, AppError> {
    let req = agent
        .get(url)
        .header("User-Agent", "Anchoa")
        .header("Accept-Encoding", "identity")
        .header("Range", "bytes=0-0");

    let resp = match req.call() {
        Ok(r) => r,
        Err(e) => return Err(AppError::Other(format!("Probe gagal: {e}"))),
    };

    let status = resp.status().as_u16();

    let etag = resp
        .headers()
        .get("etag")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.trim().to_string());

    let is_strong_etag = etag.as_ref().is_some_and(|e| {
        e.starts_with('"') && e.ends_with('"') && !e.starts_with("W/")
    });

    let last_modified = resp
        .headers()
        .get("last-modified")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.trim().to_string());

    let validator = if is_strong_etag {
        etag
    } else {
        last_modified
    };

    let filename = resp
        .headers()
        .get("content-disposition")
        .and_then(|h| h.to_str().ok())
        .and_then(filename_from_content_disposition);

    if status == 206 {
        let content_range = resp.headers().get("content-range").and_then(|h| h.to_str().ok());
        let total = content_range
            .and_then(|cr| cr.split('/').nth(1))
            .and_then(|tot| tot.trim().parse::<u64>().ok());

        Ok(ProbeResult {
            supports_range: true,
            total,
            validator,
            filename,
            is_strong_etag,
        })
    } else {
        let total = resp
            .headers()
            .get("content-length")
            .and_then(|h| h.to_str().ok())
            .and_then(|len| len.parse::<u64>().ok());

        Ok(ProbeResult {
            supports_range: false,
            total,
            validator,
            filename,
            is_strong_etag,
        })
    }
}

pub fn fetch_file(
    opts: &FetchFileOptions<'_>,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> Result<FetchResult, AppError> {
    std::fs::create_dir_all(opts.part_dir)?;
    let agent = create_agent();

    let probe = probe_url(&agent, opts.url)?;

    let url_name = filename_from_url(opts.url);
    let final_name = probe
        .filename
        .map(|raw| crate::downloads::safe_name(&raw))
        .filter(|s| !s.is_empty() && s != "unduhan")
        .unwrap_or(url_name);

    let payload_path = opts.part_dir.join("payload.part");

    // 4-range workers: size >= 8 MiB, strong ETag, total known, range supported
    let use_multi_range = probe.supports_range
        && probe.is_strong_etag
        && probe.total.map(|t| t >= 8 * 1024 * 1024).unwrap_or(false);

    if use_multi_range {
        let total = probe.total.unwrap();
        fetch_multi_range(
            &agent,
            opts,
            total,
            probe.validator.as_deref(),
            &final_name,
            &payload_path,
            cancel,
            &mut on_progress,
        )?;
    } else {
        fetch_single_stream(
            &agent,
            opts,
            probe.total,
            probe.validator.as_deref(),
            probe.supports_range,
            &final_name,
            &payload_path,
            cancel,
            &mut on_progress,
        )?;
    }

    // Verify SHA-256 over completed payload.part
    let mut hasher = Sha256::new();
    let mut file = std::fs::File::open(&payload_path)?;
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let actual_sha256 = format!("{:x}", hasher.finalize());

    if let Some(expected) = opts.expected_sha256 {
        let trimmed = expected.trim();
        if !trimmed.is_empty() && !actual_sha256.eq_ignore_ascii_case(trimmed) {
            return Err(AppError::Invalid(format!(
                "Integritas SHA-256 tidak cocok: diharapkan {trimmed}, didapatkan {actual_sha256}"
            )));
        }
    }

    // Move to final destination
    let target = opts.dir.join(&final_name);
    let final_path = if std::fs::symlink_metadata(&target).is_ok() {
        crate::files::unique_name(opts.dir, &final_name)
    } else {
        target
    };

    if std::fs::rename(&payload_path, &final_path).is_err() {
        let tmp_dest = opts
            .dir
            .join(format!(".anchoa-tmp-{}.tmp", uuid::Uuid::now_v7()));
        std::fs::copy(&payload_path, &tmp_dest)?;
        let f = std::fs::File::open(&tmp_dest)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp_dest, &final_path)?;
        let _ = std::fs::remove_file(&payload_path);
    }

    let _ = std::fs::remove_dir_all(opts.part_dir);

    Ok(FetchResult {
        path: final_path,
        actual_sha256,
    })
}

fn parse_and_validate_content_range(
    header: &str,
    expected_start: u64,
    expected_end: Option<u64>,
    expected_total: Option<u64>,
) -> Result<(u64, u64, Option<u64>), AppError> {
    let trimmed = header.trim();
    if !trimmed.starts_with("bytes ") {
        return Err(AppError::Other(format!("Header Content-Range tidak valid: {header}")));
    }
    let range_part = &trimmed["bytes ".len()..];
    let mut split_slash = range_part.split('/');
    let byte_range = split_slash.next().ok_or_else(|| AppError::Other("Content-Range tanpa rentang".into()))?;
    let total_str = split_slash.next().ok_or_else(|| AppError::Other("Content-Range tanpa total".into()))?;

    let mut split_dash = byte_range.split('-');
    let start: u64 = split_dash
        .next()
        .and_then(|s| s.trim().parse().ok())
        .ok_or_else(|| AppError::Other("Content-Range start tidak valid".into()))?;
    let end: u64 = split_dash
        .next()
        .and_then(|s| s.trim().parse().ok())
        .ok_or_else(|| AppError::Other("Content-Range end tidak valid".into()))?;

    if end < start {
        return Err(AppError::Other("Content-Range end lebih kecil dari start".into()));
    }
    if start != expected_start {
        return Err(AppError::Other(format!(
            "Content-Range start {start} tidak cocok dengan permintaan {expected_start}"
        )));
    }
    if let Some(exp_end) = expected_end
        && end != exp_end {
            return Err(AppError::Other(format!(
                "Content-Range end {end} tidak cocok dengan permintaan {exp_end}"
            )));
        }

    let parsed_total: Option<u64> = if total_str.trim() == "*" {
        None
    } else {
        Some(
            total_str
                .trim()
                .parse::<u64>()
                .map_err(|_| AppError::Other("Content-Range total tidak valid".into()))?,
        )
    };

    if let (Some(pt), Some(et)) = (parsed_total, expected_total)
        && pt != et {
            return Err(AppError::Other(format!(
                "Content-Range total {pt} tidak cocok dengan total probe {et}"
            )));
        }

    Ok((start, end, parsed_total))
}

fn classify_and_delay_retry(
    err: &ureq::Error,
    attempts: u32,
    cancel: &AtomicBool,
) -> Result<(), AppError> {
    match err {
        ureq::Error::StatusCode(401 | 403 | 404) => {
            Err(AppError::Other(format!("Permintaan HTTP ditolak permanen: {err}")))
        }
        ureq::Error::StatusCode(code) if *code == 408 || *code == 429 || (500..=599).contains(code) => {
            if attempts >= 3 {
                return Err(AppError::Other(format!("Gagal setelah 3 percobaan HTTP: {err}")));
            }
            let delay_secs = (1 << (attempts - 1)).min(60);
            for _ in 0..(delay_secs * 10) {
                if cancel.load(Ordering::SeqCst) {
                    return Err(AppError::Other("Unduhan dihentikan".into()));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Ok(())
        }
        ureq::Error::Timeout(_) | ureq::Error::Io(_) => {
            if attempts >= 3 {
                return Err(AppError::Other(format!("Koneksi terputus setelah 3 percobaan: {err}")));
            }
            let delay_secs = (1 << (attempts - 1)).min(60);
            for _ in 0..(delay_secs * 10) {
                if cancel.load(Ordering::SeqCst) {
                    return Err(AppError::Other("Unduhan dihentikan".into()));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Ok(())
        }
        _ => Err(AppError::Other(format!("Kesalahan HTTP tidak dapat diulang: {err}"))),
    }
}
#[allow(clippy::too_many_arguments)]
fn fetch_single_stream(
    agent: &ureq::Agent,
    opts: &FetchFileOptions<'_>,
    probe_total: Option<u64>,
    validator: Option<&str>,
    supports_range: bool,
    safe_name: &str,
    payload_path: &Path,
    cancel: &AtomicBool,
    on_progress: &mut impl FnMut(u64, Option<u64>),
) -> Result<(), AppError> {
    let mut resume_meta = load_resume_metadata(opts.part_dir, opts.url);
    let mut existing_len = 0u64;

    if supports_range && validator.is_some()
        && let Some(ref meta) = resume_meta
            && meta.validator.as_deref() == validator {
                let file_len = std::fs::metadata(payload_path).map(|m| m.len()).unwrap_or(0);
                let saved_done = meta.ranges.first().map(|r| r.done).unwrap_or(0);
                existing_len = saved_done.min(file_len);
            }

    let mut attempts = 0u32;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(AppError::Other("Unduhan dihentikan".into()));
        }

        let mut req = agent
            .get(opts.url)
            .header("User-Agent", "Anchoa")
            .header("Accept-Encoding", "identity");

        if existing_len > 0 {
            req = req.header("Range", &format!("bytes={existing_len}-"));
            if let Some(v) = validator {
                req = req.header("If-Range", v);
            }
        }

        let resp_res = req.call();
        let mut resp = match resp_res {
            Ok(r) => r,
            Err(e) => {
                attempts += 1;
                classify_and_delay_retry(&e, attempts, cancel)?;
                continue;
            }
        };

        let status = resp.status().as_u16();
        let (mut file, mut done, total, expected_stream_bytes) = if status == 206 {
            let cr_header = resp.headers().get("content-range").and_then(|h| h.to_str().ok()).unwrap_or("");
            let (_start, end, parsed_total) = match parse_and_validate_content_range(cr_header, existing_len, None, probe_total) {
                Ok(r) => r,
                Err(_) => {
                    existing_len = 0;
                    continue;
                }
            };
            if let Some(v) = validator
                && let Some(resp_etag) = resp.headers().get("etag").and_then(|h| h.to_str().ok())
                    && resp_etag != v {
                        existing_len = 0;
                        continue;
                    }
            let f = OpenOptions::new()
                .write(true)
                .open(payload_path)?;
            let mut f = f;
            f.seek(SeekFrom::Start(existing_len))?;
            (f, existing_len, parsed_total.or(probe_total), Some(end + 1))
        } else if status == 200 {
            let f = OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .open(payload_path)?;
            let total = resp
                .headers()
                .get("content-length")
                .and_then(|h| h.to_str().ok())
                .and_then(|len| len.parse::<u64>().ok())
                .or(probe_total);
            (f, 0u64, total, total)
        } else if status == 416 {
            if let (Some(t), Some(v)) = (probe_total, validator)
                && existing_len == t
                    && let Some(resp_etag) = resp.headers().get("etag").and_then(|h| h.to_str().ok())
                        && resp_etag == v {
                            return Ok(());
                        }
            existing_len = 0;
            continue;
        } else {
            return Err(AppError::Other(format!("Status HTTP {status} tidak didukung")));
        };

        let mut reader = resp.body_mut().as_reader();
        let mut buf = [0u8; 64 * 1024];
        let mut bytes_since_ckpt = 0u64;
        let mut last_ckpt = Instant::now();

        on_progress(done, total);

        let mut read_failed = false;
        loop {
            if cancel.load(Ordering::SeqCst) {
                let _ = file.sync_data();
                return Err(AppError::Other("Unduhan dihentikan".into()));
            }

            let start = Instant::now();
            let n = match reader.read(&mut buf) {
                Ok(0) => {
                    if let Some(exp) = expected_stream_bytes
                        && done < exp {
                            read_failed = true;
                        }
                    break;
                }
                Ok(n) => n,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => {
                    read_failed = true;
                    break;
                }
            };

            file.write_all(&buf[..n])?;
            done += n as u64;
            bytes_since_ckpt += n as u64;
            on_progress(done, total);

            if bytes_since_ckpt >= 1024 * 1024 || last_ckpt.elapsed() >= Duration::from_secs(2) {
                let _ = file.sync_data();
                let meta = ResumeMetadata {
                    version: 1,
                    url: opts.url.to_string(),
                    validator: validator.map(|v| v.to_string()),
                    total,
                    safe_name: safe_name.to_string(),
                    ranges: vec![RangeState {
                        start: 0,
                        end: total.unwrap_or(done).saturating_sub(1),
                        done,
                    }],
                };
                let _ = save_resume_metadata(opts.part_dir, &meta);
                resume_meta = Some(meta);
                bytes_since_ckpt = 0;
                last_ckpt = Instant::now();
            }

            if opts.limit > 0 {
                let expected = Duration::from_secs_f64(n as f64 / opts.limit as f64);
                let elapsed = start.elapsed();
                if expected > elapsed {
                    std::thread::sleep(expected - elapsed);
                }
            }
        }

        file.flush()?;
        let _ = file.sync_data();

        if read_failed {
            attempts += 1;
            if attempts <= 3 {
                existing_len = done;
                std::thread::sleep(Duration::from_secs(1 << (attempts - 1)));
                continue;
            }
            return Err(AppError::Other("Koneksi terputus saat membaca data".into()));
        }

        // Save final checkpoint
        let meta = ResumeMetadata {
            version: 1,
            url: opts.url.to_string(),
            validator: validator.map(|v| v.to_string()),
            total,
            safe_name: safe_name.to_string(),
            ranges: vec![RangeState {
                start: 0,
                end: done.saturating_sub(1),
                done,
            }],
        };
        let _ = save_resume_metadata(opts.part_dir, &meta);
        let _ = resume_meta;
        return Ok(());
    }
}
#[allow(clippy::too_many_arguments)]
fn fetch_multi_range(
    agent: &ureq::Agent,
    opts: &FetchFileOptions<'_>,
    total: u64,
    validator: Option<&str>,
    safe_name: &str,
    payload_path: &Path,
    cancel: &AtomicBool,
    on_progress: &mut impl FnMut(u64, Option<u64>),
) -> Result<(), AppError> {
    const NUM_WORKERS: usize = 4;
    let chunk_size = total / (NUM_WORKERS as u64);

    let mut ranges = Vec::with_capacity(NUM_WORKERS);
    for i in 0..NUM_WORKERS {
        let start = (i as u64) * chunk_size;
        let end = if i == NUM_WORKERS - 1 {
            total - 1
        } else {
            ((i as u64) + 1) * chunk_size - 1
        };
        ranges.push(RangeState {
            start,
            end,
            done: 0,
        });
    }

    // Check existing resume.json
    if let Some(meta) = load_resume_metadata(opts.part_dir, opts.url)
        && meta.validator.as_deref() == validator
            && meta.total == Some(total)
            && meta.ranges.len() == NUM_WORKERS
        {
            for (i, r) in meta.ranges.iter().enumerate() {
                if r.start == ranges[i].start && r.end == ranges[i].end {
                    ranges[i].done = r.done.min(r.end - r.start + 1);
                }
            }
        }

    // Pre-allocate payload.part
    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(payload_path)?;
    file.set_len(total)?;
    drop(file);

    let static_ranges = ranges.clone();
    let dones = Arc::new([
        AtomicU64::new(ranges[0].done),
        AtomicU64::new(ranges[1].done),
        AtomicU64::new(ranges[2].done),
        AtomicU64::new(ranges[3].done),
    ]);
    let initial_done: u64 = ranges.iter().map(|r| r.done).sum();
    let total_done = Arc::new(AtomicU64::new(initial_done));

    on_progress(total_done.load(Ordering::Relaxed), Some(total));

    let worker_limit = if opts.limit > 0 {
        (opts.limit / NUM_WORKERS as u64).max(1)
    } else {
        0
    };

    let ckpt_lock = Arc::new(std::sync::Mutex::new(()));
    let (err_tx, err_rx) = mpsc::channel();
    std::thread::scope(|s| {
        for worker_idx in 0..NUM_WORKERS {
            let agent = agent.clone();
            let dones = Arc::clone(&dones);
            let total_done = Arc::clone(&total_done);
            let ckpt_lock = Arc::clone(&ckpt_lock);
            let err_tx = err_tx.clone();
            let url = opts.url.to_string();
            let validator_str = validator.map(|v| v.to_string());
            let safe_name_str = safe_name.to_string();
            let payload_path_buf = payload_path.to_path_buf();
            let part_dir_buf = opts.part_dir.to_path_buf();
            let cancel = &cancel;
            let worker_ranges = static_ranges.clone();
            s.spawn(move || {
                let start = worker_ranges[worker_idx].start;
                let end = worker_ranges[worker_idx].end;
                let mut done = dones[worker_idx].load(Ordering::Relaxed);

                let range_len = end - start + 1;
                if done >= range_len {
                    return;
                }

                let mut worker_file = match OpenOptions::new().write(true).open(&payload_path_buf) {
                    Ok(f) => f,
                    Err(e) => {
                        let _ = err_tx.send(format!("Buka file gagal: {e}"));
                        return;
                    }
                };

                let mut attempts = 0u32;
                while done < range_len {
                    if cancel.load(Ordering::SeqCst) {
                        return;
                    }

                    let fetch_start = start + done;
                    let mut req = agent
                        .get(&url)
                        .header("User-Agent", "Anchoa")
                        .header("Accept-Encoding", "identity")
                        .header("Range", &format!("bytes={fetch_start}-{end}"));

                    if let Some(ref v) = validator_str {
                        req = req.header("If-Range", v);
                    }

                    let mut resp = match req.call() {
                        Ok(r) => r,
                        Err(e) => {
                            attempts += 1;
                            if let Err(err) = classify_and_delay_retry(&e, attempts, cancel) {
                                let _ = err_tx.send(format!("Worker {worker_idx} gagal: {err}"));
                                return;
                            }
                            continue;
                        }
                    };

                    let status = resp.status().as_u16();
                    if status != 206 {
                        let _ = err_tx.send(format!("Worker {worker_idx} menerima HTTP {status}"));
                        return;
                    }

                    let cr_header = resp.headers().get("content-range").and_then(|h| h.to_str().ok()).unwrap_or("");
                    if let Err(e) = parse_and_validate_content_range(cr_header, fetch_start, Some(end), Some(total)) {
                        let _ = err_tx.send(format!("Worker {worker_idx} Content-Range invalid: {e}"));
                        return;
                    }

                    if let Some(ref v) = validator_str
                        && let Some(resp_etag) = resp.headers().get("etag").and_then(|h| h.to_str().ok())
                            && resp_etag != v {
                                let _ = err_tx.send(format!("Worker {worker_idx} ETag mismatch: {resp_etag} != {v}"));
                                return;
                            }

                    if let Err(e) = worker_file.seek(SeekFrom::Start(fetch_start)) {
                        let _ = err_tx.send(format!("Worker {worker_idx} seek gagal: {e}"));
                        return;
                    }

                    let mut reader = resp.body_mut().as_reader();
                    let mut buf = [0u8; 64 * 1024];
                    let mut bytes_since_ckpt = 0u64;
                    let mut last_ckpt = Instant::now();

                    let mut read_failed = false;
                    while done < range_len {
                        if cancel.load(Ordering::SeqCst) {
                            let _ = worker_file.sync_data();
                            return;
                        }

                        let t_start = Instant::now();
                        let max_read = (range_len - done).min(buf.len() as u64) as usize;
                        let n = match reader.read(&mut buf[..max_read]) {
                            Ok(0) => {
                                if done < range_len {
                                    read_failed = true;
                                }
                                break;
                            }
                            Ok(n) => n,
                            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                            Err(_) => {
                                read_failed = true;
                                break;
                            }
                        };

                        if let Err(e) = worker_file.write_all(&buf[..n]) {
                            let _ = err_tx.send(format!("Worker {worker_idx} tulis gagal: {e}"));
                            return;
                        }

                        done += n as u64;
                        bytes_since_ckpt += n as u64;
                        total_done.fetch_add(n as u64, Ordering::Relaxed);

                        if bytes_since_ckpt >= 1024 * 1024 || last_ckpt.elapsed() >= Duration::from_secs(2) {
                            if let Err(e) = worker_file.sync_data() {
                                let _ = err_tx.send(format!("Worker {worker_idx} sync_data gagal: {e}"));
                                return;
                            }
                            dones[worker_idx].store(done, Ordering::Relaxed);
                            let snapshot_ranges: Vec<RangeState> = (0..NUM_WORKERS)
                                .map(|i| RangeState {
                                    start: worker_ranges[i].start,
                                    end: worker_ranges[i].end,
                                    done: dones[i].load(Ordering::Relaxed),
                                })
                                .collect();
                            let meta = ResumeMetadata {
                                version: 1,
                                url: url.clone(),
                                validator: validator_str.clone(),
                                total: Some(total),
                                safe_name: safe_name_str.clone(),
                                ranges: snapshot_ranges,
                            };
                            {
                                let _guard = ckpt_lock.lock().unwrap();
                                if let Err(e) = save_resume_metadata(&part_dir_buf, &meta) {
                                    let _ = err_tx.send(format!("Worker {worker_idx} checkpoint gagal: {e}"));
                                    return;
                                }
                            }
                            last_ckpt = Instant::now();
                            bytes_since_ckpt = 0;
                        }
                        if worker_limit > 0 {
                            let expected = Duration::from_secs_f64(n as f64 / worker_limit as f64);
                            let elapsed = t_start.elapsed();
                            if expected > elapsed {
                                std::thread::sleep(expected - elapsed);
                            }
                        }
                    }

                    let _ = worker_file.flush();
                    if let Err(e) = worker_file.sync_data() {
                        let _ = err_tx.send(format!("Worker {worker_idx} sync_data gagal: {e}"));
                        return;
                    }

                    dones[worker_idx].store(done, Ordering::Relaxed);
                    let snapshot_ranges: Vec<RangeState> = (0..NUM_WORKERS)
                        .map(|i| RangeState {
                            start: worker_ranges[i].start,
                            end: worker_ranges[i].end,
                            done: dones[i].load(Ordering::Relaxed),
                        })
                        .collect();
                    let meta = ResumeMetadata {
                        version: 1,
                        url: url.clone(),
                        validator: validator_str.clone(),
                        total: Some(total),
                        safe_name: safe_name_str.clone(),
                        ranges: snapshot_ranges,
                    };
                    {
                        let _guard = ckpt_lock.lock().unwrap();
                        if let Err(e) = save_resume_metadata(&part_dir_buf, &meta) {
                            let _ = err_tx.send(format!("Worker {worker_idx} checkpoint gagal: {e}"));
                            return;
                        }
                    }
                    if read_failed {
                        attempts += 1;
                        if attempts <= 3 {
                            std::thread::sleep(Duration::from_secs(1 << (attempts - 1)));
                            continue;
                        }
                        let _ = err_tx.send(format!("Worker {worker_idx} terputus"));
                        return;
                    }
                }
            });
        }
    });

    on_progress(total_done.load(Ordering::Relaxed), Some(total));

    if cancel.load(Ordering::SeqCst) {
        return Err(AppError::Other("Unduhan dihentikan".into()));
    }

    drop(err_tx);
    if let Ok(err) = err_rx.recv() {
        return Err(AppError::Other(err));
    }

    let final_ranges: Vec<RangeState> = (0..NUM_WORKERS)
        .map(|i| RangeState {
            start: ranges[i].start,
            end: ranges[i].end,
            done: dones[i].load(Ordering::Relaxed),
        })
        .collect();
    let meta = ResumeMetadata {
        version: 1,
        url: opts.url.to_string(),
        validator: validator.map(|v| v.to_string()),
        total: Some(total),
        safe_name: safe_name.to_string(),
        ranges: final_ranges,
    };
    save_resume_metadata(opts.part_dir, &meta)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;

    #[test]
    fn content_disposition_prefers_the_encoded_name() {
        let cd = "attachment; filename=\"lama.pdf\"; filename*=UTF-8''laporan%20baru.pdf";
        assert_eq!(
            filename_from_content_disposition(cd).as_deref(),
            Some("laporan baru.pdf")
        );
        assert_eq!(
            filename_from_content_disposition("inline; filename='a b.txt'").as_deref(),
            Some("a b.txt")
        );
        assert_eq!(filename_from_content_disposition("attachment"), None);
    }

    #[test]
    fn percent_decode_keeps_invalid_escapes() {
        assert_eq!(percent_decode("my%20file%2Epdf"), "my file.pdf");
        assert_eq!(percent_decode("a%zzb%4"), "a%zzb%4");
        assert_eq!(
            filename_from_url("http://x/dir/laporan%20akhir.pdf?v=2"),
            "laporan akhir.pdf"
        );
    }

    #[test]
    fn fetch_file_downloads_and_resumes_with_range() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let full_data = b"0123456789abcdefghij";

        std::thread::spawn(move || {
            // 1. Probe request (bytes=0-0)
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            for line in reader.by_ref().lines().map_while(Result::ok) {
                if line.is_empty() {
                    break;
                }
            }
            let probe_resp = format!(
                "HTTP/1.1 206 Partial Content\r\nETag: \"etag-test-1\"\r\nContent-Range: bytes 0-0/{}\r\nContent-Length: 1\r\nConnection: close\r\n\r\n0",
                full_data.len()
            );
            stream.write_all(probe_resp.as_bytes()).unwrap();
            stream.flush().unwrap();

            // 2. Fetch remainder (bytes=10-)
            let (mut stream2, _) = listener.accept().unwrap();
            let mut reader2 = BufReader::new(stream2.try_clone().unwrap());
            let mut range_header = None;
            for line in reader2.by_ref().lines().map_while(Result::ok) {
                if line.is_empty() {
                    break;
                }
                if line.to_lowercase().starts_with("range:") {
                    range_header = Some(line);
                }
            }

            assert!(range_header.is_some());
            let range = range_header.unwrap();
            assert!(range.contains("bytes=10-"));

            let body = &full_data[10..];
            let resp = format!(
                "HTTP/1.1 206 Partial Content\r\nETag: \"etag-test-1\"\r\nContent-Range: bytes 10-19/20\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream2.write_all(resp.as_bytes()).unwrap();
            stream2.write_all(body).unwrap();
            stream2.flush().unwrap();
        });

        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("downloads");
        let part_dir = dir.join(".anchoa-part").join("test-dl");
        std::fs::create_dir_all(&part_dir).unwrap();

        let payload_file = part_dir.join("payload.part");
        std::fs::write(&payload_file, &full_data[..10]).unwrap();

        // Write existing resume.json
        let meta = ResumeMetadata {
            version: 1,
            url: format!("http://127.0.0.1:{port}/sample.bin"),
            validator: Some("\"etag-test-1\"".into()),
            total: Some(20),
            safe_name: "sample.bin".into(),
            ranges: vec![RangeState {
                start: 0,
                end: 19,
                done: 10,
            }],
        };
        save_resume_metadata(&part_dir, &meta).unwrap();

        let cancel = AtomicBool::new(false);
        let url = format!("http://127.0.0.1:{port}/sample.bin");

        let opts = FetchFileOptions::new(&url, &dir, &part_dir);
        let mut progress_calls = Vec::new();
        let res = fetch_file(&opts, &cancel, |done, total| {
            progress_calls.push((done, total));
        })
        .unwrap();

        assert_eq!(res.path.file_name().unwrap(), "sample.bin");
        let downloaded = std::fs::read(&res.path).unwrap();
        assert_eq!(downloaded, full_data);
        assert!(!part_dir.exists());
    }

    #[test]
    fn fetch_file_verifies_sha256_integrity() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let full_data = b"verified-integrity-content";

        std::thread::spawn(move || {
            // Probe
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            for line in reader.by_ref().lines().map_while(Result::ok) {
                if line.is_empty() {
                    break;
                }
            }
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                full_data.len()
            );
            stream.write_all(resp.as_bytes()).unwrap();
            let _ = stream.flush();

            // Fetch
            let (mut stream2, _) = listener.accept().unwrap();
            let mut reader2 = BufReader::new(stream2.try_clone().unwrap());
            for line in reader2.by_ref().lines().map_while(Result::ok) {
                if line.is_empty() {
                    break;
                }
            }
            let resp2 = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                full_data.len()
            );
            stream2.write_all(resp2.as_bytes()).unwrap();
            stream2.write_all(full_data).unwrap();
            stream2.flush().unwrap();
        });

        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("downloads");
        let part_dir = dir.join(".anchoa-part").join("test-sha");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&part_dir).unwrap();

        let mut hasher = Sha256::new();
        hasher.update(full_data);
        let correct_hash = format!("{:x}", hasher.finalize());

        let cancel = AtomicBool::new(false);
        let url = format!("http://127.0.0.1:{port}/integrity.bin");

        // 1. Matching hash succeeds
        let mut opts = FetchFileOptions::new(&url, &dir, &part_dir);
        opts.expected_sha256 = Some(&correct_hash);

        let res = fetch_file(&opts, &cancel, |_, _| {}).unwrap();
        assert_eq!(res.actual_sha256, correct_hash);

        // 2. Mismatched hash fails
        std::fs::create_dir_all(&part_dir).unwrap();
        let wrong_hash = "0000000000000000000000000000000000000000000000000000000000000000";
        let mut opts_wrong = FetchFileOptions::new(&url, &dir, &part_dir);
        opts_wrong.expected_sha256 = Some(wrong_hash);

        let listener2 = TcpListener::bind("127.0.0.1:0").unwrap();
        let port2 = listener2.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut stream, _) = listener2.accept().unwrap();
            let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\n");
            let (mut stream2, _) = listener2.accept().unwrap();
            let _ = stream2.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ndata");
        });
        let url2 = format!("http://127.0.0.1:{port2}/integrity2.bin");
        opts_wrong.url = &url2;

        let err = fetch_file(&opts_wrong, &cancel, |_, _| {}).unwrap_err();
        assert!(err.to_string().contains("Integritas SHA-256 tidak cocok"));
    }

    #[test]
    fn fetch_file_restarts_when_range_is_ignored() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let full_data = b"fresh-unranged-data";

        std::thread::spawn(move || {
            // Probe
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            for line in reader.by_ref().lines().map_while(Result::ok) {
                if line.is_empty() {
                    break;
                }
            }
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                full_data.len()
            );
            stream.write_all(resp.as_bytes()).unwrap();

            // Fetch
            let (mut stream2, _) = listener.accept().unwrap();
            let mut reader2 = BufReader::new(stream2.try_clone().unwrap());
            for line in reader2.by_ref().lines().map_while(Result::ok) {
                if line.is_empty() {
                    break;
                }
            }
            let resp2 = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                full_data.len()
            );
            stream2.write_all(resp2.as_bytes()).unwrap();
            stream2.write_all(full_data).unwrap();
            stream2.flush().unwrap();
        });

        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("downloads");
        let part_dir = dir.join(".anchoa-part").join("test-dl");
        std::fs::create_dir_all(&part_dir).unwrap();

        let payload_file = part_dir.join("payload.part");
        std::fs::write(&payload_file, b"OLD_CORRUPTED_PARTIAL_DATA").unwrap();

        let cancel = AtomicBool::new(false);
        let url = format!("http://127.0.0.1:{port}/file.bin");

        let opts = FetchFileOptions::new(&url, &dir, &part_dir);
        let res = fetch_file(&opts, &cancel, |_, _| {}).unwrap();

        assert_eq!(res.path.file_name().unwrap(), "file.bin");
        let downloaded = std::fs::read(&res.path).unwrap();
        assert_eq!(downloaded, full_data);
    }

    #[test]
    fn fetch_file_stops_when_cancelled() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            for line in reader.by_ref().lines().map_while(Result::ok) {
                if line.is_empty() {
                    break;
                }
            }
            let resp = "HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n";
            let _ = stream.write_all(resp.as_bytes());
            let _ = stream.write_all(&[0u8; 100]);
            let _ = stream.flush();
            std::thread::sleep(Duration::from_millis(500));
        });

        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("downloads");
        let part_dir = dir.join(".anchoa-part").join("test-dl");
        std::fs::create_dir_all(&part_dir).unwrap();

        let cancel = AtomicBool::new(true); // already cancelled
        let url = format!("http://127.0.0.1:{port}/cancel.bin");

        let opts = FetchFileOptions::new(&url, &dir, &part_dir);
        let res = fetch_file(&opts, &cancel, |_, _| {});
        assert!(res.is_err());
        assert!(!dir.join("cancel.bin").exists());
    }

    #[test]
    fn fetch_file_picks_a_unique_name() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let data = b"new unique file content";

        std::thread::spawn(move || {
            // Probe
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            for line in reader.by_ref().lines().map_while(Result::ok) {
                if line.is_empty() {
                    break;
                }
            }
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Disposition: attachment; filename=\"report.pdf\"\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                data.len()
            );
            stream.write_all(resp.as_bytes()).unwrap();

            // Fetch
            let (mut stream2, _) = listener.accept().unwrap();
            let mut reader2 = BufReader::new(stream2.try_clone().unwrap());
            for line in reader2.by_ref().lines().map_while(Result::ok) {
                if line.is_empty() {
                    break;
                }
            }
            let resp2 = format!(
                "HTTP/1.1 200 OK\r\nContent-Disposition: attachment; filename=\"report.pdf\"\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                data.len()
            );
            stream2.write_all(resp2.as_bytes()).unwrap();
            stream2.write_all(data).unwrap();
            stream2.flush().unwrap();
        });

        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("downloads");
        let part_dir = dir.join(".anchoa-part").join("test-dl");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&part_dir).unwrap();

        // create existing report.pdf
        std::fs::write(dir.join("report.pdf"), b"existing file").unwrap();

        let cancel = AtomicBool::new(false);
        let url = format!("http://127.0.0.1:{port}/ignored.bin");

        let opts = FetchFileOptions::new(&url, &dir, &part_dir);
        let res = fetch_file(&opts, &cancel, |_, _| {}).unwrap();

        assert_eq!(res.path.file_name().unwrap(), "report (2).pdf");
        assert_eq!(std::fs::read(&res.path).unwrap(), data);
        assert_eq!(std::fs::read(dir.join("report.pdf")).unwrap(), b"existing file");
    }

    #[test]
    fn parse_and_validate_content_range_checks() {
        let ok = parse_and_validate_content_range("bytes 0-99/100", 0, Some(99), Some(100)).unwrap();
        assert_eq!(ok, (0, 99, Some(100)));

        // Mismatched start
        assert!(parse_and_validate_content_range("bytes 10-99/100", 0, Some(99), Some(100)).is_err());
        // Mismatched end
        assert!(parse_and_validate_content_range("bytes 0-50/100", 0, Some(99), Some(100)).is_err());
        // Mismatched total
        assert!(parse_and_validate_content_range("bytes 0-99/200", 0, Some(99), Some(100)).is_err());
        // Bad syntax
        assert!(parse_and_validate_content_range("items 0-99/100", 0, Some(99), Some(100)).is_err());
        assert!(parse_and_validate_content_range("not-a-range", 0, Some(99), Some(100)).is_err());
    }

    #[test]
    fn fetch_file_rejects_truncated_early_eof() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        std::thread::spawn(move || {
            // Probe: announces 100 bytes
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            for line in reader.by_ref().lines().map_while(Result::ok) {
                if line.is_empty() {
                    break;
                }
            }
            let resp = "HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\n";
            stream.write_all(resp.as_bytes()).unwrap();

            // Fetch stream: sends only 10 bytes and abruptly closes
            let (mut stream2, _) = listener.accept().unwrap();
            let mut reader2 = BufReader::new(stream2.try_clone().unwrap());
            for line in reader2.by_ref().lines().map_while(Result::ok) {
                if line.is_empty() {
                    break;
                }
            }
            let resp2 = "HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\n";
            stream2.write_all(resp2.as_bytes()).unwrap();
            stream2.write_all(b"1234567890").unwrap();
            stream2.flush().unwrap();
            drop(stream2);
        });

        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("downloads");
        let part_dir = dir.join(".anchoa-part").join("test-eof");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::create_dir_all(&part_dir).unwrap();

        let cancel = AtomicBool::new(false);
        let url = format!("http://127.0.0.1:{port}/truncate.bin");

        let opts = FetchFileOptions::new(&url, &dir, &part_dir);
        let res = fetch_file(&opts, &cancel, |_, _| {});
        assert!(res.is_err(), "Truncated file should fail and not be published as Done");
        assert!(!dir.join("truncate.bin").exists(), "Partial file must not be published");
    }
}
