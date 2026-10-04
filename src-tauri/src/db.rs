use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};

use crate::error::AppError;

pub const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/001_init.sql"),
    include_str!("../migrations/002_item_completion.sql"),
    include_str!("../migrations/003_contributions.sql"),
    include_str!("../migrations/004_finance.sql"),
    include_str!("../migrations/005_projects.sql"),
    include_str!("../migrations/006_habits.sql"),
    include_str!("../migrations/007_journal.sql"),
    include_str!("../migrations/008_downloads.sql"),
    include_str!("../migrations/009_notes.sql"),
    include_str!("../migrations/010_activities.sql"),
    include_str!("../migrations/011_emails.sql"),
    include_str!("../migrations/012_sync.sql"),
    include_str!("../migrations/013_journal_pinned.sql"),
    include_str!("../migrations/014_task_priority.sql"),
    include_str!("../migrations/015_downloads_upgrade.sql"),
];

/// Managed Tauri state. When the database fails to open, `conn` is `None`
/// and the frontend shows an error screen; no new database is created.
pub struct Db {
    conn: Option<Mutex<Connection>>,
    pub path: PathBuf,
    pub open_error: Option<String>,
    pub backup_error: Option<String>,
}

impl Db {
    pub fn open_at(path: PathBuf) -> Db {
        match open(&path) {
            Ok(conn) => Db { conn: Some(Mutex::new(conn)), path, open_error: None, backup_error: None },
            Err(e) => Db { conn: None, path, open_error: Some(e.to_string()), backup_error: None },
        }
    }

    pub fn conn(&self) -> Result<MutexGuard<'_, Connection>, AppError> {
        let conn = self.conn.as_ref().ok_or(AppError::DbUnavailable)?;
        conn.lock().map_err(|_| AppError::DbUnavailable)
    }

    #[cfg(test)]
    pub(crate) fn is_unlocked_for_test(&self) -> bool {
        self.conn.as_ref().is_some_and(|conn| conn.try_lock().is_ok())
    }
}

pub fn open(path: &Path) -> Result<Connection, AppError> {
    open_with_flags(path, OpenFlags::default())
}

/// Opens the app database for the CLI without ever creating a missing file.
pub fn open_existing(path: &Path) -> Result<Connection, AppError> {
    open_with_flags(path, OpenFlags::default() & !OpenFlags::SQLITE_OPEN_CREATE)
}

fn open_with_flags(path: &Path, flags: OpenFlags) -> Result<Connection, AppError> {
    let mut conn = Connection::open_with_flags(path, flags)?;
    configure(&conn)?;
    migrate(&mut conn, MIGRATIONS, Some(path))?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    configure(&conn).unwrap();
    migrate(&mut conn, MIGRATIONS, None).unwrap();
    conn
}

fn configure(conn: &Connection) -> Result<(), AppError> {
    conn.busy_timeout(Duration::from_millis(5000))?;
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))?;
    Ok(())
}

/// Consistent copy of the live database, safe while it is open.
pub fn vacuum_into(conn: &Connection, dest: &Path) -> Result<(), AppError> {
    conn.execute("VACUUM INTO ?1", [dest.to_string_lossy()])?;
    Ok(())
}

