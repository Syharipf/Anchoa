//! SQLite persistence: connection setup and numbered, forward-only migrations.
//!
//! The schema version is tracked in `PRAGMA user_version`: migration `i` in
//! [`MIGRATIONS`] brings the database from version `i` to `i + 1`.

use std::ffi::OsString;
use std::os::unix::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, params};

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("failed to create database directory: {0}")]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
}

/// Append-only. Never edit a migration that has shipped; add a new one.
const MIGRATIONS: &[&str] = &[
    // v1: initial schema (PRD §8). `download_job` is a v2 placeholder.
    "
    CREATE TABLE operation (
        id         INTEGER PRIMARY KEY,
        kind       TEXT    NOT NULL CHECK (kind IN ('move', 'copy', 'trash', 'rename', 'mkdir', 'chmod')),
        source     TEXT    NOT NULL CHECK (source IN ('manual', 'rule', 'llm')),
        status     TEXT    NOT NULL CHECK (status IN ('running', 'done', 'partial', 'failed', 'undone')),
        created_at INTEGER NOT NULL
    );
    CREATE INDEX operation_created_at ON operation (created_at);

    CREATE TABLE operation_item (
        id           INTEGER PRIMARY KEY,
        operation_id INTEGER NOT NULL REFERENCES operation (id) ON DELETE CASCADE,
        seq          INTEGER NOT NULL,
        src_path     TEXT    NOT NULL,
        dst_path     TEXT,
        mode_before  INTEGER,
        mode_after   INTEGER,
        size         INTEGER,
        mtime_after  INTEGER,
        trashed_at   INTEGER,
        status       TEXT    NOT NULL CHECK (status IN ('pending', 'done', 'failed', 'skipped')),
        error        TEXT,
        UNIQUE (operation_id, seq)
    );

    CREATE TABLE command_history (
        id           INTEGER PRIMARY KEY,
        input        TEXT    NOT NULL,
        resolved_by  TEXT    NOT NULL CHECK (resolved_by IN ('rule', 'llm', 'none')),
        confidence   REAL,
        operation_id INTEGER REFERENCES operation (id) ON DELETE SET NULL,
        created_at   INTEGER NOT NULL
    );

    CREATE TABLE bookmark (
        id       INTEGER PRIMARY KEY,
        path     TEXT    NOT NULL UNIQUE,
        label    TEXT    NOT NULL,
        position INTEGER NOT NULL
    );

    CREATE TABLE download_job (
        id         INTEGER PRIMARY KEY,
        url        TEXT    NOT NULL,
        dest_path  TEXT    NOT NULL,
        status     TEXT    NOT NULL,
        created_at INTEGER NOT NULL
    );
    ",
];

/// Opens (creating if needed) the database at `path` and applies pending migrations.
pub fn open(path: &Path) -> Result<Connection, DbError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", true)?;
    migrate(&mut conn)?;
    Ok(conn)
}

