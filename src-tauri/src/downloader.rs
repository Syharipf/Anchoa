//! Background download runner and process scheduler (spec Fase 7 §4).
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use serde::Serialize;
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

    /// Starts queued downloads until the parallel limit is reached.
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
        // ponytail: even split over the parallel limit, dynamic sharing later
        let limit = settings.limit / u64::from(settings.parallel);

        for id in downloads::next_queued(&conn, parallel - map.len())? {
            // A paused worker that has not exited yet still owns this id.
            // Its cleanup calls schedule() again and starts it then.
            if map.contains_key(&id) {
                continue;
            }
            downloads::set_status(&conn, &id, DownloadStatus::Running, None, time::now_ms())?;
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
            run_file(&app, &id, &row.url, &dir, &part_dir, limit, &cancel)
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
    url: &str,
    dir: &Path,
    part_dir: &Path,
    limit: u64,
    cancel: &AtomicBool,
) -> Outcome {
    let mut last: Option<(Instant, u64)> = None;
    let result = fetch_file(url, dir, part_dir, limit, cancel, |done, total| {
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
        Ok(path) => {
            with_db(app, |conn| {
                downloads::set_file(conn, id, &path.to_string_lossy())?;
                match path.file_name() {
                    Some(name) => downloads::set_title(conn, id, &name.to_string_lossy()),
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
    // yt-dlp writes its errors to stderr; the last one becomes the message.
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
    // The pipes are taken, so pausing can kill the child while this thread reads.
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
            Some(YtEvent::Title(title)) => with_db(app, |conn| downloads::set_title(conn, id, &title)),
            Some(YtEvent::File(path)) => with_db(app, |conn| downloads::set_file(conn, id, &path)),
            Some(YtEvent::Error(e)) => stdout_error = Some(e),
            _ => {}
        }
    }

    let child = with_live(app, id, |live| live.child.take()).flatten();
    let status = child.and_then(|mut child| {
        // Covers a pause that came before the child was stored in the map.
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
            Outcome::Failed(msg) => downloads::set_status(conn, id, DownloadStatus::Failed, Some(&msg), now),
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

fn filename_from_content_disposition(cd: &str) -> Option<String> {
    for part in cd.split(';') {
        let part = part.trim();
        if let Some(rest) = part.strip_prefix("filename*=") {
            let rest = rest.trim();
            let value = if let Some((_, encoded)) = rest.split_once("''") {
                encoded
            } else {
                rest
            };
            let decoded = percent_decode(value);
            if !decoded.is_empty() {
                return Some(decoded);
            }
        } else if let Some(rest) = part.strip_prefix("filename=") {
            let mut val = rest.trim();
            if ((val.starts_with('"') && val.ends_with('"'))
                || (val.starts_with('\'') && val.ends_with('\'')))
                && val.len() >= 2
            {
                val = &val[1..val.len() - 1];
            }
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
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

pub fn fetch_file(
    url: &str,
    dir: &Path,
    part_dir: &Path,
    limit: u64,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(u64, Option<u64>),
) -> Result<PathBuf, AppError> {
    std::fs::create_dir_all(part_dir)?;

    let url_name = filename_from_url(url);
    let existing_part = std::fs::read_dir(part_dir)
        .ok()
        .and_then(|mut entries| {
            entries.find_map(|e| {
                e.ok().map(|e| e.path()).filter(|p| {
                    p.extension().is_some_and(|ext| ext == "part")
                })
            })
        });

    let part_path = existing_part.unwrap_or_else(|| part_dir.join(format!("{url_name}.part")));
    let existing_len = if part_path.exists() {
        std::fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };

    let mut req = ureq::get(url).header("User-Agent", "Anchoa");
    if existing_len > 0 {
        req = req.header("Range", &format!("bytes={existing_len}-"));
    }

    let mut resp = req
        .call()
        .map_err(|e| AppError::Other(format!("Gagal mengunduh: {e}")))?;

    let status = resp.status().as_u16();

    let (mut file, mut done, total) = if status == 206 {
        let f = OpenOptions::new().append(true).open(&part_path)?;
        let content_range = resp.headers().get("content-range").and_then(|h| h.to_str().ok());
        let total = content_range
            .and_then(|cr| cr.split('/').nth(1))
            .and_then(|tot| tot.trim().parse::<u64>().ok())
            .or_else(|| {
                resp.headers()
                    .get("content-length")
                    .and_then(|h| h.to_str().ok())
                    .and_then(|len| len.parse::<u64>().ok())
                    .map(|len| len + existing_len)
            });
        (f, existing_len, total)
    } else if status == 200 {
        let f = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&part_path)?;
        let total = resp
            .headers()
            .get("content-length")
            .and_then(|h| h.to_str().ok())
            .and_then(|len| len.parse::<u64>().ok());
        (f, 0u64, total)
    } else {
        return Err(AppError::Other(format!("Status HTTP {status} tidak didukung")));
    };

    let final_name = resp
        .headers()
        .get("content-disposition")
        .and_then(|h| h.to_str().ok())
        .and_then(filename_from_content_disposition)
        .map(|raw| crate::downloads::safe_name(&raw))
        .filter(|s| !s.is_empty() && s != "unduhan")
        .unwrap_or(url_name);

    let mut reader = resp.body_mut().as_reader();
    let mut buf = [0u8; 64 * 1024];
    on_progress(done, total);

    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(AppError::Other("Unduhan dibatalkan".into()));
        }
        let start = Instant::now();
        let n = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e.into()),
        };

        file.write_all(&buf[..n])?;
        done += n as u64;
        on_progress(done, total);

        if limit > 0 {
            let expected = Duration::from_secs_f64(n as f64 / limit as f64);
            let elapsed = start.elapsed();
            if expected > elapsed {
                std::thread::sleep(expected - elapsed);
            }
        }
    }

    file.flush()?;
    drop(file);

    let target = dir.join(&final_name);
    let final_path = if std::fs::symlink_metadata(&target).is_ok() {
        crate::files::unique_name(dir, &final_name)
    } else {
        target
    };
    if std::fs::rename(&part_path, &final_path).is_err() {
        std::fs::copy(&part_path, &final_path)?;
        let _ = std::fs::remove_file(&part_path);
    }

    Ok(final_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;

    #[test]
    fn percent_decode_keeps_invalid_escapes() {
        assert_eq!(percent_decode("my%20file%2Epdf"), "my file.pdf");
        assert_eq!(percent_decode("a%zzb%4"), "a%zzb%4");
        assert_eq!(filename_from_url("http://x/dir/laporan%20akhir.pdf?v=2"), "laporan akhir.pdf");
    }

    #[test]
    fn fetch_file_downloads_and_resumes_with_range() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let full_data = b"0123456789abcdefghij";

        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut range_header = None;
            for line in reader.by_ref().lines().map_while(Result::ok) {
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
                "HTTP/1.1 206 Partial Content\r\nContent-Type: application/octet-stream\r\nContent-Range: bytes 10-19/20\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(resp.as_bytes()).unwrap();
            stream.write_all(body).unwrap();
            stream.flush().unwrap();
        });

        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("downloads");
        let part_dir = dir.join(".anchoa-part").join("test-dl");
        std::fs::create_dir_all(&part_dir).unwrap();

        let part_file = part_dir.join("sample.bin.part");
        std::fs::write(&part_file, &full_data[..10]).unwrap();

        let cancel = AtomicBool::new(false);
        let url = format!("http://127.0.0.1:{port}/sample.bin");

        let mut progress_calls = Vec::new();
        let path = fetch_file(&url, &dir, &part_dir, 0, &cancel, |done, total| {
            progress_calls.push((done, total));
        })
        .unwrap();

        assert_eq!(path.file_name().unwrap(), "sample.bin");
        let downloaded = std::fs::read(&path).unwrap();
        assert_eq!(downloaded, full_data);
        assert!(!part_file.exists());
    }

    #[test]
    fn fetch_file_restarts_when_range_is_ignored() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let full_data = b"fresh-unranged-data";

        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            for line in reader.by_ref().lines().map_while(Result::ok) {
                if line.is_empty() {
                    break;
                }
            }

            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                full_data.len()
            );
            stream.write_all(resp.as_bytes()).unwrap();
            stream.write_all(full_data).unwrap();
            stream.flush().unwrap();
        });

        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("downloads");
        let part_dir = dir.join(".anchoa-part").join("test-dl");
        std::fs::create_dir_all(&part_dir).unwrap();

        let part_file = part_dir.join("file.bin.part");
        std::fs::write(&part_file, b"OLD_CORRUPTED_PARTIAL_DATA").unwrap();

        let cancel = AtomicBool::new(false);
        let url = format!("http://127.0.0.1:{port}/file.bin");

        let path = fetch_file(&url, &dir, &part_dir, 0, &cancel, |_, _| {}).unwrap();

        assert_eq!(path.file_name().unwrap(), "file.bin");
        let downloaded = std::fs::read(&path).unwrap();
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

        let res = fetch_file(&url, &dir, &part_dir, 0, &cancel, |_, _| {});
        assert!(res.is_err());
        assert!(!dir.join("cancel.bin").exists());
    }

    #[test]
    fn fetch_file_picks_a_unique_name() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let data = b"new unique file content";

        std::thread::spawn(move || {
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
            stream.write_all(data).unwrap();
            stream.flush().unwrap();
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

        let path = fetch_file(&url, &dir, &part_dir, 0, &cancel, |_, _| {}).unwrap();

        assert_eq!(path.file_name().unwrap(), "report (2).pdf");
        assert_eq!(std::fs::read(&path).unwrap(), data);
        assert_eq!(std::fs::read(dir.join("report.pdf")).unwrap(), b"existing file");
    }
}