/// Applies `migrations[user_version..]`, one transaction each. An existing
/// database is copied to `<db>.bak-v<old version>` first.
pub fn migrate(conn: &mut Connection, migrations: &[&str], db_path: Option<&Path>) -> Result<(), AppError> {
    let current: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let latest = migrations.len() as i64;
    if current > latest {
        return Err(AppError::DbTooNew(current));
    }
    if current == latest {
        return Ok(());
    }
    if current > 0 && let Some(path) = db_path {
        let backup = PathBuf::from(format!("{}.bak-v{current}", path.display()));
        if !backup.exists() {
            vacuum_into(conn, &backup)?;
        }
    }
    for (i, sql) in migrations.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        if i == 11 {
            tx.execute("UPDATE sync_state SET value = ?1 WHERE key = 'device_id'", [uuid::Uuid::now_v7().to_string()])?;
        }
        tx.pragma_update(None, "user_version", i as i64 + 1)?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const M1: &str = "CREATE TABLE a (x INTEGER);";
    const M2: &str = "CREATE TABLE b (y INTEGER);";

    fn version(conn: &Connection) -> i64 {
        conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap()
    }

    #[test]
    fn open_existing_refuses_to_create_a_missing_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("anchoa.db");
        assert!(open_existing(&path).is_err());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn fresh_database_gets_all_migrations_and_pragmas() {
        let conn = open_in_memory();
        assert_eq!(version(&conn), MIGRATIONS.len() as i64);
        let fk: i64 = conn.pragma_query_value(None, "foreign_keys", |r| r.get(0)).unwrap();
        assert_eq!(fk, 1);
        conn.execute("SELECT id, type, title, body, parent_id, due_at, created_at, updated_at, opened_at, deleted_at, completed_at FROM items", [])
            .unwrap();
    }

    #[test]
    fn upgrade_backs_up_old_version_first() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("anchoa.db");
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn, &[M1], Some(&path)).unwrap();
        conn.execute("INSERT INTO a VALUES (42)", []).unwrap();

        migrate(&mut conn, &[M1, M2], Some(&path)).unwrap();

        assert_eq!(version(&conn), 2);
        let backup = Connection::open(dir.path().join("anchoa.db.bak-v1")).unwrap();
        assert_eq!(version(&backup), 1);
        let x: i64 = backup.query_row("SELECT x FROM a", [], |r| r.get(0)).unwrap();
        assert_eq!(x, 42);
    }

    #[test]
    fn version_3_database_upgrades_to_finance_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("anchoa.db");
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn, &MIGRATIONS[..3], Some(&path)).unwrap();
        conn.execute("INSERT INTO items (id, type, title, created_at, updated_at) VALUES ('n1', 'note', 'lama', 1, 1)", [])
            .unwrap();
        drop(conn);

        let conn = open(&path).unwrap();

        assert_eq!(version(&conn), MIGRATIONS.len() as i64);
        let title: String = conn.query_row("SELECT title FROM items WHERE id = 'n1'", [], |r| r.get(0)).unwrap();
        assert_eq!(title, "lama");
        for sql in [
            "SELECT item_id, kind, currency, opening_balance FROM accounts",
            "SELECT item_id, account_id, amount, category, occurred_at, transfer_id, bill_id FROM transactions",
            "SELECT item_id, account_id, amount, repeat, due_day FROM bills",
            "SELECT item_id, category, amount FROM budgets",
        ] {
            conn.prepare(sql).unwrap();
        }
        let backup = Connection::open(dir.path().join("anchoa.db.bak-v3")).unwrap();
        assert_eq!(version(&backup), 3);
    }

    #[test]
    fn version_4_database_upgrades_to_projects_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("anchoa.db");
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn, &MIGRATIONS[..4], Some(&path)).unwrap();
        conn.execute(
            "INSERT INTO items (id, type, title, due_at, completed_at, created_at, updated_at) VALUES
             ('n1', 'note', 'tanpa tenggat', NULL, NULL, 1, 1),
             ('n2', 'note', 'bertenggat terbuka', 1000, NULL, 1, 1),
             ('n3', 'note', 'bertenggat selesai', 1000, 1000, 1, 1)",
            [],
        )
        .unwrap();
        drop(conn);

        let conn = open(&path).unwrap();

        assert_eq!(version(&conn), MIGRATIONS.len() as i64);
        let backup = Connection::open(dir.path().join("anchoa.db.bak-v4")).unwrap();
        assert_eq!(version(&backup), 4);

        let (t1, k1): (String, String) = conn
            .query_row("SELECT title, type FROM items WHERE id = 'n1'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((t1.as_str(), k1.as_str()), ("tanpa tenggat", "note"));
        let count_task_n1: i64 = conn.query_row("SELECT COUNT(*) FROM tasks WHERE item_id = 'n1'", [], |r| r.get(0)).unwrap();
        assert_eq!(count_task_n1, 0);

        let (t2, k2, s2): (String, String, String) = conn
            .query_row(
                "SELECT i.title, i.type, t.status FROM items i JOIN tasks t ON t.item_id = i.id WHERE i.id = 'n2'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((t2.as_str(), k2.as_str(), s2.as_str()), ("bertenggat terbuka", "task", "plan"));

        let (t3, k3, s3): (String, String, String) = conn
            .query_row(
                "SELECT i.title, i.type, t.status FROM items i JOIN tasks t ON t.item_id = i.id WHERE i.id = 'n3'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((t3.as_str(), k3.as_str(), s3.as_str()), ("bertenggat selesai", "task", "done"));

        conn.prepare("SELECT item_id, kind, deadline_at, repo_url FROM projects").unwrap();
    }

    #[test]
    fn version_5_database_upgrades_to_habits_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("anchoa.db");
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn, &MIGRATIONS[..5], Some(&path)).unwrap();
        conn.execute("INSERT INTO items (id, type, title, created_at, updated_at) VALUES ('n1', 'note', 'lama', 1, 1)", [])
            .unwrap();
        drop(conn);

        let conn = open(&path).unwrap();

        assert_eq!(version(&conn), MIGRATIONS.len() as i64);
        let backup = Connection::open(dir.path().join("anchoa.db.bak-v5")).unwrap();
        assert_eq!(version(&backup), 5);

        for sql in [
            "SELECT item_id, days, remind_at, remind_on FROM habits",
            "SELECT habit_id, date, created_at, deleted_at FROM habit_checks",
        ] {
            conn.prepare(sql).unwrap();
        }
    }

    #[test]
    fn version_6_database_upgrades_to_journal_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("anchoa.db");
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn, &MIGRATIONS[..6], Some(&path)).unwrap();
        conn.execute(
            "INSERT INTO items (id, type, title, created_at, updated_at) VALUES ('n1', 'note', 'lama', 1, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO items (id, type, title, created_at, updated_at) VALUES ('h1', 'habit', 'Baca', 1, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO habits (item_id, days, remind_at, remind_on) VALUES ('h1', 127, NULL, 0)",
            [],
        )
        .unwrap();
        drop(conn);

        let conn = open(&path).unwrap();

        assert_eq!(version(&conn), MIGRATIONS.len() as i64);
        let backup = Connection::open(dir.path().join("anchoa.db.bak-v6")).unwrap();
        assert_eq!(version(&backup), 6);

        let auto_journal: i64 = conn
            .query_row("SELECT auto_journal FROM habits WHERE item_id = 'h1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(auto_journal, 0);

        for sql in [
            "SELECT item_id, kind, mood, tags, task_id FROM journal_entries",
            "SELECT auto_journal FROM habits",
        ] {
            conn.prepare(sql).unwrap();
        }
    }

    #[test]
    fn version_7_database_upgrades_to_downloads_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("anchoa.db");
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn, &MIGRATIONS[..7], Some(&path)).unwrap();
        conn.execute(
            "INSERT INTO items (id, type, title, created_at, updated_at) VALUES ('n1', 'note', 'lama', 1, 1)",
            [],
        )
        .unwrap();
        drop(conn);

        let conn = open(&path).unwrap();

        assert_eq!(version(&conn), MIGRATIONS.len() as i64);
        let backup = Connection::open(dir.path().join("anchoa.db.bak-v7")).unwrap();
        assert_eq!(version(&backup), 7);

        for sql in [
            "SELECT item_id, url, kind, options, status, total_bytes, done_bytes, file_path, error, finished_at FROM downloads",
            "SELECT key, value FROM settings",
        ] {
            conn.prepare(sql).unwrap();
        }
    }

    #[test]
    fn version_8_database_upgrades_to_notes_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("anchoa.db");
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn, &MIGRATIONS[..8], Some(&path)).unwrap();
        conn.execute(
            "INSERT INTO items (id, type, title, body, created_at, updated_at) VALUES ('n1', 'note', 'lama', 'isi lama dicari', 1, 1)",
            [],
        )
        .unwrap();
        drop(conn);

        let conn = open(&path).unwrap();

        assert_eq!(version(&conn), MIGRATIONS.len() as i64);
        let backup = Connection::open(dir.path().join("anchoa.db.bak-v8")).unwrap();
        assert_eq!(version(&backup), 8);

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'lama'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);

        for sql in [
            "SELECT from_id, to_id FROM links",
            "SELECT item_id, title, body FROM items_fts",
        ] {
            conn.prepare(sql).unwrap();
        }
    }

    #[test]
    fn version_9_database_upgrades_to_agent_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("anchoa.db");
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn, &MIGRATIONS[..9], Some(&path)).unwrap();
        conn.execute(
            "INSERT INTO items (id, type, title, created_at, updated_at) VALUES
             ('p1', 'project', 'Proyek lama', 1, 1), ('t1', 'task', 'Tugas lama', 1, 1)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO projects (item_id, kind) VALUES ('p1', 'app')", []).unwrap();
        conn.execute("INSERT INTO tasks (item_id, status, project_id) VALUES ('t1', 'doing', 'p1')", []).unwrap();
        drop(conn);

        let conn = open(&path).unwrap();

        assert_eq!(version(&conn), MIGRATIONS.len() as i64);
        let backup = Connection::open(dir.path().join("anchoa.db.bak-v9")).unwrap();
        assert_eq!(version(&backup), 9);
        let project: (String, bool, Option<String>, Option<String>) = conn
            .query_row(
                "SELECT i.title, p.agent, p.agent_command, p.agent_dir
                 FROM projects p JOIN items i ON i.id = p.item_id WHERE i.id = 'p1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(project, ("Proyek lama".into(), false, None, None));
        let status: String = conn.query_row("SELECT status FROM tasks WHERE item_id = 't1'", [], |r| r.get(0)).unwrap();
        assert_eq!(status, "doing");
        conn.prepare("SELECT item_id, task_id, project_id, actor, role, kind FROM activities").unwrap();
        for index in ["activities_task", "activities_project"] {
            let exists: bool = conn
                .query_row("SELECT EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?1)", [index], |r| r.get(0))
                .unwrap();
            assert!(exists, "{index}");
        }
    }

    #[test]
    fn version_10_database_upgrades_to_email_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("anchoa.db");
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn, &MIGRATIONS[..10], Some(&path)).unwrap();
        conn.execute("INSERT INTO items (id, type, title, created_at, updated_at) VALUES ('n1', 'note', 'lama', 1, 1)", []).unwrap();
        drop(conn);

        let conn = open(&path).unwrap();
        assert_eq!(version(&conn), MIGRATIONS.len() as i64);
        assert_eq!(conn.query_row("SELECT title FROM items WHERE id = 'n1'", [], |r| r.get::<_, String>(0)).unwrap(), "lama");
        conn.prepare("SELECT item_id, folder, uid, message_id, from_name, from_addr, to_addrs, sent_at, unread, starred, has_html, body_cached, refs FROM emails").unwrap();
        let backup = Connection::open(dir.path().join("anchoa.db.bak-v10")).unwrap();
        assert_eq!(version(&backup), 10);
        for index in ["emails_folder_sent", "emails_folder_uid"] {
            assert!(conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?1)", [index], |r| r.get::<_, bool>(0)).unwrap());
        }
        conn.execute("INSERT INTO items (id, type, created_at, updated_at) VALUES ('e1', 'email', 1, 1)", []).unwrap();
        conn.execute("INSERT INTO emails (item_id, folder, uid) VALUES ('e1', 'INBOX', 1)", []).unwrap();
        conn.execute("INSERT INTO items (id, type, created_at, updated_at) VALUES ('e2', 'email', 1, 1)", []).unwrap();
        assert!(conn.execute("INSERT INTO emails (item_id, folder, uid) VALUES ('e2', 'INBOX', 1)", []).is_err());
        assert!(conn.execute("INSERT INTO emails (item_id, folder, uid) VALUES ('missing', 'INBOX', 2)", []).is_err());
    }

    #[test]
    fn version_11_database_upgrades_to_sync_schema_without_losing_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("anchoa.db");
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn, &MIGRATIONS[..11], Some(&path)).unwrap();
        conn.execute_batch(
            "INSERT INTO items (id, type, title, body, created_at, updated_at, opened_at) VALUES
             ('h1', 'habit', 'Baca', '', 10, 20, 30),
             ('p1', 'project', 'Lama', 'isi dicari', 10, 20, 30);
             INSERT INTO habits (item_id, days, auto_journal) VALUES ('h1', 127, 1);
             INSERT INTO projects (item_id, kind, agent, agent_command, agent_dir)
             VALUES ('p1', 'app', 1, 'codex', '/local/repo');
             INSERT INTO habit_checks (habit_id, date, created_at, deleted_at) VALUES
             ('h1', '2026-10-01', 100, NULL), ('h1', '2026-10-02', 200, 300);",
        ).unwrap();
        drop(conn);

        let conn = open(&path).unwrap();
        assert_eq!(version(&conn), MIGRATIONS.len() as i64);
        let backup = Connection::open(dir.path().join("anchoa.db.bak-v11")).unwrap();
        assert_eq!(version(&backup), 11);
        assert_eq!(conn.query_row("SELECT title, opened_at FROM items WHERE id = 'h1'", [], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))).unwrap(), ("Baca".into(), 30));
        assert_eq!(conn.query_row("SELECT agent, agent_command, agent_dir FROM projects WHERE item_id = 'p1'", [], |r| Ok((r.get::<_, bool>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))).unwrap(), (true, "codex".into(), "/local/repo".into()));
        let checks: Vec<(i64, i64, Option<i64>)> = conn.prepare("SELECT created_at, updated_at, deleted_at FROM habit_checks ORDER BY date").unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(checks, vec![(100, 100, None), (200, 300, Some(300))]);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'dicari'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        for sql in [
            "SELECT key, value FROM sync_state",
            "SELECT record_id, changed_at FROM sync_outbox",
            "SELECT record_id, version, payload FROM sync_pending",
            "SELECT record_id, version FROM sync_versions",
        ] {
            conn.prepare(sql).unwrap();
        }
        let device_id: String = conn.query_row("SELECT value FROM sync_state WHERE key = 'device_id'", [], |r| r.get(0)).unwrap();
        assert_eq!(uuid::Uuid::parse_str(&device_id).unwrap().get_version_num(), 7);
        assert_eq!(conn.query_row("SELECT value FROM sync_state WHERE key = 'applying'", [], |r| r.get::<_, String>(0)).unwrap(), "0");
        assert_eq!(conn.query_row("SELECT value FROM sync_state WHERE key = 'quota_bytes'", [], |r| r.get::<_, String>(0)).unwrap(), "419430400");
        drop(conn);
        let conn = open(&path).unwrap();
        assert_eq!(conn.query_row("SELECT value FROM sync_state WHERE key = 'device_id'", [], |r| r.get::<_, String>(0)).unwrap(), device_id);
    }

    #[test]
    fn version_12_database_upgrades_to_pinned_journal_without_losing_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        configure(&conn).unwrap();
        migrate(&mut conn, &MIGRATIONS[..12], None).unwrap();
        conn.execute_batch(
            "INSERT INTO items (id, type, title, created_at, updated_at) VALUES ('n1', 'note', 'lama', 1, 2);
             INSERT INTO journal_entries (item_id, kind, mood, tags) VALUES ('n1', 'idea', 4, 'kerja');",
        ).unwrap();
        migrate(&mut conn, MIGRATIONS, None).unwrap();
        assert_eq!(version(&conn), MIGRATIONS.len() as i64);
        let entry = crate::journal::journal_entry(&conn, "n1", crate::finance::testing::now(), &crate::finance::testing::jakarta()).unwrap();
        assert_eq!(entry.title, "lama");
        assert_eq!(entry.kind, crate::journal::EntryKind::Idea);
        assert_eq!(entry.mood, Some(4));
        assert_eq!(entry.tags, ["kerja"]);
        assert!(!entry.pinned);
        assert!(conn.execute("UPDATE journal_entries SET pinned = NULL WHERE item_id = 'n1'", []).is_err());
    }

    #[test]
    fn fts_follows_title_and_body_updates() {
        let conn = open_in_memory();

        // 1. Insert item
        conn.execute(
            "INSERT INTO items (id, type, title, body, created_at, updated_at) VALUES ('i1', 'note', 'Halo Dunia', 'Isi pertama', 1, 1)",
            [],
        )
        .unwrap();

        let count_dunia: i64 = conn
            .query_row("SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'Dunia'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_dunia, 1);

        let count_pertama: i64 = conn
            .query_row("SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'pertama'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_pertama, 1);

        // 2. Update title
        conn.execute("UPDATE items SET title = 'Selamat Pagi' WHERE id = 'i1'", []).unwrap();

        let count_old_title: i64 = conn
            .query_row("SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'Dunia'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_old_title, 0);

        let count_new_title: i64 = conn
            .query_row("SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'Pagi'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_new_title, 1);

        // Body remains indexed after title update
        let count_body_after_title_update: i64 = conn
            .query_row("SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'pertama'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_body_after_title_update, 1);

        // 3. Update body
        conn.execute("UPDATE items SET body = 'Isi kedua yang baru' WHERE id = 'i1'", []).unwrap();

        let count_old_body: i64 = conn
            .query_row("SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'pertama'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_old_body, 0);

        let count_new_body: i64 = conn
            .query_row("SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'kedua'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_new_body, 1);

        // 4. Physical delete removes from FTS index
        conn.execute("DELETE FROM items WHERE id = 'i1'", []).unwrap();

        let count_deleted_title: i64 = conn
            .query_row("SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'Pagi'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_deleted_title, 0);

        let count_deleted_body: i64 = conn
            .query_row("SELECT COUNT(*) FROM items_fts WHERE items_fts MATCH 'kedua'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_deleted_body, 0);

        let count_item_id: i64 = conn
            .query_row("SELECT COUNT(*) FROM items_fts WHERE item_id = 'i1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_item_id, 0);
    }

    #[test]
    fn failed_migration_rolls_back() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn, &[M1], None).unwrap();
        let err = migrate(&mut conn, &[M1, "CREATE TABLE broken (;"], None);
        assert!(err.is_err());
        assert_eq!(version(&conn), 1);
    }

    #[test]
    fn refuses_database_from_newer_app() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn, &[M1, M2], None).unwrap();
        assert!(matches!(migrate(&mut conn, &[M1], None), Err(AppError::DbTooNew(2))));
    }

    #[test]
    fn corrupt_file_is_reported_and_left_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("anchoa.db");
        let garbage = vec![7u8; 4096];
        std::fs::write(&path, &garbage).unwrap();

        let db = Db::open_at(path.clone());

        assert!(db.open_error.is_some());
        assert!(matches!(db.conn(), Err(AppError::DbUnavailable)));
        assert_eq!(std::fs::read(&path).unwrap(), garbage);
    }
}
