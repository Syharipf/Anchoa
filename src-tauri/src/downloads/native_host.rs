//! Chrome & Firefox native messaging host for Anchoa downloads (Fase 7 upgrade).
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::cli;
use crate::db;
use crate::downloads::{self, DownloadKind, safe_name};
use crate::error::AppError;

pub const HOST_NAME: &str = "io.github.syharipf.anchoa.downloads";
pub const FIREFOX_EXTENSION_ID: &str = "downloads@anchoa.local";
pub const MAX_MESSAGE_SIZE: usize = 65536; // 64 KiB cap

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRequest {
    #[serde(default)]
    pub version: u32,
    #[serde(alias = "type")]
    pub action: Option<String>,
    #[serde(default)]
    pub request_id: String,
    pub url: Option<String>,
    pub filename: Option<String>,
    pub referrer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeResponse {
    pub version: u32,
    pub request_id: String,
    pub accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHostStatus {
    pub installed: bool,
    pub chrome_installed: bool,
    pub firefox_installed: bool,
    pub executable_path: String,
    pub chrome_extension_id: Option<String>,
}

pub fn is_valid_chrome_extension_id(id: &str) -> bool {
    id.len() == 32 && id.chars().all(|c| ('a'..='p').contains(&c))
}

pub fn validate_url(url: &str) -> Result<&str, AppError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid("URL tidak boleh kosong".into()));
    }
    let uri = ureq::http::Uri::try_from(trimmed)
        .map_err(|_| AppError::Invalid("Format URL tidak valid".into()))?;
    let scheme = uri.scheme_str().unwrap_or("");
    if scheme != "http" && scheme != "https" {
        return Err(AppError::Invalid(
            "Hanya protokol HTTP dan HTTPS yang didukung".into(),
        ));
    }
    if uri.host().is_none() || uri.host().unwrap().is_empty() {
        return Err(AppError::Invalid("Host URL tidak boleh kosong".into()));
    }
    if trimmed.starts_with("magnet:") || trimmed.ends_with(".torrent") || trimmed.contains(".torrent?") {
        return Err(AppError::Invalid("Torrent belum didukung".into()));
    }
    Ok(trimmed)
}

pub fn read_framed_message<R: Read>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut len_bytes = [0u8; 4];
    match reader.read_exact(&mut len_bytes) {
        Ok(()) => {}
        Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }

    let len = u32::from_ne_bytes(len_bytes) as usize;
    if len > MAX_MESSAGE_SIZE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Pesan melebihi batas {MAX_MESSAGE_SIZE} byte"),
        ));
    }

    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf)?;
    Ok(Some(buf))
}

pub fn write_framed_message<W: Write>(writer: &mut W, data: &[u8]) -> io::Result<()> {
    let len = data.len() as u32;
    writer.write_all(&len.to_ne_bytes())?;
    writer.write_all(data)?;
    writer.flush()?;
    Ok(())
}

