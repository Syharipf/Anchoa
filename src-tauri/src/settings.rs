//! Local data statistics and explicit release checks for Pengaturan.
use std::ops::Deref;
use std::path::Path;
use std::time::Duration;

use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;

use crate::error::AppError;

#[derive(Debug, PartialEq, Serialize)]
pub struct TypeCount {
    pub kind: String,
    pub count: i64,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub name: String,
    pub bytes: u64,
    pub modified_at: i64,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataOverview {
    pub data_dir: String,
    pub db_bytes: u64,
    pub wal_bytes: u64,
    pub counts: Vec<TypeCount>,
    pub trashed: i64,
    pub backups: Vec<BackupFile>,
}

pub fn data_overview(
    conn: impl Deref<Target = Connection>,
    data_dir: &Path,
    backup_dir: &Path,
) -> Result<DataOverview, AppError> {
    let counts = {
        let mut stmt = conn.prepare(
            "SELECT type, COUNT(*) FROM items WHERE deleted_at IS NULL GROUP BY type ORDER BY 2 DESC, 1",
        )?;
        stmt.query_map([], |row| {
            Ok(TypeCount {
                kind: row.get(0)?,
                count: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?
    };
    let trashed = conn.query_row(
        "SELECT COUNT(*) FROM items WHERE deleted_at IS NOT NULL",
        [],
        |row| row.get(0),
    )?;
    // The command passes its owned MutexGuard, releasing the DB before filesystem I/O.
    drop(conn);

    Ok(DataOverview {
        data_dir: data_dir.display().to_string(),
        db_bytes: file_bytes(&data_dir.join("anchoa.db"))?,
        wal_bytes: file_bytes(&data_dir.join("anchoa.db-wal"))?,
        counts,
        trashed,
        backups: list_backups(backup_dir)?,
    })
}

fn file_bytes(path: &Path) -> Result<u64, AppError> {
    match std::fs::metadata(path) {
        Ok(metadata) => Ok(metadata.len()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(error.into()),
    }
}

fn list_backups(dir: &Path) -> Result<Vec<BackupFile>, AppError> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };
    let mut backups = Vec::new();
    for entry in entries {
        let entry = entry?;
        if entry
            .path()
            .extension()
            .is_none_or(|extension| extension != "db")
            || !entry.file_type()?.is_file()
        {
            continue;
        }
        let metadata = entry.metadata()?;
        backups.push(BackupFile {
            name: entry.file_name().to_string_lossy().into_owned(),
            bytes: metadata.len(),
            modified_at: jiff::Timestamp::try_from(metadata.modified()?)?.as_millisecond(),
        });
    }
    backups.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(backups)
}

#[derive(Debug, PartialEq, Serialize)]
pub struct UpdateCheck {
    pub current: String,
    pub latest: String,
    pub newer: bool,
    pub url: String,
}

fn version_tuple(version: &str) -> Option<(u64, u64, u64)> {
    let version = version.strip_prefix('v').unwrap_or(version);
    let mut parts = version.split('.');
    let mut next = || {
        let part = parts.next()?;
        if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        part.parse::<u64>().ok()
    };
    let tuple = (next()?, next()?, next()?);
    parts.next().is_none().then_some(tuple)
}

pub fn parse_release(current: &str, json: &Value) -> Result<UpdateCheck, AppError> {
    let tag = json
        .get("tag_name")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Other("Respons GitHub tanpa tag rilis".into()))?;
    let url = json
        .get("html_url")
        .and_then(Value::as_str)
        .filter(|url| !url.trim().is_empty())
        .ok_or_else(|| AppError::Other("Respons GitHub tanpa tautan rilis".into()))?;
    let current_version = version_tuple(current)
        .ok_or_else(|| AppError::Other(format!("Versi aplikasi tidak valid: {current}")))?;
    let latest_version = version_tuple(tag)
        .ok_or_else(|| AppError::Other(format!("Versi rilis GitHub tidak valid: {tag}")))?;
    Ok(UpdateCheck {
        current: current.to_string(),
        latest: tag.strip_prefix('v').unwrap_or(tag).to_string(),
        newer: latest_version > current_version,
        url: url.to_string(),
    })
}

pub fn check_update(current: &str) -> Result<UpdateCheck, AppError> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(10)))
        .build()
        .into();
    let body = agent
        .get("https://api.github.com/repos/Syharipf/Anchoa/releases/latest")
        .header("User-Agent", "anchoa")
        .call()
        .map_err(|error| AppError::Other(format!("Tidak bisa menghubungi GitHub: {error}")))?
        .body_mut()
        .read_to_string()
        .map_err(|error| AppError::Other(format!("Tidak bisa menghubungi GitHub: {error}")))?;
    let json = serde_json::from_str(&body)
        .map_err(|error| AppError::Other(format!("Respons GitHub tidak terbaca: {error}")))?;
    parse_release(current, &json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db, items};
    use serde_json::json;
    use std::fs::{self, File};
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn overview_counts_live_items_by_type_and_trash() {
        let dir = tempfile::tempdir().unwrap();
        let conn = db::open_in_memory();
        let backup_dir = dir.path().join("backups");
        let empty = data_overview(&conn, dir.path(), &backup_dir).unwrap();
        assert!(empty.counts.is_empty());
        assert_eq!(empty.trashed, 0);
        assert!(empty.backups.is_empty());
        assert!(!backup_dir.exists());

        for kind in ["task", "note", "project", "note", "task", "project", "note"] {
            items::insert(&conn, kind, "live", "", 1000).unwrap();
        }
        for kind in ["note", "file"] {
            let id = items::insert(&conn, kind, "trash", "", 1000).unwrap();
            items::soft_delete(&conn, &id, 2000).unwrap();
        }

        let overview = data_overview(&conn, dir.path(), &backup_dir).unwrap();
        assert_eq!(overview.data_dir, dir.path().display().to_string());
        assert_eq!(
            overview.counts,
            vec![
                TypeCount {
                    kind: "note".into(),
                    count: 3
                },
                TypeCount {
                    kind: "project".into(),
                    count: 2
                },
                TypeCount {
                    kind: "task".into(),
                    count: 2
                },
            ]
        );
        assert_eq!(overview.trashed, 2);
    }

