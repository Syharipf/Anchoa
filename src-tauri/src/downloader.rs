//! Background download runner and process scheduler (spec Fase 7 §4).
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::AppError;

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

impl Downloader {
    pub fn schedule(&self, app: &AppHandle) -> Result<(), AppError> {
        let db = app.state::<crate::db::Db>();
        let conn = db.conn()?;
        let home = app.path().home_dir()?;
        let user_dirs_path = home.join(".config").join("user-dirs.dirs");
        let user_dirs_text = std::fs::read_to_string(&user_dirs_path).ok();
        let default_dir =
            crate::files::xdg_dir(&home, user_dirs_text.as_deref(), "XDG_DOWNLOAD_DIR", "Downloads");
        let settings = crate::downloads::settings(&conn, &default_dir)?;

        let mut map = self
            .inner
            .lock()
            .map_err(|_| AppError::Other("Mutex poisoned".into()))?;

        let parallel = settings.parallel as usize;
        if map.len() >= parallel {
            return Ok(());
        }
        let slots = parallel - map.len();

        let ids = crate::downloads::next_queued(&conn, slots)?;
        if ids.is_empty() {
            return Ok(());
        }

        // ponytail: even split, dynamic sharing later
        let limit_per_dl = if settings.limit > 0 {
            settings.limit / (settings.parallel as u64)
        } else {
            0
        };

        for id in ids {
            crate::downloads::set_status(
                &conn,
                &id,
                crate::downloads::DownloadStatus::Running,
                None,
                crate::time::now_ms(),
            )?;

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

            let app_handle = app.clone();
            let dl_id = id;
            let dest_dir = settings.dir.clone();

            std::thread::spawn(move || {
                worker(app_handle, dl_id, cancel, limit_per_dl, dest_dir);
            });
        }

        Ok(())
    }

    pub fn pause(&self, id: &str) -> Result<(), AppError> {
        let mut map = self
            .inner
            .lock()
            .map_err(|_| AppError::Other("Mutex poisoned".into()))?;
        if let Some(live) = map.get_mut(id) {
            live.cancel.store(true, Ordering::SeqCst);
            if let Some(child) = &mut live.child {
                let _ = child.kill();
            }
        }
        Ok(())
    }

    pub fn cancel(&self, id: &str) -> Result<(), AppError> {
        let mut map = self
            .inner
            .lock()
            .map_err(|_| AppError::Other("Mutex poisoned".into()))?;
        if let Some(live) = map.get_mut(id) {
            live.cancel.store(true, Ordering::SeqCst);
            if let Some(child) = &mut live.child {
                let _ = child.kill();
            }
        }
        Ok(())
    }