pub fn handle_message(conn: &Connection, raw_json: &[u8], now: i64) -> NativeResponse {
    let req: NativeRequest = match serde_json::from_slice(raw_json) {
        Ok(r) => r,
        Err(e) => {
            return NativeResponse {
                version: 1,
                request_id: String::new(),
                accepted: false,
                download_id: None,
                error: Some(format!("Format pesan tidak valid: {e}")),
            };
        }
    };

    let action = req.action.as_deref().unwrap_or("prepare");
    let req_id = req.request_id.trim();
    // Reject handoffs while Anchoa is protected by PIN
    if let Ok(Some(_)) = crate::security::get_pin_hash(conn) {
        return NativeResponse {
            version: 1,
            request_id: req_id.into(),
            accepted: false,
            download_id: None,
            error: Some("Anchoa terkunci PIN".into()),
        };
    }

    match action {
        "ping" => NativeResponse {
            version: 1,
            request_id: "ping".into(),
            accepted: true,
            download_id: None,
            error: None,
        },
        "prepare" => {
            if req_id.is_empty() {
                return NativeResponse {
                    version: 1,
                    request_id: String::new(),
                    accepted: false,
                    download_id: None,
                    error: Some("requestId tidak boleh kosong".into()),
                };
            }

            let url = match req.url.as_deref() {
                Some(u) => match validate_url(u) {
                    Ok(valid) => valid,
                    Err(e) => {
                        return NativeResponse {
                            version: 1,
                            request_id: req_id.into(),
                            accepted: false,
                            download_id: None,
                            error: Some(e.to_string()),
                        };
                    }
                },
                None => {
                    return NativeResponse {
                        version: 1,
                        request_id: req_id.into(),
                        accepted: false,
                        download_id: None,
                        error: Some("URL tidak boleh kosong".into()),
                    };
                }
            };

            // Check if handoff already exists (idempotency)
            let existing: Option<(String, String)> = conn
                .query_row(
                    "SELECT download_id, status FROM native_handoffs WHERE request_id = ?1",
                    params![req_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .ok();

            if let Some((download_id, status)) = existing {
                if status == "pending" || status == "committed" {
                    return NativeResponse {
                        version: 1,
                        request_id: req_id.into(),
                        accepted: true,
                        download_id: Some(download_id),
                        error: None,
                    };
                }
            }

            let download_id = uuid::Uuid::now_v7().to_string();
            let expires_at = now + 60_000; // 60 seconds TTL

            let res = conn.execute(
                "INSERT INTO native_handoffs (request_id, download_id, url, filename, referrer, status, created_at, expires_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7)
                 ON CONFLICT(request_id) DO UPDATE SET
                   download_id = excluded.download_id,
                   url = excluded.url,
                   filename = excluded.filename,
                   referrer = excluded.referrer,
                   status = 'pending',
                   created_at = excluded.created_at,
                   expires_at = excluded.expires_at",
                params![req_id, download_id, url, req.filename, req.referrer, now, expires_at],
            );

            match res {
                Ok(_) => NativeResponse {
                    version: 1,
                    request_id: req_id.into(),
                    accepted: true,
                    download_id: Some(download_id),
                    error: None,
                },
                Err(e) => NativeResponse {
                    version: 1,
                    request_id: req_id.into(),
                    accepted: false,
                    download_id: None,
                    error: Some(e.to_string()),
                },
            }
        }
        "commit" => {
            if req_id.is_empty() {
                return NativeResponse {
                    version: 1,
                    request_id: String::new(),
                    accepted: false,
                    download_id: None,
                    error: Some("requestId tidak boleh kosong".into()),
                };
            }

            let row: Option<(String, String, Option<String>, String, i64)> = conn
                .query_row(
                    "SELECT download_id, url, filename, status, expires_at FROM native_handoffs WHERE request_id = ?1",
                    params![req_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .ok();

            let (download_id, url, filename, status, expires_at) = match row {
                Some(r) => r,
                None => {
                    return NativeResponse {
                        version: 1,
                        request_id: req_id.into(),
                        accepted: false,
                        download_id: None,
                        error: Some("Handoff request tidak ditemukan".into()),
                    };
                }
            };

            if status == "committed" {
                return NativeResponse {
                    version: 1,
                    request_id: req_id.into(),
                    accepted: true,
                    download_id: Some(download_id),
                    error: None,
                };
            }

            if status != "pending" {
                return NativeResponse {
                    version: 1,
                    request_id: req_id.into(),
                    accepted: false,
                    download_id: None,
                    error: Some("Handoff request tidak valid atau telah dibatalkan".into()),
                };
            }

            if expires_at < now {
                return NativeResponse {
                    version: 1,
                    request_id: req_id.into(),
                    accepted: false,
                    download_id: None,
                    error: Some("Handoff request telah kedaluwarsa".into()),
                };
            }

            let title = match filename {
                Some(name) if !name.trim().is_empty() => safe_name(name.trim()),
                _ => downloads::initial_title(&url, DownloadKind::File),
            };

            #[cfg(not(test))]
            {
                let exe = match std::env::current_exe() {
                    Ok(e) => e,
                    Err(e) => {
                        return NativeResponse {
                            version: 1,
                            request_id: req_id.into(),
                            accepted: false,
                            download_id: None,
                            error: Some(format!("Gagal menemukan binary Anchoa: {e}")),
                        };
                    }
                };
                if let Err(e) = std::process::Command::new(exe).spawn() {
                    return NativeResponse {
                        version: 1,
                        request_id: req_id.into(),
                        accepted: false,
                        download_id: None,
                        error: Some(format!("Gagal meluncurkan aplikasi Anchoa: {e}")),
                    };
                }
            }
            let tx_result = (|| -> Result<(), AppError> {
                let tx = conn.unchecked_transaction()?;
                tx.execute(
                    "INSERT INTO items (id, type, title, body, created_at, updated_at) VALUES (?1, 'download', ?2, '', ?3, ?3)",
                    params![download_id, title, now],
                )?;
                tx.execute(
                    "INSERT INTO downloads (item_id, url, kind, options, status, total_bytes, done_bytes, file_path, error, finished_at, retry_count)
                     VALUES (?1, ?2, 'file', '{}', 'queued', NULL, 0, NULL, NULL, NULL, 0)",
                    params![download_id, url],
                )?;
                tx.execute(
                    "UPDATE native_handoffs SET status = 'committed' WHERE request_id = ?1",
                    params![req_id],
                )?;
                tx.commit()?;
                Ok(())
            })();

            match tx_result {
                Ok(()) => NativeResponse {
                    version: 1,
                    request_id: req_id.into(),
                    accepted: true,
                    download_id: Some(download_id),
                    error: None,
                },
                Err(e) => NativeResponse {
                    version: 1,
                    request_id: req_id.into(),
                    accepted: false,
                    download_id: None,
                    error: Some(e.to_string()),
                },
            }
        }
        "cancel" => {
            let _ = conn.execute(
                "UPDATE native_handoffs SET status = 'cancelled' WHERE request_id = ?1 AND status = 'pending'",
                params![req_id],
            );
            NativeResponse {
                version: 1,
                request_id: req_id.into(),
                accepted: true,
                download_id: None,
                error: None,
            }
        }
        unknown => NativeResponse {
            version: 1,
            request_id: req_id.into(),
            accepted: false,
            download_id: None,
            error: Some(format!("Action tidak dikenal: {unknown}")),
        },
    }
}

pub fn run() {
    let data_dir = match cli::data_dir() {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("Native host data_dir error: {e}");
            return;
        }
    };

    let db_path = data_dir.join("anchoa.db");
    let conn = match db::open_existing(&db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Native host database error: {e}");
            return;
        }
    };

    let stdin = io::stdin();
    let mut stdin_lock = stdin.lock();
    let stdout = io::stdout();
    let mut stdout_lock = stdout.lock();

    loop {
        match read_framed_message(&mut stdin_lock) {
            Ok(Some(msg)) => {
                let now = crate::time::now_ms();
                let resp = handle_message(&conn, &msg, now);
                if let Ok(resp_bytes) = serde_json::to_vec(&resp) {
                    if write_framed_message(&mut stdout_lock, &resp_bytes).is_err() {
                        break;
                    }
                }
            }
            Ok(None) => break, // EOF
            Err(e) => {
                eprintln!("Native host read error: {e}");
                break;
            }
        }
    }
}

// --- Manifest Installer ---

fn chrome_manifest_dirs(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".config/google-chrome/NativeMessagingHosts"),
        home.join(".config/chromium/NativeMessagingHosts"),
        home.join(".config/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
    ]
}

fn firefox_manifest_dir(home: &Path) -> PathBuf {
    home.join(".mozilla/native-messaging-hosts")
}

pub fn get_manifest_path(home: &Path, is_firefox: bool) -> PathBuf {
    if is_firefox {
        firefox_manifest_dir(home).join(format!("{HOST_NAME}.json"))
    } else {
        home.join(".config/google-chrome/NativeMessagingHosts")
            .join(format!("{HOST_NAME}.json"))
    }
}

pub fn generate_chrome_manifest(exe_path: &Path, extension_id: &str) -> String {
    serde_json::json!({
        "name": HOST_NAME,
        "description": "Anchoa Download Manager Host",
        "path": exe_path.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [
            format!("chrome-extension://{extension_id}/")
        ]
    })
    .to_string()
}

pub fn generate_firefox_manifest(exe_path: &Path) -> String {
    serde_json::json!({
        "name": HOST_NAME,
        "description": "Anchoa Download Manager Host",
        "path": exe_path.to_string_lossy(),
        "type": "stdio",
        "allowed_extensions": [
            FIREFOX_EXTENSION_ID
        ]
    })
    .to_string()
}

pub fn status(home: &Path, exe_path: &Path) -> NativeHostStatus {
    let ff_path = get_manifest_path(home, true);
    let firefox_installed = ff_path.exists();

    let chrome_dirs = chrome_manifest_dirs(home);
    let mut chrome_installed = false;
    let mut chrome_extension_id = None;

    for dir in chrome_dirs {
        let manifest_path = dir.join(format!("{HOST_NAME}.json"));
        if manifest_path.exists() {
            chrome_installed = true;
            if chrome_extension_id.is_none() {
                if let Ok(content) = fs::read_to_string(&manifest_path) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(origins) = json.get("allowed_origins").and_then(|v| v.as_array()) {
                            for origin in origins {
                                if let Some(origin_str) = origin.as_str() {
                                    if let Some(rest) = origin_str.strip_prefix("chrome-extension://") {
                                        let id = rest.trim_end_matches('/');
                                        if is_valid_chrome_extension_id(id) {
                                            chrome_extension_id = Some(id.to_string());
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    NativeHostStatus {
        installed: firefox_installed || chrome_installed,
        chrome_installed,
        firefox_installed,
        executable_path: exe_path.to_string_lossy().to_string(),
        chrome_extension_id,
    }
}

pub fn install(
    home: &Path,
    exe_path: &Path,
    chrome_id: Option<&str>,
) -> Result<NativeHostStatus, AppError> {
    // 1. Install Firefox manifest
    let ff_dir = firefox_manifest_dir(home);
    fs::create_dir_all(&ff_dir).map_err(|e| AppError::Other(e.to_string()))?;
    let ff_manifest = generate_firefox_manifest(exe_path);
    fs::write(ff_dir.join(format!("{HOST_NAME}.json")), ff_manifest)
        .map_err(|e| AppError::Other(e.to_string()))?;

    // 2. Install Chrome manifests if extension ID provided
    if let Some(id) = chrome_id {
        let trimmed = id.trim();
        if !trimmed.is_empty() {
            if !is_valid_chrome_extension_id(trimmed) {
                return Err(AppError::Invalid(
                    "ID ekstensi Chrome harus berupa 32 karakter huruf a-p".into(),
                ));
            }
            let chrome_manifest = generate_chrome_manifest(exe_path, trimmed);
            for dir in chrome_manifest_dirs(home) {
                fs::create_dir_all(&dir).map_err(|e| AppError::Other(e.to_string()))?;
                fs::write(dir.join(format!("{HOST_NAME}.json")), &chrome_manifest)
                    .map_err(|e| AppError::Other(e.to_string()))?;
            }
        }
    }

    Ok(status(home, exe_path))
}

pub fn uninstall(home: &Path, exe_path: &Path) -> Result<NativeHostStatus, AppError> {
    let ff_path = get_manifest_path(home, true);
    if ff_path.exists() {
        let _ = fs::remove_file(ff_path);
    }

    for dir in chrome_manifest_dirs(home) {
        let p = dir.join(format!("{HOST_NAME}.json"));
        if p.exists() {
            let _ = fs::remove_file(p);
        }
    }

    Ok(status(home, exe_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn chrome_extension_id_validation() {
        assert!(is_valid_chrome_extension_id("abcdefghijklmnopabcdefghijklmnop"));
        assert!(!is_valid_chrome_extension_id("abcdefghijklmnopabcdefghijklmnoq")); // 'q' is invalid
        assert!(!is_valid_chrome_extension_id("abcdef")); // too short
        assert!(!is_valid_chrome_extension_id("ABCDEFGHIKLMNOPABCDEFGHIKLMNOP")); // uppercase
    }

    #[test]
    fn framing_roundtrip_and_size_cap() {
        let mut buf = Vec::new();
        let msg = b"{\"action\":\"ping\"}";
        write_framed_message(&mut buf, msg).unwrap();

        let mut cursor = io::Cursor::new(buf);
        let read = read_framed_message(&mut cursor).unwrap().unwrap();
        assert_eq!(read, msg);

        // Reject over 64 KiB
        let mut big = Vec::new();
        let big_len = (MAX_MESSAGE_SIZE + 1) as u32;
        big.extend_from_slice(&big_len.to_ne_bytes());
        big.extend(vec![0u8; 100]);
        let mut cursor = io::Cursor::new(big);
        assert!(read_framed_message(&mut cursor).is_err());
    }

    #[test]
    fn handoff_prepare_commit_and_cancel_flow() {
        let conn = open_in_memory();

        // 1. Prepare
        let prep_req = serde_json::json!({
            "action": "prepare",
            "requestId": "req-1",
            "url": "https://example.com/archive.zip",
            "filename": "archive.zip"
        });
        let r1 = handle_message(&conn, &serde_json::to_vec(&prep_req).unwrap(), 1000);
        assert!(r1.accepted);
        assert!(r1.download_id.is_some());
        let dl_id = r1.download_id.unwrap();

        // 2. Commit
        let commit_req = serde_json::json!({
            "action": "commit",
            "requestId": "req-1"
        });
        let r2 = handle_message(&conn, &serde_json::to_vec(&commit_req).unwrap(), 1500);
        assert!(r2.accepted);
        assert_eq!(r2.download_id.as_deref(), Some(dl_id.as_str()));

        // Verify item in queue
        let dl = downloads::get(&conn, &dl_id).unwrap();
        assert_eq!(dl.url, "https://example.com/archive.zip");
        assert_eq!(dl.title, "archive.zip");
        assert_eq!(dl.status, downloads::DownloadStatus::Queued);

        // 3. Prepare + Cancel
        let prep2 = serde_json::json!({
            "action": "prepare",
            "requestId": "req-2",
            "url": "https://example.com/second.zip"
        });
        let r3 = handle_message(&conn, &serde_json::to_vec(&prep2).unwrap(), 2000);
        assert!(r3.accepted);

        let cancel_req = serde_json::json!({
            "action": "cancel",
            "requestId": "req-2"
        });
        let r4 = handle_message(&conn, &serde_json::to_vec(&cancel_req).unwrap(), 2100);
        assert!(r4.accepted);

        // Commit after cancel should fail
        let commit_after_cancel = serde_json::json!({
            "action": "commit",
            "requestId": "req-2"
        });
        let r5 = handle_message(&conn, &serde_json::to_vec(&commit_after_cancel).unwrap(), 2200);
        assert!(!r5.accepted);
    }

    #[test]
    fn handoff_rejects_expired_and_bad_urls() {
        let conn = open_in_memory();

        // Bad URL
        let bad_url = serde_json::json!({
            "action": "prepare",
            "requestId": "req-bad",
            "url": "file:///etc/passwd"
        });
        let r1 = handle_message(&conn, &serde_json::to_vec(&bad_url).unwrap(), 1000);
        assert!(!r1.accepted);

        // Expired commit (> 60s)
        let prep = serde_json::json!({
            "action": "prepare",
            "requestId": "req-exp",
            "url": "https://example.com/timeout.zip"
        });
        handle_message(&conn, &serde_json::to_vec(&prep).unwrap(), 1000);

        let commit_late = serde_json::json!({
            "action": "commit",
            "requestId": "req-exp"
        });
        let r2 = handle_message(&conn, &serde_json::to_vec(&commit_late).unwrap(), 70_000);
        assert!(!r2.accepted);
        assert_eq!(r2.error.as_deref(), Some("Handoff request telah kedaluwarsa"));
    }

    #[test]
    fn manifest_installer_and_status() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path();
        let exe = PathBuf::from("/usr/bin/anchoa");

        let initial = status(home, &exe);
        assert!(!initial.installed);

        let chrome_id = "abcdefghijklmnopabcdefghijklmnop";
        let installed = install(home, &exe, Some(chrome_id)).unwrap();
        assert!(installed.installed);
        assert!(installed.firefox_installed);
        assert!(installed.chrome_installed);
        assert_eq!(installed.chrome_extension_id.as_deref(), Some(chrome_id));

        let uninstalled = uninstall(home, &exe).unwrap();
        assert!(!uninstalled.installed);
        assert!(!uninstalled.firefox_installed);
        assert!(!uninstalled.chrome_installed);
    }

    #[test]
    fn handoff_idempotent_duplicate_requests() {
        let conn = open_in_memory();

        let prep = serde_json::json!({
            "action": "prepare",
            "requestId": "req-idem",
            "url": "https://example.com/idempotent.zip"
        });
        let r1 = handle_message(&conn, &serde_json::to_vec(&prep).unwrap(), 1000);
        assert!(r1.accepted);
        let dl_id = r1.download_id.unwrap();

        // Repeating prepare with same requestId returns same downloadId
        let r2 = handle_message(&conn, &serde_json::to_vec(&prep).unwrap(), 1100);
        assert!(r2.accepted);
        assert_eq!(r2.download_id.as_deref(), Some(dl_id.as_str()));

        // Commit first time
        let commit = serde_json::json!({
            "action": "commit",
            "requestId": "req-idem"
        });
        let r3 = handle_message(&conn, &serde_json::to_vec(&commit).unwrap(), 1200);
        assert!(r3.accepted);
        assert_eq!(r3.download_id.as_deref(), Some(dl_id.as_str()));

        // Commit second time is idempotent
        let r4 = handle_message(&conn, &serde_json::to_vec(&commit).unwrap(), 1300);
        assert!(r4.accepted);
        assert_eq!(r4.download_id.as_deref(), Some(dl_id.as_str()));
    }

    #[test]
    fn handoff_rejects_unsupported_schemes_and_malformed() {
        let conn = open_in_memory();

        // Non-http schemes rejected
        for invalid_url in &[
            "ftp://files.example.com/pkg.tar.gz",
            "javascript:alert(1)",
            "data:text/plain;base64,SGVsbG8=",
            "blob:http://example.com/guid",
        ] {
            let msg = serde_json::json!({
                "action": "prepare",
                "requestId": "req-scheme",
                "url": invalid_url
            });
            let r = handle_message(&conn, &serde_json::to_vec(&msg).unwrap(), 1000);
            assert!(!r.accepted, "Expected URL to be rejected: {invalid_url}");
        }

        // Unknown action rejected
        let unknown_action = serde_json::json!({
            "action": "unknown_action_xyz",
            "requestId": "req-unk"
        });
        let r_unk = handle_message(&conn, &serde_json::to_vec(&unknown_action).unwrap(), 1000);
        assert!(!r_unk.accepted);

        // Malformed json
        let r_mal = handle_message(&conn, b"invalid-non-json-bytes", 1000);
        assert!(!r_mal.accepted);
    }

    #[test]
    fn validate_url_checks_authority_and_host() {
        assert!(validate_url("").is_err());
        assert!(validate_url("   ").is_err());
        assert!(validate_url("http://").is_err());
        assert!(validate_url("http:///nofile").is_err());
        assert!(validate_url("https://").is_err());
        assert!(validate_url("https://example.com").is_ok());
        assert!(validate_url("http://localhost:8080/file.zip").is_ok());
    }

    #[test]
    fn handoff_rejects_when_pin_enabled() {
        let conn = open_in_memory();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)",
            params![crate::security::PIN_HASH_KEY, "$argon2id$v=19$m=65536,t=3,p=4$dummyhash"],
        )
        .unwrap();

        let prep = serde_json::json!({
            "action": "prepare",
            "requestId": "req-locked",
            "url": "https://example.com/test.zip"
        });
        let r = handle_message(&conn, &serde_json::to_vec(&prep).unwrap(), 1000);
        assert!(!r.accepted);
        assert_eq!(r.error.as_deref(), Some("Anchoa terkunci PIN"));
    }
}