    #[test]
    fn overview_lists_backups_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let conn = db::open_in_memory();
        let backup_dir = dir.path().join("backups");
        fs::create_dir(&backup_dir).unwrap();
        for (name, bytes, millis) in [("a.db", b"newest".as_slice(), 3000), ("z.db", b"old", 1000)]
        {
            let path = backup_dir.join(name);
            fs::write(&path, bytes).unwrap();
            File::options()
                .write(true)
                .open(path)
                .unwrap()
                .set_modified(UNIX_EPOCH + Duration::from_millis(millis))
                .unwrap();
        }
        fs::write(backup_dir.join("notes.txt"), b"ignored").unwrap();
        fs::write(backup_dir.join("a.db-wal"), b"ignored").unwrap();
        fs::create_dir(backup_dir.join("directory.db")).unwrap();

        let overview = data_overview(&conn, dir.path(), &backup_dir).unwrap();
        assert_eq!(
            overview.backups,
            vec![
                BackupFile {
                    name: "a.db".into(),
                    bytes: 6,
                    modified_at: 3000
                },
                BackupFile {
                    name: "z.db".into(),
                    bytes: 3,
                    modified_at: 1000
                },
            ]
        );
    }

    #[test]
    fn overview_reports_db_and_wal_size() {
        let dir = tempfile::tempdir().unwrap();
        let conn = db::open_in_memory();
        let backup_dir = dir.path().join("backups");
        fs::write(dir.path().join("anchoa.db"), [0; 128]).unwrap();

        let overview = data_overview(&conn, dir.path(), &backup_dir).unwrap();
        assert_eq!(overview.db_bytes, 128);
        assert_eq!(overview.wal_bytes, 0);

        fs::write(dir.path().join("anchoa.db-wal"), [0; 64]).unwrap();
        fs::write(dir.path().join("anchoa.db-shm"), [0; 32]).unwrap();
        let overview = data_overview(&conn, dir.path(), &backup_dir).unwrap();
        assert_eq!(overview.db_bytes, 128);
        assert_eq!(overview.wal_bytes, 64);
    }

    #[test]
    fn version_tuple_accepts_v_prefix_and_rejects_garbage() {
        for (version, expected) in [
            ("v0.10.0", (0, 10, 0)),
            ("0.10.0", (0, 10, 0)),
            ("1.2.3", (1, 2, 3)),
            ("0.0.0", (0, 0, 0)),
            ("18446744073709551615.0.0", (u64::MAX, 0, 0)),
        ] {
            assert_eq!(version_tuple(version), Some(expected), "{version}");
        }
        for version in [
            "",
            "v",
            "garbage",
            "0.10",
            "0.10.0.1",
            "0..0",
            "v.10.0",
            "vv0.10.0",
            "V0.10.0",
            "0.10.x",
            "-1.0.0",
            "+1.0.0",
            "1.+2.0",
            "1.2.+3",
            " 0.10.0",
            "0.10.0 ",
            "0.10.0-beta",
            "0.10.0+build",
            "18446744073709551616.0.0",
        ] {
            assert_eq!(version_tuple(version), None, "{version}");
        }
    }

    #[test]
    fn parse_release_detects_newer_same_and_older() {
        for (current, tag, latest, newer) in [
            ("0.9.0", "v0.10.0", "0.10.0", true),
            ("0.10.0", "v0.10.1", "0.10.1", true),
            ("0.10.9", "v0.11.0", "0.11.0", true),
            ("0.99.99", "v1.0.0", "1.0.0", true),
            ("0.10.0", "v0.10.0", "0.10.0", false),
            ("0.10.0", "v0.9.9", "0.9.9", false),
            ("0.10.0", "0.11.0", "0.11.0", true),
            ("v0.10.0", "0.10.0", "0.10.0", false),
        ] {
            let url = format!("https://github.com/Syharipf/Anchoa/releases/tag/{tag}");
            let release = json!({ "tag_name": tag, "html_url": url });
            assert_eq!(
                parse_release(current, &release).unwrap(),
                UpdateCheck {
                    current: current.into(),
                    latest: latest.into(),
                    newer,
                    url,
                }
            );
        }
    }

    #[test]
    fn parse_release_rejects_missing_tag() {
        let url = "https://github.com/Syharipf/Anchoa/releases/tag/v0.11.0";
        for release in [
            json!({ "html_url": url }),
            json!({ "tag_name": null, "html_url": url }),
            json!({ "tag_name": 11, "html_url": url }),
            json!({ "tag_name": "", "html_url": url }),
            json!({ "tag_name": "garbage", "html_url": url }),
            json!({ "tag_name": "v0.11.0" }),
            json!({ "tag_name": "v0.11.0", "html_url": null }),
            json!({ "tag_name": "v0.11.0", "html_url": 11 }),
            json!({ "tag_name": "v0.11.0", "html_url": "" }),
            json!({ "tag_name": "v0.11.0", "html_url": "   " }),
            json!(null),
            json!([]),
            json!("broken response"),
        ] {
            let error = parse_release("0.10.0", &release).unwrap_err();
            assert!(matches!(error, AppError::Other(_)));
            assert!(!error.to_string().is_empty());
        }
        let release = json!({ "tag_name": "v0.11.0", "html_url": url });
        assert!(parse_release("invalid current", &release).is_err());
    }
}