    pub fn live(&self) -> HashMap<String, LiveProgress> {
        let Ok(map) = self.inner.lock() else {
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

fn with_live<R>(app: &AppHandle, id: &str, f: impl FnOnce(&mut Live) -> R) -> Option<R> {
    let downloader = app.try_state::<Downloader>()?;
    let mut map = downloader.inner.lock().ok()?;
    let live = map.get_mut(id)?;
    Some(f(live))
}

fn worker(
    app: AppHandle,
    id: String,
    cancel: Arc<AtomicBool>,
    limit: u64,
    dest_dir: String,
) {
    let db = match app.try_state::<crate::db::Db>() {
        Some(db) => db,
        None => return,
    };
    let row = match db.conn().and_then(|conn| crate::downloads::get(&conn, &id)) {
        Ok(row) => row,
        Err(_) => {
            cleanup(&app, &id);
            return;
        }
    };

    let dir = PathBuf::from(&dest_dir);
    let part_dir = dir.join(".anchoa-part").join(&id);
    let _ = std::fs::create_dir_all(&part_dir);

    match row.kind {
        crate::downloads::DownloadKind::File => {
            let last_progress_time = Arc::new(Mutex::new((Instant::now(), 0u64)));
            let app_clone = app.clone();
            let id_clone = id.clone();
            let progress_tracker = last_progress_time.clone();

            let result = fetch_file(
                &row.url,
                &dir,
                &part_dir,
                limit,
                &cancel,
                move |done, total| {
                    let mut speed = None;
                    let mut eta = None;
                    if let Ok(mut pt) = progress_tracker.lock() {
                        let (last_instant, last_done) = *pt;
                        let elapsed = last_instant.elapsed().as_secs_f64();
                        if elapsed >= 0.5 {
                            let bytes_diff = done.saturating_sub(last_done);
                            let current_speed = bytes_diff as f64 / elapsed;
                            speed = Some(current_speed);
                            if let Some(tot) = total
                                && current_speed > 0.0
                                && tot > done
                            {
                                eta = Some(((tot - done) as f64 / current_speed) as u64);
                            }
                            *pt = (Instant::now(), done);
                        }
                    }

                    with_live(&app_clone, &id_clone, |live| {
                        live.done = done;
                        live.total = total;
                        if speed.is_some() {
                            live.speed = speed;
                        }
                        if eta.is_some() {
                            live.eta = eta;
                        }
                    });
                },
            );

            let is_cancelled = cancel.load(Ordering::SeqCst);
            if is_cancelled {
                // A worker that ends with the flag set does not mark Failed.
                if let Ok(conn) = db.conn() {
                    let (done, total) = get_live_progress(&app, &id);
                    let _ = crate::downloads::set_progress(&conn, &id, done as i64, total.map(|t| t as i64));
                }
            } else {
                match result {
                    Ok(final_path) => {
                        if let Ok(conn) = db.conn() {
                            let size = std::fs::metadata(&final_path).map(|m| m.len() as i64).unwrap_or(0);
                            let _ = crate::downloads::set_file(&conn, &id, &final_path.to_string_lossy());
                            let _ = crate::downloads::set_progress(&conn, &id, size, Some(size));
                            let _ = crate::downloads::set_status(
                                &conn,
                                &id,
                                crate::downloads::DownloadStatus::Done,
                                None,
                                crate::time::now_ms(),
                            );
                        }
                        let _ = std::fs::remove_dir_all(&part_dir);
                    }
                    Err(e) => {
                        if let Ok(conn) = db.conn() {
                            let (done, total) = get_live_progress(&app, &id);
                            let _ = crate::downloads::set_progress(&conn, &id, done as i64, total.map(|t| t as i64));
                            let _ = crate::downloads::set_status(
                                &conn,
                                &id,
                                crate::downloads::DownloadStatus::Failed,
                                Some(&e.to_string()),
                                crate::time::now_ms(),
                            );
                        }
                    }
                }
            }
        }
        crate::downloads::DownloadKind::Media => {
            let opts = row.options.unwrap_or_default();
            let args = crate::downloads::build_ytdlp_args(&opts, &dir, &part_dir, limit);

            let mut cmd = std::process::Command::new("yt-dlp");
            cmd.args(&args).arg(&row.url);
            cmd.stdout(std::process::Stdio::piped());
            cmd.stderr(std::process::Stdio::piped());

            let mut child = match cmd.spawn() {
                Ok(child) => child,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    if let Ok(conn) = db.conn() {
                        let msg = "yt-dlp belum terpasang: sudo dnf install yt-dlp ffmpeg";
                        let _ = crate::downloads::set_status(
                            &conn,
                            &id,
                            crate::downloads::DownloadStatus::Failed,
                            Some(msg),
                            crate::time::now_ms(),
                        );
                    }
                    cleanup(&app, &id);
                    return;
                }
                Err(e) => {
                    if let Ok(conn) = db.conn() {
                        let msg = format!("yt-dlp gagal: {e}");
                        let _ = crate::downloads::set_status(
                            &conn,
                            &id,
                            crate::downloads::DownloadStatus::Failed,
                            Some(&msg),
                            crate::time::now_ms(),
                        );
                    }
                    cleanup(&app, &id);
                    return;
                }
            };

            let stdout = child.stdout.take();
            let stderr = child.stderr.take();

            // The worker takes the child's stdout before storing the child in the map
            with_live(&app, &id, |live| {
                live.child = Some(child);
            });

            let last_error = Arc::new(Mutex::new(None::<String>));
            let last_err_clone = last_error.clone();
            if let Some(err_pipe) = stderr {
                std::thread::spawn(move || {
                    let reader = std::io::BufReader::new(err_pipe);
                    use std::io::BufRead;
                    for line in reader.lines().map_while(Result::ok) {
                        if let Some(stripped) = line.strip_prefix("ERROR: ") {
                            if let Ok(mut le) = last_err_clone.lock() {
                                *le = Some(stripped.trim().to_string());
                            }
                        } else if line.contains("ERROR:")
                            && let Ok(mut le) = last_err_clone.lock()
                        {
                            *le = Some(line.trim().to_string());
                        }
                    }
                });
            }

            let mut last_status = crate::downloads::DownloadStatus::Running;
            if let Some(out_pipe) = stdout {
                let reader = std::io::BufReader::new(out_pipe);
                use std::io::BufRead;
                for line in reader.lines().map_while(Result::ok) {
                    if cancel.load(Ordering::SeqCst) {
                        break;
                    }
                    if let Some(event) = crate::downloads::parse_line(&line) {
                        match event {
                            crate::downloads::YtEvent::Progress { done, total, speed, eta } => {
                                with_live(&app, &id, |live| {
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
                            crate::downloads::YtEvent::Post => {
                                if last_status != crate::downloads::DownloadStatus::Processing {
                                    last_status = crate::downloads::DownloadStatus::Processing;
                                    if let Ok(conn) = db.conn() {
                                        let _ = crate::downloads::set_status(
                                            &conn,
                                            &id,
                                            crate::downloads::DownloadStatus::Processing,
                                            None,
                                            crate::time::now_ms(),
                                        );
                                    }
                                }
                            }
                            crate::downloads::YtEvent::Title(title) => {
                                if let Ok(conn) = db.conn() {
                                    let _ = crate::downloads::set_title(&conn, &id, &title);
                                }
                            }
                            crate::downloads::YtEvent::File(path) => {
                                if let Ok(conn) = db.conn() {
                                    let _ = crate::downloads::set_file(&conn, &id, &path);
                                }
                            }
                            crate::downloads::YtEvent::Error(err) => {
                                if let Ok(mut le) = last_error.lock() {
                                    *le = Some(err);
                                }
                            }
                        }
                    }
                }
            }

            // on EOF locks the map and waits
            let child_to_wait = with_live(&app, &id, |live| live.child.take()).flatten();

            let exit_status = if let Some(mut c) = child_to_wait {
                c.wait().ok()
            } else {
                None
            };

            let is_cancelled = cancel.load(Ordering::SeqCst);
            if is_cancelled {
                if let Ok(conn) = db.conn() {
                    let (done, total) = get_live_progress(&app, &id);
                    let _ = crate::downloads::set_progress(&conn, &id, done as i64, total.map(|t| t as i64));
                }
            } else {
                let success = exit_status.is_some_and(|s| s.success());
                if success {
                    if let Ok(conn) = db.conn() {
                        let (done, total) = get_live_progress(&app, &id);
                        let _ = crate::downloads::set_progress(&conn, &id, done as i64, total.map(|t| t as i64));
                        let _ = crate::downloads::set_status(
                            &conn,
                            &id,
                            crate::downloads::DownloadStatus::Done,
                            None,
                            crate::time::now_ms(),
                        );
                    }
                    let _ = std::fs::remove_dir_all(&part_dir);
                } else {
                    let err_msg = if let Ok(le) = last_error.lock() {
                        le.clone()
                    } else {
                        None
                    };
                    let code_str = exit_status
                        .and_then(|s| s.code())
                        .map(|c| c.to_string())
                        .unwrap_or_else(|| "tidak diketahui".into());
                    let msg = err_msg.unwrap_or_else(|| format!("yt-dlp gagal (kode {code_str})"));
                    if let Ok(conn) = db.conn() {
                        let (done, total) = get_live_progress(&app, &id);
                        let _ = crate::downloads::set_progress(&conn, &id, done as i64, total.map(|t| t as i64));
                        let _ = crate::downloads::set_status(
                            &conn,
                            &id,
                            crate::downloads::DownloadStatus::Failed,
                            Some(&msg),
                            crate::time::now_ms(),
                        );
                    }
                }
            }
        }
    }

    cleanup(&app, &id);
}

fn get_live_progress(app: &AppHandle, id: &str) -> (u64, Option<u64>) {
    with_live(app, id, |live| (live.done, live.total)).unwrap_or((0, None))
}

fn cleanup(app: &AppHandle, id: &str) {
    if let Some(downloader) = app.try_state::<Downloader>()
        && let Ok(mut map) = downloader.inner.lock()
    {
        map.remove(id);
    }
    if let Some(downloader) = app.try_state::<Downloader>() {
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

fn percent_decode(s: &str) -> String {
    let mut bytes = Vec::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if hex.len() == 2 && let Ok(b) = u8::from_str_radix(&hex, 16) {
                bytes.push(b);
                continue;
            }
        }
        bytes.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
    }
    String::from_utf8_lossy(&bytes).to_string()
}

fn filename_from_url(url: &str) -> String {
    let clean = url.split('#').next().unwrap_or(url);
    let clean = clean.split('?').next().unwrap_or(clean);
    let segment = clean.rsplit('/').find(|s| !s.is_empty()).unwrap_or("");
    let name = crate::downloads::safe_name(segment);
    if name.is_empty() {
        "unduhan".to_string()
    } else {
        name
    }
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
