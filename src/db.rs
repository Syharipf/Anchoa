//! SQLite persistence: connection setup and numbered, forward-only migrations.
//!
//! The schema version is tracked in `PRAGMA user_version`: migration `i` in
//! [`MIGRATIONS`] brings the database from version `i` to `i + 1`.

use std::path::Path;

use rusqlite::Connection;

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