/// Applies every migration newer than the database's `user_version`, each in its own transaction.
pub fn migrate(conn: &mut Connection) -> Result<(), DbError> {
    let current: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    for (version, sql) in (1..).zip(MIGRATIONS).skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bookmark {
    pub id: i64,
    pub path: PathBuf,
    pub label: String,
}

// Paths are stored as raw bytes (`OsStr::as_bytes`) so non-UTF-8 names round-trip exactly.

/// All bookmarks in display order (`position` ascending).
pub fn bookmarks(conn: &Connection) -> Result<Vec<Bookmark>, DbError> {
    let mut stmt = conn.prepare("SELECT id, path, label FROM bookmark ORDER BY position")?;
    let rows = stmt.query_map([], |row| {
        Ok(Bookmark {
            id: row.get(0)?,
            path: OsString::from_vec(row.get(1)?).into(),
            label: row.get(2)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Appends a bookmark at the end. Returns `false` (and changes nothing) if `path` is already bookmarked.
pub fn add_bookmark(conn: &Connection, path: &Path, label: &str) -> Result<bool, DbError> {
    let inserted = conn.execute(
        "INSERT INTO bookmark (path, label, position)
         VALUES (?1, ?2, (SELECT COALESCE(MAX(position), -1) + 1 FROM bookmark))
         ON CONFLICT (path) DO NOTHING",
        params![path.as_os_str().as_bytes(), label],
    )?;
    Ok(inserted == 1)
}

/// Removes a bookmark and renumbers the rest so positions stay `0..n`. Unknown `id` is a no-op.
pub fn remove_bookmark(conn: &mut Connection, id: i64) -> Result<(), DbError> {
    let tx = conn.transaction()?;
    if let Some(position) = position_of(&tx, id)? {
        tx.execute("DELETE FROM bookmark WHERE id = ?1", [id])?;
        tx.execute(
            "UPDATE bookmark SET position = position - 1 WHERE position > ?1",
            [position],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Moves a bookmark one place: `up = true` moves it one place earlier.
/// No-op at either end or for an unknown `id`.
pub fn move_bookmark(conn: &mut Connection, id: i64, up: bool) -> Result<(), DbError> {
    let Some(position) = position_of(conn, id)? else {
        return Ok(());
    };
    move_bookmark_to(conn, id, if up { position - 1 } else { position + 1 })
}

/// Moves a bookmark to `position` (clamped to the list), shifting the ones in between.
/// No-op for an unknown `id`.
pub fn move_bookmark_to(conn: &mut Connection, id: i64, position: i64) -> Result<(), DbError> {
    let tx = conn.transaction()?;
    if let Some(from) = position_of(&tx, id)? {
        let last: i64 = tx.query_row("SELECT MAX(position) FROM bookmark", [], |row| row.get(0))?;
        let to = position.clamp(0, last);
        // Positions are contiguous, so shifting the range between `from` and `to` by one
        // leaves exactly the gap at `to`.
        if to < from {
            tx.execute(
                "UPDATE bookmark SET position = position + 1 WHERE position >= ?1 AND position < ?2",
                [to, from],
            )?;
        } else {
            tx.execute(
                "UPDATE bookmark SET position = position - 1 WHERE position > ?1 AND position <= ?2",
                [from, to],
            )?;
        }
        tx.execute("UPDATE bookmark SET position = ?1 WHERE id = ?2", [to, id])?;
    }
    tx.commit()?;
    Ok(())
}

fn position_of(conn: &Connection, id: i64) -> Result<Option<i64>, DbError> {
    Ok(conn
        .query_row("SELECT position FROM bookmark WHERE id = ?1", [id], |row| {
            row.get(0)
        })
        .optional()?)
}

/// Operations older than this many days are pruned.
pub const RETENTION_DAYS: i64 = 30;
/// Only this many most recent operations are kept.
pub const RETENTION_MAX: u32 = 1_000;

/// Deletes operations past either retention limit (their items cascade) and returns how
/// many were deleted. `now` is seconds since the Unix epoch. Meant to run at startup.
pub fn prune(conn: &Connection, now: i64) -> Result<usize, DbError> {
    Ok(conn.execute(
        "DELETE FROM operation
         WHERE created_at < ?1
            OR id NOT IN (SELECT id FROM operation ORDER BY created_at DESC, id DESC LIMIT ?2)",
        (now - RETENTION_DAYS * 86_400, RETENTION_MAX),
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        conn
    }

    fn labels(conn: &Connection) -> Vec<String> {
        bookmarks(conn)
            .unwrap()
            .into_iter()
            .map(|b| b.label)
            .collect()
    }

    fn positions(conn: &Connection) -> Vec<i64> {
        let mut stmt = conn
            .prepare("SELECT position FROM bookmark ORDER BY position")
            .unwrap();
        stmt.query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    fn id_of(conn: &Connection, label: &str) -> i64 {
        bookmarks(conn)
            .unwrap()
            .into_iter()
            .find(|b| b.label == label)
            .unwrap()
            .id
    }

    #[test]
    fn add_bookmark_appends_and_rejects_duplicates() {
        let conn = db();
        assert!(add_bookmark(&conn, Path::new("/a"), "a").unwrap());
        assert!(add_bookmark(&conn, Path::new("/b"), "b").unwrap());
        assert!(!add_bookmark(&conn, Path::new("/a"), "again").unwrap());
        assert_eq!(labels(&conn), ["a", "b"]);
        assert_eq!(positions(&conn), [0, 1]);
        assert_eq!(bookmarks(&conn).unwrap()[1].path, Path::new("/b"));
    }

    #[test]
    fn bookmark_path_round_trips_non_utf8() {
        use std::os::unix::ffi::OsStrExt;
        let conn = db();
        let path = Path::new(std::ffi::OsStr::from_bytes(b"/tmp/caf\xe9"));
        add_bookmark(&conn, path, "cafe").unwrap();
        assert_eq!(bookmarks(&conn).unwrap()[0].path, path);
        assert!(!add_bookmark(&conn, path, "dup").unwrap());
    }

    #[test]
    fn remove_bookmark_closes_position_gaps() {
        let mut conn = db();
        for name in ["a", "b", "c"] {
            add_bookmark(&conn, &Path::new("/").join(name), name).unwrap();
        }
        let b = id_of(&conn, "b");
        remove_bookmark(&mut conn, b).unwrap();
        remove_bookmark(&mut conn, 9999).unwrap();
        assert_eq!(labels(&conn), ["a", "c"]);
        assert_eq!(positions(&conn), [0, 1]);
        add_bookmark(&conn, Path::new("/d"), "d").unwrap();
        assert_eq!(labels(&conn), ["a", "c", "d"]);
    }

    #[test]
    fn move_bookmark_swaps_neighbours_and_stops_at_edges() {
        let mut conn = db();
        for name in ["a", "b", "c"] {
            add_bookmark(&conn, &Path::new("/").join(name), name).unwrap();
        }
        let (a, c) = (id_of(&conn, "a"), id_of(&conn, "c"));
        move_bookmark(&mut conn, c, true).unwrap();
        assert_eq!(labels(&conn), ["a", "c", "b"]);
        move_bookmark(&mut conn, a, true).unwrap();
        move_bookmark(&mut conn, 9999, false).unwrap();
        assert_eq!(labels(&conn), ["a", "c", "b"]);
        move_bookmark(&mut conn, a, false).unwrap();
        assert_eq!(labels(&conn), ["c", "a", "b"]);
        let b = id_of(&conn, "b");
        move_bookmark(&mut conn, b, false).unwrap();
        assert_eq!(labels(&conn), ["c", "a", "b"]);
        assert_eq!(positions(&conn), [0, 1, 2]);
    }

    #[test]
    fn move_bookmark_to_inserts_at_position_and_clamps() {
        let mut conn = db();
        for name in ["a", "b", "c", "d"] {
            add_bookmark(&conn, &Path::new("/").join(name), name).unwrap();
        }
        let (a, d) = (id_of(&conn, "a"), id_of(&conn, "d"));
        move_bookmark_to(&mut conn, a, 2).unwrap();
        assert_eq!(labels(&conn), ["b", "c", "a", "d"]);
        move_bookmark_to(&mut conn, d, 0).unwrap();
        assert_eq!(labels(&conn), ["d", "b", "c", "a"]);
        move_bookmark_to(&mut conn, d, 99).unwrap();
        assert_eq!(labels(&conn), ["b", "c", "a", "d"]);
        move_bookmark_to(&mut conn, a, -5).unwrap();
        move_bookmark_to(&mut conn, 9999, 0).unwrap();
        assert_eq!(labels(&conn), ["a", "b", "c", "d"]);
        assert_eq!(positions(&conn), [0, 1, 2, 3]);
    }

    fn user_version(conn: &Connection) -> u32 {
        conn.pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn migrate_creates_schema_and_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        migrate(&mut conn).unwrap();
        assert_eq!(user_version(&conn) as usize, MIGRATIONS.len());

        for table in [
            "operation",
            "operation_item",
            "command_history",
            "bookmark",
            "download_job",
        ] {
            let exists: bool = conn
                .query_row(
                    "SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert!(exists, "missing table {table}");
        }
    }

    #[test]
    fn schema_rejects_operation_outside_whitelist() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        let result = conn.execute(
            "INSERT INTO operation (kind, source, status, created_at) VALUES ('exec', 'llm', 'done', 0)",
            [],
        );
        assert!(result.is_err());
    }

    #[test]
    fn open_creates_parent_dir_and_cascades_items() {
        let dir = std::env::temp_dir().join(format!("loom-db-test-{}", std::process::id()));
        let conn = open(&dir.join("nested/history.db")).unwrap();
        conn.execute_batch(
            "INSERT INTO operation (id, kind, source, status, created_at) VALUES (1, 'move', 'rule', 'done', 0);
             INSERT INTO operation_item (operation_id, seq, src_path, status) VALUES (1, 0, '/a', 'done');
             DELETE FROM operation WHERE id = 1;",
        )
        .unwrap();
        let items: i64 = conn
            .query_row("SELECT COUNT(*) FROM operation_item", [], |row| row.get(0))
            .unwrap();
        assert_eq!(items, 0);
        drop(conn);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn prune_drops_old_operations_and_keeps_the_latest_thousand() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        migrate(&mut conn).unwrap();
        let now = 1_800_000_000;
        let insert = |id: i64, created_at: i64| {
            conn.execute(
                "INSERT INTO operation (id, kind, source, status, created_at) VALUES (?1, 'move', 'rule', 'done', ?2)",
                (id, created_at),
            )
            .unwrap();
        };
        // Operation 1 is past the age limit; 2..=1002 are recent, 2 being the oldest of them.
        insert(1, now - RETENTION_DAYS * 86_400 - 1);
        for id in 2..=1002 {
            insert(id, now - (1002 - id));
        }
        conn.execute(
            "INSERT INTO operation_item (operation_id, seq, src_path, status) VALUES (1, 0, '/a', 'done')",
            [],
        )
        .unwrap();

        assert_eq!(prune(&conn, now).unwrap(), 2);
        let (count, min_id): (i64, i64) = conn
            .query_row("SELECT COUNT(*), MIN(id) FROM operation", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!((count, min_id), (1000, 3));
        let items: i64 = conn
            .query_row("SELECT COUNT(*) FROM operation_item", [], |row| row.get(0))
            .unwrap();
        assert_eq!(items, 0);
        assert_eq!(prune(&conn, now).unwrap(), 0);

        // Exactly at the age limit is kept.
        conn.execute("DELETE FROM operation", []).unwrap();
        insert(1, now - RETENTION_DAYS * 86_400);
        assert_eq!(prune(&conn, now).unwrap(), 0);
    }
}
