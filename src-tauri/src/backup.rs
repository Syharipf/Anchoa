use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::db::vacuum_into;
use crate::error::AppError;

/// Daily and manual backups share one rotation.
pub const KEEP: usize = 7;

/// Creates `anchoa-<today>.db` unless it already exists. Returns the new file.
pub fn daily(conn: &Connection, dir: &Path, today: &str) -> Result<Option<PathBuf>, AppError> {
    let dest = dir.join(format!("anchoa-{today}.db"));
    if dest.exists() {
        return Ok(None);
    }
    write(conn, dir, &dest)?;
    Ok(Some(dest))
}

/// Creates `anchoa-<stamp>.db` now.
pub fn manual(conn: &Connection, dir: &Path, stamp: &str) -> Result<PathBuf, AppError> {
    let dest = dir.join(format!("anchoa-{stamp}.db"));
    write(conn, dir, &dest)?;
    Ok(dest)
}

fn write(conn: &Connection, dir: &Path, dest: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(dir)?;
    vacuum_into(conn, dest)?;
    rotate(dir)
}

/// Keeps the newest `KEEP` backups. Names start with the date, so name order is age order.
pub fn rotate(dir: &Path) -> Result<(), AppError> {
    let mut backups: Vec<PathBuf> = std::fs::read_dir(dir)?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("anchoa-") && name.ends_with(".db"))
        })
        .collect();
    backups.sort();
    let excess = backups.len().saturating_sub(KEEP);
    for old in &backups[..excess] {
        std::fs::remove_file(old)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::items::{capture_note, list_inbox};

    #[test]
    fn daily_backup_is_made_once_per_day_and_readable() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_in_memory();
        capture_note(&conn, "penting", 1000).unwrap();

        let first = daily(&conn, dir.path(), "2026-09-29").unwrap();
        let second = daily(&conn, dir.path(), "2026-09-29").unwrap();

        let path = first.expect("first call creates a backup");
        assert!(second.is_none());
        let copy = Connection::open(path).unwrap();
        assert_eq!(list_inbox(&copy).unwrap()[0].title, "penting");
    }

    #[test]
    fn rotation_keeps_newest_seven() {
        let dir = tempfile::tempdir().unwrap();
        for day in 1..=9 {
            std::fs::write(dir.path().join(format!("anchoa-2026-09-0{day}.db")), b"").unwrap();
        }
        std::fs::write(dir.path().join("notes.txt"), b"").unwrap();

        rotate(dir.path()).unwrap();

        let mut left: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(left.len(), KEEP + 1);
        assert_eq!(left[0], "anchoa-2026-09-03.db");
        assert!(left.contains(&"notes.txt".to_string()));
    }

    #[test]
    fn manual_backup_joins_the_rotation() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_in_memory();
        for day in 1..=7 {
            std::fs::write(dir.path().join(format!("anchoa-2026-09-0{day}.db")), b"").unwrap();
        }

        let path = manual(&conn, dir.path(), "2026-09-29-101500").unwrap();

        assert!(path.exists());
        assert!(!dir.path().join("anchoa-2026-09-01.db").exists());
    }
}
