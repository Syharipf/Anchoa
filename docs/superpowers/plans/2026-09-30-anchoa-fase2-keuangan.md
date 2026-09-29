# Anchoa Fase 2 (Keuangan): Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: DRAF.** Rencana ini mengikuti draf spec yang asumsinya (A1–A10) belum disetujui. Kalau jawaban untuk Q1–Q8 di spec mengubah asumsi, perbarui spec dan rencana ini dulu sebelum mulai.

**Goal:** Menambah modul keuangan: akun, transaksi (pengeluaran, pemasukan, transfer), ringkasan bulanan, dan widget dashboard yang aktif.

**Architecture:** Mengikuti Fase 1. Akun dan transaksi adalah baris di `items` (`type` = `account` atau `transaction`), dengan tabel tambahan `accounts` dan `transactions` yang memakai `item_id` yang sama. Logika ada di `finance.rs` berupa fungsi murni yang menerima `&Connection`, sedangkan `commands.rs` hanya berisi glue. Frontend memanggil backend hanya lewat `src/api.ts`.

**Tech Stack:** Sama seperti Fase 1 (Tauri 2.12, Rust 2024, rusqlite, jiff, React 19, TypeScript 7, Tailwind 4, bun). Tidak ada dependency baru.

**Spec:** `docs/superpowers/specs/2026-09-30-anchoa-fase2-keuangan-design.md`

## Global Constraints

- Uang disimpan sebagai integer rupiah, tidak pernah float. Nilai negatif berarti uang keluar dari akun.
- Semua query keuangan melakukan join ke `items` dan memfilter `deleted_at IS NULL`.
- Batas hari dan bulan dihitung di Rust dengan zona waktu lokal (`jiff::tz::TimeZone::system()`). Test memakai offset tetap +7.
- Kedua baris transfer ditulis, diubah, dan dihapus bersamaan dalam satu transaksi SQLite (`unchecked_transaction`).
- Validasi mengembalikan `AppError::Invalid` (`code: "invalid"`) dengan pesan dalam Bahasa Indonesia.
- Konvensi SonarCloud dari `CLAUDE.md` berlaku: props `Readonly<...>`, tanpa `Math.random()`, `[[ ]]` di bash.
- Merge hanya setelah CI `check` dan SonarCloud hijau (0 temuan), E2E `PASS`, dan review sendiri tanpa temuan.

## Status verifikasi

Keempat tahap PR sudah dibuat berurutan di worktree terpisah (`scratch/fase2-verify`, tidak di-push). Setiap tahap lolos pemeriksaan berikut:

| Tahap | clippy `-D warnings` | `cargo test` | `bun test` | E2E |
|---|---|---|---|---|
| F2-1 | exit 0 | 30 lulus | 6 lulus | PASS (5 skenario) |
| F2-2 | exit 0 | 43 lulus | 6 lulus | PASS (5 skenario) |
| F2-3 | exit 0 | 43 lulus | 10 lulus | PASS (6 skenario) |
| F2-4 | exit 0 | 43 lulus | 10 lulus | PASS (6 skenario) |

Blok kode di bawah diambil langsung dari commit setiap tahap.

## Pembagian PR

| PR | Branch | Isi |
|---|---|---|
| F2-1 | `feat/f2-1-accounts` | Migrasi 002, `AppError::Invalid` dan `AccountInUse`, helper `items::insert` dan `soft_delete`, Inbox dan Item terbaru hanya `note`, backend akun |
| F2-2 | `feat/f2-2-transactions` | Helper bulan, backend transaksi, transfer, ringkasan, kategori, `finance` di dashboard |
| F2-3 | `feat/f2-3-finance-ui` | Format rupiah, panel, halaman Keuangan (tab Transaksi dan Akun), formulir, E2E keuangan |
| F2-4 | `feat/f2-4-summary-widget` | Tab Ringkasan, widget dashboard aktif, E2E ringkasan dan dashboard |

## Task 0: Milestone dan issue

- [ ] **Step 1: Buat milestone "Fase 2" dan 4 issue**

```bash
gh api repos/Syharipf/Anchoa/milestones -f title="Fase 2" -f description="Keuangan. Spec: docs/superpowers/specs/2026-09-30-anchoa-fase2-keuangan-design.md"
P=docs/superpowers/plans/2026-09-30-anchoa-fase2-keuangan.md
gh issue create --milestone "Fase 2" --title "Backend akun dan migrasi keuangan" --body "Rencana: $P, PR F2-1."
gh issue create --milestone "Fase 2" --title "Backend transaksi, transfer, dan ringkasan" --body "Rencana: $P, PR F2-2."
gh issue create --milestone "Fase 2" --title "Halaman Keuangan: akun dan transaksi" --body "Rencana: $P, PR F2-3."
gh issue create --milestone "Fase 2" --title "Ringkasan bulanan dan widget dashboard" --body "Rencana: $P, PR F2-4."
gh issue list --milestone "Fase 2"
```

Catat nomor issue dari output. Nomor itu dipakai di `Closes #N` pada masing-masing PR.

---
## PR F2-1: Migrasi dan backend akun (`feat/f2-1-accounts`)

### Task 1.1: Migrasi 002, varian error, dan test upgrade

**Files:**
- Create: `src-tauri/migrations/002_finance.sql`
- Modify: `src-tauri/src/error.rs`, `src-tauri/src/db.rs`

**Interfaces:**
- Produces: `AppError::Invalid(String)` (`code: "invalid"`), `AppError::AccountInUse` (`code: "account_in_use"`), dan `MIGRATIONS` berisi 2 migrasi.

- [ ] **Step 1: Buat branch**

```bash
git switch main && git pull && git switch -c feat/f2-1-accounts
```

- [ ] **Step 2: Tulis `src-tauri/migrations/002_finance.sql`**

```sql
CREATE TABLE accounts (
  item_id         TEXT PRIMARY KEY REFERENCES items(id),
  kind            TEXT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'IDR',
  opening_balance INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE transactions (
  item_id     TEXT PRIMARY KEY REFERENCES items(id),
  account_id  TEXT NOT NULL REFERENCES items(id),
  amount      INTEGER NOT NULL,
  category    TEXT,
  occurred_at INTEGER NOT NULL,
  transfer_id TEXT
);

CREATE INDEX transactions_account  ON transactions(account_id);
CREATE INDEX transactions_occurred ON transactions(occurred_at);
CREATE INDEX transactions_transfer ON transactions(transfer_id) WHERE transfer_id IS NOT NULL;
```

- [ ] **Step 3: Tulis ulang `src-tauri/src/error.rs`**

```rust
use serde::ser::{Serialize, SerializeStruct, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Teks tidak boleh kosong")]
    Empty,
    #[error("Item tidak ditemukan")]
    NotFound,
    #[error("{0}")]
    Invalid(String),
    #[error("Akun masih punya transaksi")]
    AccountInUse,
    #[error("Database tidak tersedia")]
    DbUnavailable,
    #[error("Database versi {0} dibuat oleh aplikasi yang lebih baru")]
    DbTooNew(i64),
    #[error("Kesalahan database: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Kesalahan file: {0}")]
    Io(#[from] std::io::Error),
    #[error("Kesalahan waktu: {0}")]
    Time(#[from] jiff::Error),
    #[error("Kesalahan aplikasi: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Empty => "empty",
            AppError::NotFound => "not_found",
            AppError::Invalid(_) => "invalid",
            AppError::AccountInUse => "account_in_use",
            AppError::DbUnavailable => "db_unavailable",
            AppError::DbTooNew(_) => "db_too_new",
            AppError::Db(_) => "db",
            AppError::Io(_) => "io",
            AppError::Time(_) => "time",
            AppError::Tauri(_) | AppError::Other(_) => "other",
        }
    }
}

/// Sent to the frontend as `{ code, message }`.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}
```

- [ ] **Step 4: Tulis ulang `src-tauri/src/db.rs`**

Isinya: `MIGRATIONS` ditambah `002_finance.sql`, dan test baru `fase1_database_upgrades_to_finance_schema`.

```rust
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use rusqlite::Connection;

use crate::error::AppError;

pub const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/001_init.sql"),
    include_str!("../migrations/002_finance.sql"),
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
}

pub fn open(path: &Path) -> Result<Connection, AppError> {
    let mut conn = Connection::open(path)?;
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
    fn fresh_database_gets_all_migrations_and_pragmas() {
        let conn = open_in_memory();
        assert_eq!(version(&conn), MIGRATIONS.len() as i64);
        let fk: i64 = conn.pragma_query_value(None, "foreign_keys", |r| r.get(0)).unwrap();
        assert_eq!(fk, 1);
        conn.execute("SELECT id, type, title, body, parent_id, due_at, created_at, updated_at, opened_at, deleted_at FROM items", [])
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
    fn fase1_database_upgrades_to_finance_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("anchoa.db");
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn, &MIGRATIONS[..1], Some(&path)).unwrap();
        conn.execute("INSERT INTO items (id, type, title, created_at, updated_at) VALUES ('n1', 'note', 'lama', 1, 1)", [])
            .unwrap();
        drop(conn);

        let conn = open(&path).unwrap();

        assert_eq!(version(&conn), 2);
        let title: String = conn.query_row("SELECT title FROM items WHERE id = 'n1'", [], |r| r.get(0)).unwrap();
        assert_eq!(title, "lama");
        conn.prepare("SELECT item_id, account_id, amount, category, occurred_at, transfer_id FROM transactions").unwrap();
        conn.prepare("SELECT item_id, kind, currency, opening_balance FROM accounts").unwrap();
        assert!(dir.path().join("anchoa.db.bak-v1").exists());
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
```

- [ ] **Step 5: Jalankan test DB**

Run: `cd src-tauri && cargo test db:: ; cd ..`
Expected: `6 passed`. Test upgrade membuktikan bahwa DB Fase 1 yang berisi data naik ke versi 2, datanya utuh, dan `anchoa.db.bak-v1` terbentuk.

- [ ] **Step 6: Commit**

```bash
git add src-tauri
git commit -m "feat: add finance schema migration and validation errors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.2: Helper item, serta Inbox dan Item terbaru yang hanya berisi `note`

**Files:**
- Modify: `src-tauri/src/items.rs`, `src-tauri/src/dashboard.rs`

**Interfaces:**
- Produces:
  - `items::insert(&Connection, kind, title, body, now) -> Result<String, AppError>`
  - `items::soft_delete(&Connection, id, now) -> Result<bool, AppError>`
  - `list_inbox` dan `recent` sekarang hanya mengembalikan item bertipe `note` (A9).

- [ ] **Step 1: Tulis ulang `src-tauri/src/items.rs`**

Isinya: `insert` dan `soft_delete` baru, `capture_note` dan `delete` memakai keduanya, filter `type = 'note'`, dan test `inbox_lists_notes_only`.

```rust
use rusqlite::{Connection, OptionalExtension, Params, Row, params};
use serde::{Deserialize, Deserializer, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub title: String,
    pub body: String,
    pub parent_id: Option<String>,
    pub due_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub opened_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSummary {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub title: String,
    pub due_at: Option<i64>,
    pub last_activity_at: i64,
}

/// Fields sent by the item page. A missing field is left unchanged;
/// `dueAt: null` clears the due date.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPatch {
    pub title: Option<String>,
    pub body: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub due_at: Option<Option<i64>>,
}

fn present<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<i64>>, D::Error> {
    Option::<i64>::deserialize(d).map(Some)
}

const ITEM_COLUMNS: &str = "id, type, title, body, parent_id, due_at, created_at, updated_at, opened_at";

fn item_from_row(r: &Row) -> rusqlite::Result<Item> {
    Ok(Item {
        id: r.get(0)?,
        kind: r.get(1)?,
        title: r.get(2)?,
        body: r.get(3)?,
        parent_id: r.get(4)?,
        due_at: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
        opened_at: r.get(8)?,
    })
}

/// Live (not deleted) items matching `clause`, which is SQL placed after
/// `WHERE deleted_at IS NULL AND`; it may end with ORDER BY / LIMIT.
pub fn summaries(conn: &Connection, clause: &str, params: impl Params) -> Result<Vec<ItemSummary>, AppError> {
    let sql = format!(
        "SELECT id, type, title, due_at, MAX(created_at, updated_at, COALESCE(opened_at, 0)) AS last_activity_at
         FROM items WHERE deleted_at IS NULL AND {clause}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params, |r| {
        Ok(ItemSummary { id: r.get(0)?, kind: r.get(1)?, title: r.get(2)?, due_at: r.get(3)?, last_activity_at: r.get(4)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> Result<Item, AppError> {
    conn.query_row(
        &format!("SELECT {ITEM_COLUMNS} FROM items WHERE id = ?1 AND deleted_at IS NULL"),
        [id],
        item_from_row,
    )
    .optional()?
    .ok_or(AppError::NotFound)
}

/// Inserts a bare `items` row and returns its new UUIDv7 id. Modules add
/// their own extension row with the same id.
pub fn insert(conn: &Connection, kind: &str, title: &str, body: &str, now: i64) -> Result<String, AppError> {
    let id = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO items (id, type, title, body, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, kind, title, body, now],
    )?;
    Ok(id)
}

/// Soft-deletes a live item. Returns false when it was missing or already deleted.
pub fn soft_delete(conn: &Connection, id: &str, now: i64) -> Result<bool, AppError> {
    let changed = conn.execute(
        "UPDATE items SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    Ok(changed > 0)
}

pub fn capture_note(conn: &Connection, text: &str, now: i64) -> Result<Item, AppError> {
    let title = text.trim();
    if title.is_empty() {
        return Err(AppError::Empty);
    }
    let id = insert(conn, "note", title, "", now)?;
    get(conn, &id)
}

/// Marks the item as opened. Does not touch `updated_at`.
pub fn open(conn: &Connection, id: &str, now: i64) -> Result<Item, AppError> {
    let changed = conn.execute(
        "UPDATE items SET opened_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    get(conn, id)
}

pub fn update(conn: &Connection, id: &str, patch: &ItemPatch, now: i64) -> Result<Item, AppError> {
    if patch.title.is_none() && patch.body.is_none() && patch.due_at.is_none() {
        return get(conn, id);
    }
    let changed = conn.execute(
        "UPDATE items SET
           title = COALESCE(?2, title),
           body = COALESCE(?3, body),
           due_at = CASE WHEN ?4 THEN ?5 ELSE due_at END,
           updated_at = ?6
         WHERE id = ?1 AND deleted_at IS NULL",
        params![id, patch.title, patch.body, patch.due_at.is_some(), patch.due_at.flatten(), now],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    if !soft_delete(conn, id, now)? {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// Unfiled notes. Accounts and transactions have their own pages.
pub fn list_inbox(conn: &Connection) -> Result<Vec<ItemSummary>, AppError> {
    summaries(conn, "type = 'note' AND parent_id IS NULL ORDER BY created_at DESC, id DESC", [])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn capture_trims_text_into_an_inbox_note() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "  beli kopi  ", 1000).unwrap();
        assert_eq!(item.kind, "note");
        assert_eq!(item.title, "beli kopi");
        assert_eq!(item.parent_id, None);
        assert_eq!((item.created_at, item.updated_at), (1000, 1000));
        assert_eq!(uuid::Uuid::parse_str(&item.id).unwrap().get_version_num(), 7);
    }

    #[test]
    fn capture_rejects_blank_text() {
        let conn = open_in_memory();
        assert!(matches!(capture_note(&conn, "   ", 1000), Err(AppError::Empty)));
        assert!(list_inbox(&conn).unwrap().is_empty());
    }

    #[test]
    fn open_sets_opened_at_only() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "a", 1000).unwrap();
        let opened = open(&conn, &item.id, 5000).unwrap();
        assert_eq!(opened.opened_at, Some(5000));
        assert_eq!(opened.updated_at, 1000);
    }

    #[test]
    fn update_changes_only_sent_fields() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "a", 1000).unwrap();
        let patch = ItemPatch { body: Some("isi".into()), due_at: Some(Some(9000)), ..Default::default() };
        let updated = update(&conn, &item.id, &patch, 2000).unwrap();
        assert_eq!(updated.title, "a");
        assert_eq!(updated.body, "isi");
        assert_eq!(updated.due_at, Some(9000));
        assert_eq!(updated.updated_at, 2000);
    }

    #[test]
    fn update_with_null_due_clears_it() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "a", 1000).unwrap();
        update(&conn, &item.id, &ItemPatch { due_at: Some(Some(9000)), ..Default::default() }, 2000).unwrap();
        let cleared = update(&conn, &item.id, &ItemPatch { due_at: Some(None), ..Default::default() }, 3000).unwrap();
        assert_eq!(cleared.due_at, None);
    }

    #[test]
    fn empty_patch_does_not_touch_updated_at() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "a", 1000).unwrap();
        let same = update(&conn, &item.id, &ItemPatch::default(), 2000).unwrap();
        assert_eq!(same.updated_at, 1000);
    }

    #[test]
    fn patch_json_distinguishes_missing_from_null() {
        let missing: ItemPatch = serde_json_from(r#"{"title":"x"}"#);
        assert_eq!(missing.due_at, None);
        let null: ItemPatch = serde_json_from(r#"{"dueAt":null}"#);
        assert_eq!(null.due_at, Some(None));
        let set: ItemPatch = serde_json_from(r#"{"dueAt":5}"#);
        assert_eq!(set.due_at, Some(Some(5)));
    }

    fn serde_json_from(json: &str) -> ItemPatch {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn deleted_items_disappear() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "a", 1000).unwrap();
        delete(&conn, &item.id, 2000).unwrap();
        assert!(matches!(get(&conn, &item.id), Err(AppError::NotFound)));
        assert!(matches!(open(&conn, &item.id, 3000), Err(AppError::NotFound)));
        assert!(matches!(delete(&conn, &item.id, 3000), Err(AppError::NotFound)));
        assert!(list_inbox(&conn).unwrap().is_empty());
    }

    #[test]
    fn inbox_lists_newest_first() {
        let conn = open_in_memory();
        capture_note(&conn, "lama", 1000).unwrap();
        capture_note(&conn, "baru", 2000).unwrap();
        let titles: Vec<String> = list_inbox(&conn).unwrap().into_iter().map(|s| s.title).collect();
        assert_eq!(titles, ["baru", "lama"]);
    }

    #[test]
    fn inbox_lists_notes_only() {
        let conn = open_in_memory();
        capture_note(&conn, "catatan", 1000).unwrap();
        insert(&conn, "account", "BCA", "", 2000).unwrap();
        let titles: Vec<String> = list_inbox(&conn).unwrap().into_iter().map(|s| s.title).collect();
        assert_eq!(titles, ["catatan"]);
    }

    #[test]
    fn unknown_id_is_not_found() {
        let conn = open_in_memory();
        assert!(matches!(update(&conn, "nope", &ItemPatch { title: Some("x".into()), ..Default::default() }, 1), Err(AppError::NotFound)));
    }
}
```

- [ ] **Step 2: Filter `recent` di `src-tauri/src/dashboard.rs`**

Ganti klausa query `recent`:

```rust
            "1 ORDER BY last_activity_at DESC, id DESC LIMIT ?1",
```

menjadi:

```rust
            "type = 'note' ORDER BY last_activity_at DESC, id DESC LIMIT ?1",
```

- [ ] **Step 3: Jalankan test**

Run: `cd src-tauri && cargo test ; cd ..`
Expected: `26 passed`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri
git commit -m "feat: keep inbox and recent items to notes, add item insert helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.3: Backend akun (TDD)

**Files:**
- Create: `src-tauri/src/finance.rs`
- Modify: `src-tauri/src/lib.rs` (tambah `mod finance;`)

**Interfaces:**
- Produces:
  - `AccountView { id, name, kind, currency, openingBalance, balance }`
  - `AccountInput { name, kind, openingBalance }`
  - `AccountPatch { name?, kind?, openingBalance? }`
  - `list_accounts`, `get_account`, `create_account`, `update_account`, `delete_account`
  - `ACCOUNT_KINDS`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src-tauri/src/finance.rs` yang berisi modul test saja, lalu tambahkan `mod finance;` setelah `mod error;` di `lib.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    fn account(conn: &Connection, name: &str, opening: i64) -> String {
        let input = AccountInput { name: name.into(), kind: "bank".into(), opening_balance: opening };
        create_account(conn, &input, 1).unwrap().id
    }

    #[test]
    fn new_account_starts_at_its_opening_balance() {
        let conn = open_in_memory();
        let bca = account(&conn, "  BCA ", 1_000_000);
        let view = get_account(&conn, &bca).unwrap();
        assert_eq!((view.name.as_str(), view.currency.as_str(), view.balance), ("BCA", "IDR", 1_000_000));
    }

    #[test]
    fn account_input_is_validated() {
        let conn = open_in_memory();
        let blank = AccountInput { name: "  ".into(), kind: "bank".into(), opening_balance: 0 };
        assert!(matches!(create_account(&conn, &blank, 1), Err(AppError::Invalid(_))));
        let odd = AccountInput { name: "X".into(), kind: "crypto".into(), opening_balance: 0 };
        assert!(matches!(create_account(&conn, &odd, 1), Err(AppError::Invalid(_))));
    }

    #[test]
    fn accounts_are_listed_by_name_and_can_be_updated() {
        let conn = open_in_memory();
        let gopay = account(&conn, "gopay", 0);
        account(&conn, "BCA", 0);
        let patch = AccountPatch { name: Some("GoPay".into()), kind: Some("ewallet".into()), opening_balance: Some(50_000) };
        let updated = update_account(&conn, &gopay, &patch, 2).unwrap();
        assert_eq!((updated.name.as_str(), updated.kind.as_str(), updated.balance), ("GoPay", "ewallet", 50_000));
        let names: Vec<String> = list_accounts(&conn).unwrap().into_iter().map(|a| a.name).collect();
        assert_eq!(names, ["BCA", "GoPay"]);
    }

    #[test]
    fn unused_account_can_be_deleted_once() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        delete_account(&conn, &bca, 2).unwrap();
        assert!(list_accounts(&conn).unwrap().is_empty());
        assert!(matches!(delete_account(&conn, &bca, 3), Err(AppError::NotFound)));
    }
}
```

Run: `cd src-tauri && cargo test finance:: ; cd ..`
Expected: FAIL saat compile, dengan `cannot find struct 'AccountInput'` dan `cannot find function 'create_account'`.

- [ ] **Step 2: Implementasi**

Tambahkan kode berikut di atas modul test:

```rust
//! Accounts, transactions, transfers and monthly totals. Amounts are integer
//! rupiah; a negative amount is money leaving the account.
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::items;

pub const ACCOUNT_KINDS: [&str; 4] = ["cash", "bank", "ewallet", "credit"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub currency: String,
    pub opening_balance: i64,
    pub balance: i64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub name: String,
    pub kind: String,
    pub opening_balance: i64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountPatch {
    pub name: Option<String>,
    pub kind: Option<String>,
    pub opening_balance: Option<i64>,
}

fn invalid(message: &str) -> AppError {
    AppError::Invalid(message.to_string())
}

// ---------- accounts ----------

const ACCOUNT_SELECT: &str = "
    SELECT i.id, i.title, a.kind, a.currency, a.opening_balance,
           a.opening_balance + COALESCE((
               SELECT SUM(t.amount) FROM transactions t JOIN items ti ON ti.id = t.item_id
               WHERE t.account_id = i.id AND ti.deleted_at IS NULL), 0)
    FROM accounts a JOIN items i ON i.id = a.item_id
    WHERE i.deleted_at IS NULL";

fn account_from_row(r: &Row) -> rusqlite::Result<AccountView> {
    Ok(AccountView {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        currency: r.get(3)?,
        opening_balance: r.get(4)?,
        balance: r.get(5)?,
    })
}

fn account_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(invalid("Nama akun tidak boleh kosong"));
    }
    Ok(name.to_string())
}

fn account_kind(kind: &str) -> Result<(), AppError> {
    if ACCOUNT_KINDS.contains(&kind) { Ok(()) } else { Err(invalid("Jenis akun tidak dikenal")) }
}

pub fn list_accounts(conn: &Connection) -> Result<Vec<AccountView>, AppError> {
    let mut stmt = conn.prepare(&format!("{ACCOUNT_SELECT} ORDER BY i.title COLLATE NOCASE, i.id"))?;
    let rows = stmt.query_map([], account_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get_account(conn: &Connection, id: &str) -> Result<AccountView, AppError> {
    conn.query_row(&format!("{ACCOUNT_SELECT} AND i.id = ?1"), [id], account_from_row)
        .optional()?
        .ok_or(AppError::NotFound)
}

pub fn create_account(conn: &Connection, input: &AccountInput, now: i64) -> Result<AccountView, AppError> {
    let name = account_name(&input.name)?;
    account_kind(&input.kind)?;
    let tx = conn.unchecked_transaction()?;
    let id = items::insert(&tx, "account", &name, "", now)?;
    tx.execute(
        "INSERT INTO accounts (item_id, kind, opening_balance) VALUES (?1, ?2, ?3)",
        params![id, input.kind, input.opening_balance],
    )?;
    tx.commit()?;
    get_account(conn, &id)
}

pub fn update_account(conn: &Connection, id: &str, patch: &AccountPatch, now: i64) -> Result<AccountView, AppError> {
    get_account(conn, id)?;
    let name = patch.name.as_deref().map(account_name).transpose()?;
    if let Some(kind) = &patch.kind {
        account_kind(kind)?;
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE items SET title = COALESCE(?2, title), updated_at = ?3 WHERE id = ?1",
        params![id, name, now],
    )?;
    tx.execute(
        "UPDATE accounts SET kind = COALESCE(?2, kind), opening_balance = COALESCE(?3, opening_balance) WHERE item_id = ?1",
        params![id, patch.kind, patch.opening_balance],
    )?;
    tx.commit()?;
    get_account(conn, id)
}

pub fn delete_account(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    get_account(conn, id)?;
    let in_use: i64 = conn.query_row(
        "SELECT COUNT(*) FROM transactions t JOIN items i ON i.id = t.item_id
         WHERE t.account_id = ?1 AND i.deleted_at IS NULL",
        [id],
        |r| r.get(0),
    )?;
    if in_use > 0 {
        return Err(AppError::AccountInUse);
    }
    items::soft_delete(conn, id, now)?;
    Ok(())
}
```

Run: `cd src-tauri && cargo test finance:: ; cd ..`
Expected: `4 passed`.

- [ ] **Step 3: Commit**

```bash
git add src-tauri
git commit -m "feat: add accounts with balances (create, update, delete when unused)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.4: Command akun dan E2E

**Files:**
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `scripts/e2e-smoke.sh`

**Interfaces:**
- Produces:
  - `list_accounts()`
  - `create_account(input)`
  - `update_account(id, patch)`
  - `delete_account(id)`

- [ ] **Step 1: Tulis ulang `src-tauri/src/commands.rs`**

```rust
//! Thin Tauri glue: every function here only resolves state and delegates.
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::dashboard::{self, Dashboard};
use crate::db::Db;
use crate::error::AppError;
use crate::finance::{self, AccountInput, AccountPatch, AccountView};
use crate::items::{self, Item, ItemPatch, ItemSummary};
use crate::{backup, time};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStatus {
    pub path: String,
    pub error: Option<String>,
    pub backup_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataPaths {
    pub data_dir: String,
    pub backup_dir: String,
    pub log_dir: String,
}

pub fn backup_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app.path().app_data_dir()?.join("backups"))
}

#[tauri::command]
pub fn db_status(db: State<'_, Db>) -> DbStatus {
    DbStatus { path: db.path.display().to_string(), error: db.open_error.clone(), backup_error: db.backup_error.clone() }
}

#[tauri::command]
pub fn capture_note(db: State<'_, Db>, text: String) -> Result<Item, AppError> {
    items::capture_note(&*db.conn()?, &text, time::now_ms())
}

#[tauri::command]
pub fn open_item(db: State<'_, Db>, id: String) -> Result<Item, AppError> {
    items::open(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn update_item(db: State<'_, Db>, id: String, patch: ItemPatch) -> Result<Item, AppError> {
    items::update(&*db.conn()?, &id, &patch, time::now_ms())
}

#[tauri::command]
pub fn delete_item(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    items::delete(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn list_inbox(db: State<'_, Db>) -> Result<Vec<ItemSummary>, AppError> {
    items::list_inbox(&*db.conn()?)
}

#[tauri::command]
pub fn get_dashboard(db: State<'_, Db>) -> Result<Dashboard, AppError> {
    dashboard::get(&*db.conn()?, time::now_ms(), &jiff::tz::TimeZone::system())
}

#[tauri::command]
pub fn list_accounts(db: State<'_, Db>) -> Result<Vec<AccountView>, AppError> {
    finance::list_accounts(&*db.conn()?)
}

#[tauri::command]
pub fn create_account(db: State<'_, Db>, input: AccountInput) -> Result<AccountView, AppError> {
    finance::create_account(&*db.conn()?, &input, time::now_ms())
}

#[tauri::command]
pub fn update_account(db: State<'_, Db>, id: String, patch: AccountPatch) -> Result<AccountView, AppError> {
    finance::update_account(&*db.conn()?, &id, &patch, time::now_ms())
}

#[tauri::command]
pub fn delete_account(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    finance::delete_account(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn backup_now(app: AppHandle, db: State<'_, Db>) -> Result<String, AppError> {
    let path = backup::manual(&*db.conn()?, &backup_dir(&app)?, &time::now_stamp())?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn data_paths(app: AppHandle) -> Result<DataPaths, AppError> {
    Ok(DataPaths {
        data_dir: app.path().app_data_dir()?.display().to_string(),
        backup_dir: backup_dir(&app)?.display().to_string(),
        log_dir: app.path().app_log_dir()?.display().to_string(),
    })
}

/// Opens one of the app's own folders in the file manager. The frontend
/// never passes a path, so it cannot open anything else.
#[tauri::command]
pub fn open_folder(app: AppHandle, kind: String) -> Result<(), AppError> {
    let dir = match kind.as_str() {
        "data" => app.path().app_data_dir()?,
        "backup" => backup_dir(&app)?,
        "log" => app.path().app_log_dir()?,
        other => return Err(AppError::Other(format!("folder tidak dikenal: {other}"))),
    };
    std::fs::create_dir_all(&dir)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))
}
```

- [ ] **Step 2: Tulis ulang `src-tauri/src/lib.rs`**

```rust
mod backup;
mod commands;
mod dashboard;
mod db;
mod error;
mod finance;
mod gpu;
mod items;
mod time;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Must stay first: it may call set_var, which is only sound before other threads start.
    let gpu_node = gpu::apply_linux_workaround();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            if let Some(node) = &gpu_node {
                log::info!("NVIDIA workaround: WEBKIT_WEB_RENDER_DEVICE_FILE={node}");
            }
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let mut db = db::Db::open_at(data_dir.join("anchoa.db"));
            match &db.open_error {
                Some(e) => log::error!("database open failed: {e}"),
                None => {
                    let result = backup::daily(&*db.conn()?, &data_dir.join("backups"), &time::today_stamp());
                    match result {
                        Ok(Some(path)) => log::info!("daily backup: {}", path.display()),
                        Ok(None) => {}
                        Err(e) => {
                            log::error!("daily backup failed: {e}");
                            db.backup_error = Some(e.to_string());
                        }
                    }
                }
            }
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_status,
            commands::capture_note,
            commands::open_item,
            commands::update_item,
            commands::delete_item,
            commands::list_inbox,
            commands::get_dashboard,
            commands::list_accounts,
            commands::create_account,
            commands::update_account,
            commands::delete_account,
            commands::backup_now,
            commands::data_paths,
            commands::open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Naikkan versi skema yang dicek di `check_shell`**

Di `scripts/e2e-smoke.sh`, ganti `[[ "$(sql 'PRAGMA user_version')" = 1 ]]` menjadi:

```bash
  [[ "$(sql 'PRAGMA user_version')" = 2 ]] || fail "database not created or not migrated"
```

- [ ] **Step 4: Verifikasi penuh**

Run:

```bash
cd src-tauri && cargo clippy --all-targets -- -D warnings; echo "clippy $?"; cargo test; cd ..
bun run typecheck && bun run test && bun run build
bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa
```

Expected: `clippy 0`, `30 passed`, `6 pass`, dan `PASS`.

- [ ] **Step 5: Commit, push, PR**

```bash
git add src-tauri scripts/e2e-smoke.sh
git commit -m "feat: expose account commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```bash
git push -u origin feat/f2-1-accounts
gh pr create --title "Backend akun dan migrasi keuangan" --body "Migrasi 002 (accounts, transactions), backend akun, Inbox/Item terbaru hanya note. Verifikasi: cargo test 30, clippy bersih, e2e PASS. Closes #<issue F2-1>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Ganti `<issue F2-1>` dengan nomor dari Task 0. Setelah CI, SonarCloud, dan review semuanya bersih: `gh pr merge --squash --delete-branch && git switch main && git pull`.

---
## PR F2-2: Transaksi, transfer, dan ringkasan (`feat/f2-2-transactions`)

### Task 2.1: Helper bulan lokal

**Files:**
- Modify: `src-tauri/src/time.rs`

**Interfaces:**
- Produces: `month_of(now_ms, &TimeZone) -> Result<String, jiff::Error>` ("2026-09") dan `month_bounds("2026-09", &TimeZone) -> Result<(i64, i64), AppError>`.

- [ ] **Step 1: Buat branch, lalu tulis ulang `src-tauri/src/time.rs`**

```bash
git switch main && git pull && git switch -c feat/f2-2-transactions
```

```rust
use jiff::{Timestamp, ToSpan, Zoned, civil::Date, tz::TimeZone};

use crate::error::AppError;

pub fn now_ms() -> i64 {
    Timestamp::now().as_millisecond()
}

/// Start (inclusive) and end (exclusive) of the local day containing `now_ms`.
pub fn day_bounds(now_ms: i64, tz: &TimeZone) -> Result<(i64, i64), jiff::Error> {
    let today = Timestamp::from_millisecond(now_ms)?.to_zoned(tz.clone()).date();
    let start = today.to_zoned(tz.clone())?;
    let end = today.tomorrow()?.to_zoned(tz.clone())?;
    Ok((start.timestamp().as_millisecond(), end.timestamp().as_millisecond()))
}

/// Local month containing `now_ms`, as `YYYY-MM`.
pub fn month_of(now_ms: i64, tz: &TimeZone) -> Result<String, jiff::Error> {
    Ok(Timestamp::from_millisecond(now_ms)?.to_zoned(tz.clone()).strftime("%Y-%m").to_string())
}

/// Start (inclusive) and end (exclusive) of a local month given as `YYYY-MM`.
pub fn month_bounds(month: &str, tz: &TimeZone) -> Result<(i64, i64), AppError> {
    let invalid = || AppError::Invalid(format!("Bulan tidak valid: {month}"));
    let (year, mon) = month.split_once('-').ok_or_else(invalid)?;
    let year: i16 = year.parse().map_err(|_| invalid())?;
    let mon: i8 = mon.parse().map_err(|_| invalid())?;
    let first = Date::new(year, mon, 1).map_err(|_| invalid())?;
    let start = first.to_zoned(tz.clone())?;
    let end = first.checked_add(1.month())?.to_zoned(tz.clone())?;
    Ok((start.timestamp().as_millisecond(), end.timestamp().as_millisecond()))
}

/// Local date for daily backup names, e.g. `2026-09-29`.
pub fn today_stamp() -> String {
    Zoned::now().strftime("%Y-%m-%d").to_string()
}

/// Local date and time for manual backup names, e.g. `2026-09-29-142501`.
pub fn now_stamp() -> String {
    Zoned::now().strftime("%Y-%m-%d-%H%M%S").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(rfc3339: &str) -> i64 {
        rfc3339.parse::<Timestamp>().unwrap().as_millisecond()
    }

    fn jakarta() -> TimeZone {
        TimeZone::fixed(jiff::tz::offset(7))
    }

    #[test]
    fn day_bounds_follow_the_local_offset() {
        // 01:30 in Jakarta is still 28 Sep in UTC: the local date must win.
        let (start, end) = day_bounds(ms("2026-09-29T01:30:00+07:00"), &jakarta()).unwrap();
        assert_eq!(start, ms("2026-09-29T00:00:00+07:00"));
        assert_eq!(end, ms("2026-09-30T00:00:00+07:00"));
    }

    #[test]
    fn month_bounds_follow_the_local_offset() {
        let (start, end) = month_bounds("2026-09", &jakarta()).unwrap();
        assert_eq!(start, ms("2026-09-01T00:00:00+07:00"));
        assert_eq!(end, ms("2026-10-01T00:00:00+07:00"));
        let (_, end) = month_bounds("2026-12", &jakarta()).unwrap();
        assert_eq!(end, ms("2027-01-01T00:00:00+07:00"));
    }

    #[test]
    fn month_bounds_reject_bad_input() {
        for bad in ["2026", "2026-13", "abcd-01", "", "2026-9-1"] {
            assert!(matches!(month_bounds(bad, &jakarta()), Err(AppError::Invalid(_))), "{bad}");
        }
    }

    #[test]
    fn month_of_uses_local_date() {
        // 30 Sep 20:00 UTC is already 1 Oct in Jakarta.
        assert_eq!(month_of(ms("2026-09-30T20:00:00Z"), &jakarta()).unwrap(), "2026-10");
    }
}
```

- [ ] **Step 2: Jalankan test**

Run: `cd src-tauri && cargo test time:: ; cd ..`
Expected: `4 passed`. Helper baru ini belum dipakai di luar test, jadi clippy masih akan memperingatkan dead code sampai Task 2.2 selesai.

### Task 2.2: Transaksi, transfer, ringkasan, dan kategori (TDD)

**Files:**
- Modify: `src-tauri/src/finance.rs`

**Interfaces:**
- Produces:
  - `TransactionView { id, title, body, amount, category, accountId, accountName, occurredAt, createdAt, transferId, counterAccountId, counterAccountName }`
  - `TransactionInput { id?, kind: "expense" | "income", amount > 0, accountId, occurredAt, category?, title, body? }`
  - `TransferInput { transferId?, fromAccountId, toAccountId, amount > 0, occurredAt, title? }`
  - `MonthSummary { income, expense, byCategory: [{ category, amount }] }`
  - `Categories { expense, income }`
  - `FinanceOverview { hasAccounts, balance, income, expense }`
  - Fungsi: `get_transaction`, `list_transactions(month, account_id?, tz)`, `save_transaction`, `save_transfer`, `delete_transaction`, `month_summary`, `categories`, `overview(now, tz)`

- [ ] **Step 1: Tulis test yang gagal**

Ganti seluruh modul test di `src-tauri/src/finance.rs` (mulai dari `#[cfg(test)]` sampai akhir file) dengan:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use jiff::Timestamp;

    fn ms(rfc3339: &str) -> i64 {
        rfc3339.parse::<Timestamp>().unwrap().as_millisecond()
    }

    fn jakarta() -> TimeZone {
        TimeZone::fixed(jiff::tz::offset(7))
    }

    fn account(conn: &Connection, name: &str, opening: i64) -> String {
        let input = AccountInput { name: name.into(), kind: "bank".into(), opening_balance: opening };
        create_account(conn, &input, 1).unwrap().id
    }

    fn spend(conn: &Connection, account_id: &str, amount: i64, category: &str, day: &str) -> TransactionView {
        let input = TransactionInput {
            kind: "expense".into(),
            amount,
            account_id: account_id.into(),
            occurred_at: ms(day),
            category: Some(category.into()),
            title: "belanja".into(),
            ..Default::default()
        };
        save_transaction(conn, &input, 1).unwrap()
    }

    fn earn(conn: &Connection, account_id: &str, amount: i64, day: &str) -> TransactionView {
        let input = TransactionInput {
            kind: "income".into(),
            amount,
            account_id: account_id.into(),
            occurred_at: ms(day),
            category: Some("Gaji".into()),
            title: "gaji".into(),
            ..Default::default()
        };
        save_transaction(conn, &input, 1).unwrap()
    }

    fn transfer(conn: &Connection, from: &str, to: &str, amount: i64, day: &str) -> TransactionView {
        let input = TransferInput {
            from_account_id: from.into(),
            to_account_id: to.into(),
            amount,
            occurred_at: ms(day),
            ..Default::default()
        };
        save_transfer(conn, &input, 1).unwrap()
    }

    fn balance(conn: &Connection, id: &str) -> i64 {
        get_account(conn, id).unwrap().balance
    }

    #[test]
    fn new_account_starts_at_its_opening_balance() {
        let conn = open_in_memory();
        let bca = account(&conn, "  BCA ", 1_000_000);
        let view = get_account(&conn, &bca).unwrap();
        assert_eq!((view.name.as_str(), view.currency.as_str(), view.balance), ("BCA", "IDR", 1_000_000));
    }

    #[test]
    fn unused_account_can_be_deleted_once() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        delete_account(&conn, &bca, 2).unwrap();
        assert!(list_accounts(&conn).unwrap().is_empty());
        assert!(matches!(delete_account(&conn, &bca, 3), Err(AppError::NotFound)));
    }

    #[test]
    fn account_balance_is_opening_plus_live_transactions() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 1_000_000);
        spend(&conn, &bca, 25_000, "Makan & minum", "2026-09-29T00:00:00+07:00");
        let gone = spend(&conn, &bca, 5_000, "Belanja", "2026-09-29T00:00:00+07:00");
        earn(&conn, &bca, 500_000, "2026-09-28T00:00:00+07:00");
        delete_transaction(&conn, &gone.id, 2).unwrap();

        assert_eq!(balance(&conn, &bca), 1_475_000);
    }

    #[test]
    fn account_input_is_validated() {
        let conn = open_in_memory();
        let blank = AccountInput { name: "  ".into(), kind: "bank".into(), opening_balance: 0 };
        assert!(matches!(create_account(&conn, &blank, 1), Err(AppError::Invalid(_))));
        let odd = AccountInput { name: "X".into(), kind: "crypto".into(), opening_balance: 0 };
        assert!(matches!(create_account(&conn, &odd, 1), Err(AppError::Invalid(_))));
    }

    #[test]
    fn accounts_are_listed_by_name_and_can_be_updated() {
        let conn = open_in_memory();
        let gopay = account(&conn, "gopay", 0);
        account(&conn, "BCA", 0);
        let patch = AccountPatch { name: Some("GoPay".into()), kind: Some("ewallet".into()), opening_balance: Some(50_000) };
        let updated = update_account(&conn, &gopay, &patch, 2).unwrap();
        assert_eq!((updated.name.as_str(), updated.kind.as_str(), updated.balance), ("GoPay", "ewallet", 50_000));
        let names: Vec<String> = list_accounts(&conn).unwrap().into_iter().map(|a| a.name).collect();
        assert_eq!(names, ["BCA", "GoPay"]);
    }

    #[test]
    fn account_with_transactions_cannot_be_deleted() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let t = spend(&conn, &bca, 1_000, "Belanja", "2026-09-29T00:00:00+07:00");
        assert!(matches!(delete_account(&conn, &bca, 2), Err(AppError::AccountInUse)));

        delete_transaction(&conn, &t.id, 3).unwrap();
        delete_account(&conn, &bca, 4).unwrap();
        assert!(list_accounts(&conn).unwrap().is_empty());
    }

    #[test]
    fn transaction_input_is_validated() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let base = || TransactionInput {
            kind: "expense".into(),
            amount: 1_000,
            account_id: bca.clone(),
            occurred_at: 0,
            title: "x".into(),
            ..Default::default()
        };
        let zero = TransactionInput { amount: 0, ..base() };
        assert!(matches!(save_transaction(&conn, &zero, 1), Err(AppError::Invalid(_))));
        let odd = TransactionInput { kind: "gift".into(), ..base() };
        assert!(matches!(save_transaction(&conn, &odd, 1), Err(AppError::Invalid(_))));
        let ghost = TransactionInput { account_id: "nope".into(), ..base() };
        assert!(matches!(save_transaction(&conn, &ghost, 1), Err(AppError::Invalid(_))));
    }

    #[test]
    fn saving_with_an_id_updates_the_transaction() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let t = spend(&conn, &bca, 1_000, "Belanja", "2026-09-29T00:00:00+07:00");
        let input = TransactionInput {
            id: Some(t.id.clone()),
            kind: "income".into(),
            amount: 7_000,
            account_id: bca.clone(),
            occurred_at: t.occurred_at,
            category: Some("  ".into()),
            title: "bonus".into(),
            body: Some("catatan".into()),
        };
        let updated = save_transaction(&conn, &input, 2).unwrap();
        assert_eq!(updated.id, t.id);
        assert_eq!((updated.amount, updated.category.clone(), updated.title.as_str()), (7_000, None, "bonus"));
        assert_eq!(balance(&conn, &bca), 7_000);
    }

    #[test]
    fn transfer_moves_money_and_is_not_income_or_expense() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 1_000_000);
        let gopay = account(&conn, "GoPay", 0);
        let out = transfer(&conn, &bca, &gopay, 100_000, "2026-09-29T00:00:00+07:00");

        assert_eq!(out.amount, -100_000);
        assert_eq!(out.counter_account_name.as_deref(), Some("GoPay"));
        assert_eq!(out.counter_account_id.as_deref(), Some(gopay.as_str()));
        assert_eq!((balance(&conn, &bca), balance(&conn, &gopay)), (900_000, 100_000));
        let summary = month_summary(&conn, "2026-09", &jakarta()).unwrap();
        assert_eq!((summary.income, summary.expense), (0, 0));

        let all = list_transactions(&conn, "2026-09", None, &jakarta()).unwrap();
        assert_eq!(all.len(), 1, "a transfer is listed once without an account filter");
        let gopay_view = list_transactions(&conn, "2026-09", Some(&gopay), &jakarta()).unwrap();
        assert_eq!(gopay_view[0].amount, 100_000);
    }

    #[test]
    fn transfer_edit_and_delete_touch_both_legs() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 1_000_000);
        let gopay = account(&conn, "GoPay", 0);
        let out = transfer(&conn, &bca, &gopay, 100_000, "2026-09-29T00:00:00+07:00");
        let edit = TransferInput {
            transfer_id: out.transfer_id.clone(),
            from_account_id: bca.clone(),
            to_account_id: gopay.clone(),
            amount: 40_000,
            occurred_at: out.occurred_at,
            title: Some("isi saldo".into()),
        };
        let edited = save_transfer(&conn, &edit, 2).unwrap();
        assert_eq!((edited.id.as_str(), edited.title.as_str()), (out.id.as_str(), "isi saldo"));
        assert_eq!((balance(&conn, &bca), balance(&conn, &gopay)), (960_000, 40_000));

        let plain_edit = TransactionInput { id: Some(out.id.clone()), kind: "expense".into(), amount: 1, account_id: bca.clone(), ..Default::default() };
        assert!(matches!(save_transaction(&conn, &plain_edit, 3), Err(AppError::Invalid(_))));

        delete_transaction(&conn, &out.id, 4).unwrap();
        assert_eq!((balance(&conn, &bca), balance(&conn, &gopay)), (1_000_000, 0));
    }

    #[test]
    fn transfer_input_is_validated() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let same = TransferInput { from_account_id: bca.clone(), to_account_id: bca.clone(), amount: 1, ..Default::default() };
        assert!(matches!(save_transfer(&conn, &same, 1), Err(AppError::Invalid(_))));
    }

    #[test]
    fn month_totals_use_local_month_bounds() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        spend(&conn, &bca, 30_000, "Makan & minum", "2026-09-30T00:00:00+07:00");
        spend(&conn, &bca, 20_000, "Makan & minum", "2026-09-01T00:00:00+07:00");
        spend(&conn, &bca, 50_000, "Transportasi", "2026-09-15T00:00:00+07:00");
        let uncategorised = TransactionInput {
            kind: "expense".into(),
            amount: 5_000,
            account_id: bca.clone(),
            occurred_at: ms("2026-09-10T00:00:00+07:00"),
            title: "parkir".into(),
            ..Default::default()
        };
        save_transaction(&conn, &uncategorised, 1).unwrap();
        spend(&conn, &bca, 99_000, "Belanja", "2026-10-01T00:00:00+07:00"); // next month
        earn(&conn, &bca, 8_000_000, "2026-09-25T00:00:00+07:00");

        let s = month_summary(&conn, "2026-09", &jakarta()).unwrap();

        assert_eq!((s.income, s.expense), (8_000_000, 105_000));
        assert_eq!(
            s.by_category,
            vec![
                CategoryTotal { category: Some("Makan & minum".into()), amount: 50_000 },
                CategoryTotal { category: Some("Transportasi".into()), amount: 50_000 },
                CategoryTotal { category: None, amount: 5_000 },
            ]
        );
        let september = list_transactions(&conn, "2026-09", None, &jakarta()).unwrap();
        assert_eq!(september.len(), 5);
        assert_eq!(september[0].occurred_at, ms("2026-09-30T00:00:00+07:00"));
    }

    #[test]
    fn categories_merge_defaults_with_used_ones() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        spend(&conn, &bca, 1_000, "Kopi", "2026-09-29T00:00:00+07:00");
        spend(&conn, &bca, 1_000, "Belanja", "2026-09-29T00:00:00+07:00");
        let c = categories(&conn).unwrap();
        assert_eq!(c.expense.len(), EXPENSE_CATEGORIES.len() + 1);
        assert_eq!(c.expense.last().map(String::as_str), Some("Kopi"));
        assert_eq!(c.income, INCOME_CATEGORIES.map(String::from).to_vec());
    }

    #[test]
    fn overview_reports_current_month() {
        let conn = open_in_memory();
        assert!(!overview(&conn, ms("2026-09-29T12:00:00+07:00"), &jakarta()).unwrap().has_accounts);
        let bca = account(&conn, "BCA", 1_000_000);
        spend(&conn, &bca, 25_000, "Makan & minum", "2026-09-29T00:00:00+07:00");
        spend(&conn, &bca, 10_000, "Belanja", "2026-08-31T00:00:00+07:00");

        let o = overview(&conn, ms("2026-09-29T12:00:00+07:00"), &jakarta()).unwrap();

        assert_eq!(o, FinanceOverview { has_accounts: true, balance: 965_000, income: 0, expense: 25_000 });
    }
}
```

Run: `cd src-tauri && cargo test finance:: ; cd ..`
Expected: FAIL saat compile, dengan `cannot find struct 'TransactionInput'` dan `cannot find function 'save_transfer'`.

- [ ] **Step 2: Implementasi**

Ganti semua kode di atas modul test dengan:

```rust
//! Accounts, transactions, transfers and monthly totals. Amounts are integer
//! rupiah; a negative amount is money leaving the account.
use jiff::tz::TimeZone;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::items;
use crate::time::{month_bounds, month_of};

pub const ACCOUNT_KINDS: [&str; 4] = ["cash", "bank", "ewallet", "credit"];
pub const EXPENSE_CATEGORIES: [&str; 8] =
    ["Makan & minum", "Transportasi", "Belanja", "Tagihan", "Kesehatan", "Hiburan", "Pendidikan", "Lainnya"];
pub const INCOME_CATEGORIES: [&str; 4] = ["Gaji", "Bonus", "Hadiah", "Lainnya"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub currency: String,
    pub opening_balance: i64,
    pub balance: i64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub name: String,
    pub kind: String,
    pub opening_balance: i64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountPatch {
    pub name: Option<String>,
    pub kind: Option<String>,
    pub opening_balance: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionView {
    pub id: String,
    pub title: String,
    pub body: String,
    pub amount: i64,
    pub category: Option<String>,
    pub account_id: String,
    pub account_name: String,
    pub occurred_at: i64,
    pub created_at: i64,
    pub transfer_id: Option<String>,
    pub counter_account_id: Option<String>,
    pub counter_account_name: Option<String>,
}

/// `amount` is always positive; `kind` ("expense" or "income") sets the sign.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionInput {
    pub id: Option<String>,
    pub kind: String,
    pub amount: i64,
    pub account_id: String,
    pub occurred_at: i64,
    pub category: Option<String>,
    pub title: String,
    pub body: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferInput {
    pub transfer_id: Option<String>,
    pub from_account_id: String,
    pub to_account_id: String,
    pub amount: i64,
    pub occurred_at: i64,
    pub title: Option<String>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryTotal {
    pub category: Option<String>,
    pub amount: i64,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthSummary {
    pub income: i64,
    pub expense: i64,
    pub by_category: Vec<CategoryTotal>,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Categories {
    pub expense: Vec<String>,
    pub income: Vec<String>,
}

/// Dashboard widget data for the current local month.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceOverview {
    pub has_accounts: bool,
    pub balance: i64,
    pub income: i64,
    pub expense: i64,
}

fn invalid(message: &str) -> AppError {
    AppError::Invalid(message.to_string())
}

// ---------- accounts ----------

const ACCOUNT_SELECT: &str = "
    SELECT i.id, i.title, a.kind, a.currency, a.opening_balance,
           a.opening_balance + COALESCE((
               SELECT SUM(t.amount) FROM transactions t JOIN items ti ON ti.id = t.item_id
               WHERE t.account_id = i.id AND ti.deleted_at IS NULL), 0)
    FROM accounts a JOIN items i ON i.id = a.item_id
    WHERE i.deleted_at IS NULL";

fn account_from_row(r: &Row) -> rusqlite::Result<AccountView> {
    Ok(AccountView {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        currency: r.get(3)?,
        opening_balance: r.get(4)?,
        balance: r.get(5)?,
    })
}

fn account_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(invalid("Nama akun tidak boleh kosong"));
    }
    Ok(name.to_string())
}

fn account_kind(kind: &str) -> Result<(), AppError> {
    if ACCOUNT_KINDS.contains(&kind) { Ok(()) } else { Err(invalid("Jenis akun tidak dikenal")) }
}

pub fn list_accounts(conn: &Connection) -> Result<Vec<AccountView>, AppError> {
    let mut stmt = conn.prepare(&format!("{ACCOUNT_SELECT} ORDER BY i.title COLLATE NOCASE, i.id"))?;
    let rows = stmt.query_map([], account_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get_account(conn: &Connection, id: &str) -> Result<AccountView, AppError> {
    conn.query_row(&format!("{ACCOUNT_SELECT} AND i.id = ?1"), [id], account_from_row)
        .optional()?
        .ok_or(AppError::NotFound)
}

pub fn create_account(conn: &Connection, input: &AccountInput, now: i64) -> Result<AccountView, AppError> {
    let name = account_name(&input.name)?;
    account_kind(&input.kind)?;
    let tx = conn.unchecked_transaction()?;
    let id = items::insert(&tx, "account", &name, "", now)?;
    tx.execute(
        "INSERT INTO accounts (item_id, kind, opening_balance) VALUES (?1, ?2, ?3)",
        params![id, input.kind, input.opening_balance],
    )?;
    tx.commit()?;
    get_account(conn, &id)
}

pub fn update_account(conn: &Connection, id: &str, patch: &AccountPatch, now: i64) -> Result<AccountView, AppError> {
    get_account(conn, id)?;
    let name = patch.name.as_deref().map(account_name).transpose()?;
    if let Some(kind) = &patch.kind {
        account_kind(kind)?;
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE items SET title = COALESCE(?2, title), updated_at = ?3 WHERE id = ?1",
        params![id, name, now],
    )?;
    tx.execute(
        "UPDATE accounts SET kind = COALESCE(?2, kind), opening_balance = COALESCE(?3, opening_balance) WHERE item_id = ?1",
        params![id, patch.kind, patch.opening_balance],
    )?;
    tx.commit()?;
    get_account(conn, id)
}

pub fn delete_account(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    get_account(conn, id)?;
    let in_use: i64 = conn.query_row(
        "SELECT COUNT(*) FROM transactions t JOIN items i ON i.id = t.item_id
         WHERE t.account_id = ?1 AND i.deleted_at IS NULL",
        [id],
        |r| r.get(0),
    )?;
    if in_use > 0 {
        return Err(AppError::AccountInUse);
    }
    items::soft_delete(conn, id, now)?;
    Ok(())
}

// ---------- transactions ----------

// Both legs of a transfer are always written and deleted together, so the
// other leg (t2) of a live transfer is live too.
const TRANSACTION_SELECT: &str = "
    SELECT i.id, i.title, i.body, t.amount, t.category, t.account_id, ai.title,
           t.occurred_at, i.created_at, t.transfer_id, t2.account_id, ci.title
    FROM transactions t
    JOIN items i ON i.id = t.item_id
    JOIN items ai ON ai.id = t.account_id
    LEFT JOIN transactions t2 ON t2.transfer_id = t.transfer_id AND t2.item_id <> t.item_id
    LEFT JOIN items ci ON ci.id = t2.account_id
    WHERE i.deleted_at IS NULL";

fn transaction_from_row(r: &Row) -> rusqlite::Result<TransactionView> {
    Ok(TransactionView {
        id: r.get(0)?,
        title: r.get(1)?,
        body: r.get(2)?,
        amount: r.get(3)?,
        category: r.get(4)?,
        account_id: r.get(5)?,
        account_name: r.get(6)?,
        occurred_at: r.get(7)?,
        created_at: r.get(8)?,
        transfer_id: r.get(9)?,
        counter_account_id: r.get(10)?,
        counter_account_name: r.get(11)?,
    })
}

pub fn get_transaction(conn: &Connection, id: &str) -> Result<TransactionView, AppError> {
    conn.query_row(&format!("{TRANSACTION_SELECT} AND i.id = ?1"), [id], transaction_from_row)
        .optional()?
        .ok_or(AppError::NotFound)
}

/// Transactions in a local month, newest first. Without an account filter a
/// transfer appears once (its outgoing leg); with one, that account's leg.
pub fn list_transactions(
    conn: &Connection,
    month: &str,
    account_id: Option<&str>,
    tz: &TimeZone,
) -> Result<Vec<TransactionView>, AppError> {
    let (start, end) = month_bounds(month, tz)?;
    let sql = format!(
        "{TRANSACTION_SELECT} AND t.occurred_at >= ?1 AND t.occurred_at < ?2
           AND (CASE WHEN ?3 IS NULL THEN t.transfer_id IS NULL OR t.amount < 0 ELSE t.account_id = ?3 END)
         ORDER BY t.occurred_at DESC, i.created_at DESC, i.id DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![start, end, account_id], transaction_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn require_live_account(conn: &Connection, id: &str) -> Result<(), AppError> {
    get_account(conn, id).map(|_| ()).map_err(|_| invalid("Akun tidak ditemukan"))
}

fn positive(amount: i64) -> Result<(), AppError> {
    if amount > 0 { Ok(()) } else { Err(invalid("Jumlah harus lebih dari 0")) }
}

fn clean_category(category: Option<&str>) -> Option<String> {
    category.map(str::trim).filter(|c| !c.is_empty()).map(str::to_string)
}

pub fn save_transaction(conn: &Connection, input: &TransactionInput, now: i64) -> Result<TransactionView, AppError> {
    positive(input.amount)?;
    let signed = match input.kind.as_str() {
        "expense" => -input.amount,
        "income" => input.amount,
        _ => return Err(invalid("Jenis transaksi tidak dikenal")),
    };
    require_live_account(conn, &input.account_id)?;
    let title = input.title.trim();
    let body = input.body.as_deref().unwrap_or("");
    let category = clean_category(input.category.as_deref());

    let tx = conn.unchecked_transaction()?;
    let id = match &input.id {
        None => {
            let id = items::insert(&tx, "transaction", title, body, now)?;
            tx.execute(
                "INSERT INTO transactions (item_id, account_id, amount, category, occurred_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, input.account_id, signed, category, input.occurred_at],
            )?;
            id
        }
        Some(id) => {
            let existing = get_transaction(&tx, id)?;
            if existing.transfer_id.is_some() {
                return Err(invalid("Transfer diubah lewat formulir transfer"));
            }
            tx.execute("UPDATE items SET title = ?2, body = ?3, updated_at = ?4 WHERE id = ?1", params![id, title, body, now])?;
            tx.execute(
                "UPDATE transactions SET account_id = ?2, amount = ?3, category = ?4, occurred_at = ?5 WHERE item_id = ?1",
                params![id, input.account_id, signed, category, input.occurred_at],
            )?;
            id.clone()
        }
    };
    tx.commit()?;
    get_transaction(conn, &id)
}

/// Creates or updates both legs of a transfer; returns the outgoing leg.
pub fn save_transfer(conn: &Connection, input: &TransferInput, now: i64) -> Result<TransactionView, AppError> {
    positive(input.amount)?;
    if input.from_account_id == input.to_account_id {
        return Err(invalid("Akun asal dan tujuan harus berbeda"));
    }
    require_live_account(conn, &input.from_account_id)?;
    require_live_account(conn, &input.to_account_id)?;
    let title = input.title.as_deref().map(str::trim).filter(|t| !t.is_empty()).unwrap_or("Transfer");

    let tx = conn.unchecked_transaction()?;
    let out_id = match &input.transfer_id {
        None => {
            let transfer_id = uuid::Uuid::now_v7().to_string();
            let mut out_id = String::new();
            for (account, amount) in [(&input.from_account_id, -input.amount), (&input.to_account_id, input.amount)] {
                let id = items::insert(&tx, "transaction", title, "", now)?;
                tx.execute(
                    "INSERT INTO transactions (item_id, account_id, amount, occurred_at, transfer_id) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![id, account, amount, input.occurred_at, transfer_id],
                )?;
                if amount < 0 {
                    out_id = id;
                }
            }
            out_id
        }
        Some(transfer_id) => {
            let legs = transfer_legs(&tx, transfer_id)?;
            let (out_leg, in_leg) = legs.ok_or(AppError::NotFound)?;
            for (id, account, amount) in [
                (&out_leg, &input.from_account_id, -input.amount),
                (&in_leg, &input.to_account_id, input.amount),
            ] {
                tx.execute("UPDATE items SET title = ?2, updated_at = ?3 WHERE id = ?1", params![id, title, now])?;
                tx.execute(
                    "UPDATE transactions SET account_id = ?2, amount = ?3, occurred_at = ?4 WHERE item_id = ?1",
                    params![id, account, amount, input.occurred_at],
                )?;
            }
            out_leg
        }
    };
    tx.commit()?;
    get_transaction(conn, &out_id)
}

/// (outgoing leg id, incoming leg id) of a live transfer.
fn transfer_legs(conn: &Connection, transfer_id: &str) -> Result<Option<(String, String)>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT t.item_id, t.amount FROM transactions t JOIN items i ON i.id = t.item_id
         WHERE t.transfer_id = ?1 AND i.deleted_at IS NULL",
    )?;
    let legs: Vec<(String, i64)> = stmt.query_map([transfer_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    let out_leg = legs.iter().find(|(_, amount)| *amount < 0);
    let in_leg = legs.iter().find(|(_, amount)| *amount > 0);
    Ok(match (out_leg, in_leg) {
        (Some((out_id, _)), Some((in_id, _))) if legs.len() == 2 => Some((out_id.clone(), in_id.clone())),
        _ => None,
    })
}

/// Deletes a transaction; deleting either leg of a transfer deletes both.
pub fn delete_transaction(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    let existing = get_transaction(conn, id)?;
    let tx = conn.unchecked_transaction()?;
    match existing.transfer_id {
        Some(transfer_id) => {
            tx.execute(
                "UPDATE items SET deleted_at = ?2
                 WHERE deleted_at IS NULL AND id IN (SELECT item_id FROM transactions WHERE transfer_id = ?1)",
                params![transfer_id, now],
            )?;
        }
        None => {
            items::soft_delete(&tx, id, now)?;
        }
    }
    tx.commit()?;
    Ok(())
}

// ---------- totals ----------

const MONTH_FILTER: &str = "
    FROM transactions t JOIN items i ON i.id = t.item_id
    WHERE i.deleted_at IS NULL AND t.transfer_id IS NULL AND t.occurred_at >= ?1 AND t.occurred_at < ?2";

pub fn month_summary(conn: &Connection, month: &str, tz: &TimeZone) -> Result<MonthSummary, AppError> {
    let (start, end) = month_bounds(month, tz)?;
    let (income, expense): (i64, i64) = conn.query_row(
        &format!(
            "SELECT COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount END), 0),
                    COALESCE(-SUM(CASE WHEN t.amount < 0 THEN t.amount END), 0) {MONTH_FILTER}"
        ),
        params![start, end],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let mut stmt = conn.prepare(&format!(
        "SELECT t.category, -SUM(t.amount) AS spent {MONTH_FILTER} AND t.amount < 0
         GROUP BY t.category ORDER BY spent DESC, t.category"
    ))?;
    let by_category = stmt
        .query_map(params![start, end], |r| Ok(CategoryTotal { category: r.get(0)?, amount: r.get(1)? }))?
        .collect::<Result<_, _>>()?;
    Ok(MonthSummary { income, expense, by_category })
}

/// Built-in categories first, then any other category already used.
pub fn categories(conn: &Connection) -> Result<Categories, AppError> {
    let used = |sign: &str| -> Result<Vec<String>, AppError> {
        let mut stmt = conn.prepare(&format!(
            "SELECT DISTINCT t.category FROM transactions t JOIN items i ON i.id = t.item_id
             WHERE i.deleted_at IS NULL AND t.transfer_id IS NULL AND t.category IS NOT NULL AND t.amount {sign} 0
             ORDER BY t.category COLLATE NOCASE"
        ))?;
        let rows = stmt.query_map([], |r| r.get(0))?;
        Ok(rows.collect::<Result<_, _>>()?)
    };
    let merge = |defaults: &[&str], used: Vec<String>| -> Vec<String> {
        let mut all: Vec<String> = defaults.iter().map(|c| c.to_string()).collect();
        for c in used {
            if !all.contains(&c) {
                all.push(c);
            }
        }
        all
    };
    Ok(Categories { expense: merge(&EXPENSE_CATEGORIES, used("<")?), income: merge(&INCOME_CATEGORIES, used(">")?) })
}

pub fn overview(conn: &Connection, now: i64, tz: &TimeZone) -> Result<FinanceOverview, AppError> {
    let accounts = list_accounts(conn)?;
    let summary = month_summary(conn, &month_of(now, tz)?, tz)?;
    Ok(FinanceOverview {
        has_accounts: !accounts.is_empty(),
        balance: accounts.iter().map(|a| a.balance).sum(),
        income: summary.income,
        expense: summary.expense,
    })
}
```

- [ ] **Step 3: Jalankan test**

Run: `cd src-tauri && cargo test finance:: ; cd ..`
Expected: `14 passed`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri
git commit -m "feat: add transactions, transfers and monthly summary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2.3: `finance` di dashboard dan command transaksi

**Files:**
- Modify: `src-tauri/src/dashboard.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Produces:
  - `list_transactions(month, accountId?)`
  - `save_transaction(input)`
  - `save_transfer(input)`
  - `delete_transaction(id)`
  - `month_summary(month)`
  - `finance_categories()`
  - `get_dashboard().finance`

- [ ] **Step 1: Tulis ulang `src-tauri/src/dashboard.rs`**

```rust
use jiff::tz::TimeZone;
use rusqlite::{Connection, params};
use serde::Serialize;

use crate::error::AppError;
use crate::finance::{self, FinanceOverview};
use crate::items::{ItemSummary, summaries};
use crate::time::day_bounds;

pub const RECENT_LIMIT: usize = 8;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Today {
    pub due_today: Vec<ItemSummary>,
    pub overdue: Vec<ItemSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub today: Today,
    pub recent: Vec<ItemSummary>,
    pub finance: FinanceOverview,
}

pub fn get(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Dashboard, AppError> {
    let (start, end) = day_bounds(now, tz)?;
    Ok(Dashboard {
        today: Today {
            due_today: summaries(conn, "due_at >= ?1 AND due_at < ?2 ORDER BY due_at, title", params![start, end])?,
            overdue: summaries(conn, "due_at < ?1 ORDER BY due_at, title", params![start])?,
        },
        recent: summaries(
            conn,
            "type = 'note' ORDER BY last_activity_at DESC, id DESC LIMIT ?1",
            params![RECENT_LIMIT as i64],
        )?,
        finance: finance::overview(conn, now, tz)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::items::{ItemPatch, capture_note, delete, open, update};
    use jiff::Timestamp;

    fn ms(rfc3339: &str) -> i64 {
        rfc3339.parse::<Timestamp>().unwrap().as_millisecond()
    }

    fn jakarta() -> TimeZone {
        TimeZone::fixed(jiff::tz::offset(7))
    }

    fn note_due(conn: &Connection, title: &str, due: &str) -> String {
        let item = capture_note(conn, title, 1).unwrap();
        update(conn, &item.id, &ItemPatch { due_at: Some(Some(ms(due))), ..Default::default() }, 1).unwrap();
        item.id
    }

    fn titles(list: &[ItemSummary]) -> Vec<&str> {
        list.iter().map(|s| s.title.as_str()).collect()
    }

    #[test]
    fn splits_due_items_by_local_day() {
        let conn = open_in_memory();
        note_due(&conn, "kemarin", "2026-09-28T00:00:00+07:00");
        note_due(&conn, "b hari ini", "2026-09-29T00:00:00+07:00");
        note_due(&conn, "a hari ini", "2026-09-29T00:00:00+07:00");
        note_due(&conn, "besok", "2026-09-30T00:00:00+07:00");
        let gone = note_due(&conn, "dihapus", "2026-09-29T00:00:00+07:00");
        delete(&conn, &gone, 2).unwrap();

        // 01:30 in Jakarta is still 28 Sep in UTC: the local day must win.
        let d = get(&conn, ms("2026-09-29T01:30:00+07:00"), &jakarta()).unwrap();

        assert_eq!(titles(&d.today.due_today), ["a hari ini", "b hari ini"]);
        assert_eq!(titles(&d.today.overdue), ["kemarin"]);
    }

    #[test]
    fn recent_is_capped_and_ordered_by_last_activity() {
        let conn = open_in_memory();
        let mut ids = Vec::new();
        for i in 0..10 {
            ids.push(capture_note(&conn, &format!("n{i}"), 1000 + i).unwrap().id);
        }
        open(&conn, &ids[0], 5000).unwrap();

        let d = get(&conn, 6000, &jakarta()).unwrap();

        assert_eq!(d.recent.len(), RECENT_LIMIT);
        assert_eq!(titles(&d.recent)[..3], ["n0", "n9", "n8"]);
        assert_eq!(d.recent[0].last_activity_at, 5000);
    }
}
```

- [ ] **Step 2: Tulis ulang `src-tauri/src/commands.rs`**

```rust
//! Thin Tauri glue: every function here only resolves state and delegates.
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::dashboard::{self, Dashboard};
use crate::db::Db;
use crate::error::AppError;
use crate::finance::{self, AccountInput, AccountPatch, AccountView, Categories, MonthSummary, TransactionInput, TransactionView, TransferInput};
use crate::items::{self, Item, ItemPatch, ItemSummary};
use crate::{backup, time};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStatus {
    pub path: String,
    pub error: Option<String>,
    pub backup_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataPaths {
    pub data_dir: String,
    pub backup_dir: String,
    pub log_dir: String,
}

pub fn backup_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app.path().app_data_dir()?.join("backups"))
}

#[tauri::command]
pub fn db_status(db: State<'_, Db>) -> DbStatus {
    DbStatus { path: db.path.display().to_string(), error: db.open_error.clone(), backup_error: db.backup_error.clone() }
}

#[tauri::command]
pub fn capture_note(db: State<'_, Db>, text: String) -> Result<Item, AppError> {
    items::capture_note(&*db.conn()?, &text, time::now_ms())
}

#[tauri::command]
pub fn open_item(db: State<'_, Db>, id: String) -> Result<Item, AppError> {
    items::open(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn update_item(db: State<'_, Db>, id: String, patch: ItemPatch) -> Result<Item, AppError> {
    items::update(&*db.conn()?, &id, &patch, time::now_ms())
}

#[tauri::command]
pub fn delete_item(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    items::delete(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn list_inbox(db: State<'_, Db>) -> Result<Vec<ItemSummary>, AppError> {
    items::list_inbox(&*db.conn()?)
}

#[tauri::command]
pub fn get_dashboard(db: State<'_, Db>) -> Result<Dashboard, AppError> {
    dashboard::get(&*db.conn()?, time::now_ms(), &jiff::tz::TimeZone::system())
}

#[tauri::command]
pub fn list_accounts(db: State<'_, Db>) -> Result<Vec<AccountView>, AppError> {
    finance::list_accounts(&*db.conn()?)
}

#[tauri::command]
pub fn create_account(db: State<'_, Db>, input: AccountInput) -> Result<AccountView, AppError> {
    finance::create_account(&*db.conn()?, &input, time::now_ms())
}

#[tauri::command]
pub fn update_account(db: State<'_, Db>, id: String, patch: AccountPatch) -> Result<AccountView, AppError> {
    finance::update_account(&*db.conn()?, &id, &patch, time::now_ms())
}

#[tauri::command]
pub fn delete_account(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    finance::delete_account(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn list_transactions(db: State<'_, Db>, month: String, account_id: Option<String>) -> Result<Vec<TransactionView>, AppError> {
    finance::list_transactions(&*db.conn()?, &month, account_id.as_deref(), &jiff::tz::TimeZone::system())
}

#[tauri::command]
pub fn save_transaction(db: State<'_, Db>, input: TransactionInput) -> Result<TransactionView, AppError> {
    finance::save_transaction(&*db.conn()?, &input, time::now_ms())
}

#[tauri::command]
pub fn save_transfer(db: State<'_, Db>, input: TransferInput) -> Result<TransactionView, AppError> {
    finance::save_transfer(&*db.conn()?, &input, time::now_ms())
}

#[tauri::command]
pub fn delete_transaction(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    finance::delete_transaction(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn month_summary(db: State<'_, Db>, month: String) -> Result<MonthSummary, AppError> {
    finance::month_summary(&*db.conn()?, &month, &jiff::tz::TimeZone::system())
}

#[tauri::command]
pub fn finance_categories(db: State<'_, Db>) -> Result<Categories, AppError> {
    finance::categories(&*db.conn()?)
}

#[tauri::command]
pub fn backup_now(app: AppHandle, db: State<'_, Db>) -> Result<String, AppError> {
    let path = backup::manual(&*db.conn()?, &backup_dir(&app)?, &time::now_stamp())?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn data_paths(app: AppHandle) -> Result<DataPaths, AppError> {
    Ok(DataPaths {
        data_dir: app.path().app_data_dir()?.display().to_string(),
        backup_dir: backup_dir(&app)?.display().to_string(),
        log_dir: app.path().app_log_dir()?.display().to_string(),
    })
}

/// Opens one of the app's own folders in the file manager. The frontend
/// never passes a path, so it cannot open anything else.
#[tauri::command]
pub fn open_folder(app: AppHandle, kind: String) -> Result<(), AppError> {
    let dir = match kind.as_str() {
        "data" => app.path().app_data_dir()?,
        "backup" => backup_dir(&app)?,
        "log" => app.path().app_log_dir()?,
        other => return Err(AppError::Other(format!("folder tidak dikenal: {other}"))),
    };
    std::fs::create_dir_all(&dir)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))
}
```

- [ ] **Step 3: Tulis ulang `src-tauri/src/lib.rs`**

```rust
mod backup;
mod commands;
mod dashboard;
mod db;
mod error;
mod finance;
mod gpu;
mod items;
mod time;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Must stay first: it may call set_var, which is only sound before other threads start.
    let gpu_node = gpu::apply_linux_workaround();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            if let Some(node) = &gpu_node {
                log::info!("NVIDIA workaround: WEBKIT_WEB_RENDER_DEVICE_FILE={node}");
            }
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let mut db = db::Db::open_at(data_dir.join("anchoa.db"));
            match &db.open_error {
                Some(e) => log::error!("database open failed: {e}"),
                None => {
                    let result = backup::daily(&*db.conn()?, &data_dir.join("backups"), &time::today_stamp());
                    match result {
                        Ok(Some(path)) => log::info!("daily backup: {}", path.display()),
                        Ok(None) => {}
                        Err(e) => {
                            log::error!("daily backup failed: {e}");
                            db.backup_error = Some(e.to_string());
                        }
                    }
                }
            }
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_status,
            commands::capture_note,
            commands::open_item,
            commands::update_item,
            commands::delete_item,
            commands::list_inbox,
            commands::get_dashboard,
            commands::list_accounts,
            commands::create_account,
            commands::update_account,
            commands::delete_account,
            commands::list_transactions,
            commands::save_transaction,
            commands::save_transfer,
            commands::delete_transaction,
            commands::month_summary,
            commands::finance_categories,
            commands::backup_now,
            commands::data_paths,
            commands::open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Verifikasi penuh**

Jalankan perintah yang sama dengan Task 1.4 Step 4.
Expected: `clippy 0`, `43 passed`, `6 pass`, dan E2E `PASS`. Dashboard lama tetap berjalan, karena field `finance` yang baru diabaikan oleh frontend sampai F2-4.

- [ ] **Step 5: Commit, push, PR**

```bash
git add src-tauri
git commit -m "feat: expose transaction, transfer and summary commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```bash
git push -u origin feat/f2-2-transactions
gh pr create --title "Backend transaksi, transfer, dan ringkasan" --body "Transaksi dan transfer (dua baris, transfer_id sama), ringkasan bulanan lokal, kategori, finance di dashboard. Verifikasi: cargo test 43, clippy bersih, e2e PASS. Closes #<issue F2-2>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---
## PR F2-3: Halaman Keuangan, akun, dan transaksi (`feat/f2-3-finance-ui`)

### Task 3.1: Format rupiah dan bulan (TDD)

**Files:**
- Create: `src/money.ts`, `src/money.test.ts`
- Modify: `src/format.ts`, `src/format.test.ts`

**Interfaces:**
- Produces:
  - `formatRupiah(n)` ("Rp\u00a025.000")
  - `formatAmountInput(n)` ("25.000")
  - `parseRupiah(text) -> number | null`
  - `monthOf(ms)`, `shiftMonth(month, delta)`, `monthLabel(month)`

- [ ] **Step 1: Buat branch, lalu tulis test yang gagal**

```bash
git switch main && git pull && git switch -c feat/f2-3-finance-ui
```

`src/money.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { formatAmountInput, formatRupiah, parseRupiah } from "./money";

describe("formatRupiah", () => {
  test("uses dots and a non-breaking space", () => {
    expect(formatRupiah(25_000)).toBe("Rp 25.000");
    expect(formatRupiah(1_000_000)).toBe("Rp 1.000.000");
    expect(formatRupiah(-25_000)).toBe("-Rp 25.000");
    expect(formatAmountInput(8_000_000)).toBe("8.000.000");
  });
});

describe("parseRupiah", () => {
  test("accepts plain, grouped and prefixed amounts", () => {
    expect(parseRupiah("25000")).toBe(25_000);
    expect(parseRupiah("25.000")).toBe(25_000);
    expect(parseRupiah("Rp 25.000")).toBe(25_000);
    expect(parseRupiah("rp 1.000.000")).toBe(1_000_000);
    expect(parseRupiah(" 0 ")).toBe(0);
  });
  test("rejects decimals, bad grouping and text", () => {
    for (const bad of ["25,5", "25.5", "2.50.000", "abc", "", "-5000", "25.000,00"]) {
      expect(parseRupiah(bad)).toBeNull();
    }
  });
});
```

`src/format.test.ts` (seluruh isi file):

```ts
// Run with TZ=Asia/Jakarta (see the "test" script in package.json).
import { describe, expect, test } from "bun:test";
import {
  dateInputToMs,
  fullDate,
  greeting,
  monthLabel,
  monthOf,
  msToDateInput,
  relativeTime,
  shiftMonth,
  shortDate,
} from "./format";

const at = (iso: string) => new Date(iso).getTime();

describe("relativeTime", () => {
  const now = at("2026-09-29T14:00:00+07:00");
  test("short spans", () => {
    expect(relativeTime(now - 30_000, now)).toBe("baru saja");
    expect(relativeTime(now - 2 * 60_000, now)).toBe("2 menit lalu");
    expect(relativeTime(now - 5 * 3_600_000, now)).toBe("5 jam lalu");
  });
  test("calendar days", () => {
    expect(relativeTime(at("2026-09-28T09:00:00+07:00"), now)).toBe("kemarin");
    expect(relativeTime(at("2026-09-26T09:00:00+07:00"), now)).toBe("3 hari lalu");
    expect(relativeTime(at("2026-09-12T09:00:00+07:00"), now)).toBe("12 Sep");
  });
});

describe("dates", () => {
  test("short Indonesian date", () => {
    expect(shortDate(at("2026-09-12T08:00:00+07:00"))).toBe("12 Sep");
  });
  test("date input round trip uses local midnight", () => {
    expect(dateInputToMs("2026-10-01")).toBe(at("2026-10-01T00:00:00+07:00"));
    expect(msToDateInput(at("2026-10-01T00:00:00+07:00"))).toBe("2026-10-01");
    expect(dateInputToMs("")).toBeNull();
    expect(msToDateInput(null)).toBe("");
  });
});

describe("greeting", () => {
  test("follows the hour boundaries", () => {
    expect(greeting(4)).toBe("Selamat pagi");
    expect(greeting(10)).toBe("Selamat pagi");
    expect(greeting(11)).toBe("Selamat siang");
    expect(greeting(14)).toBe("Selamat siang");
    expect(greeting(15)).toBe("Selamat sore");
    expect(greeting(17)).toBe("Selamat sore");
    expect(greeting(18)).toBe("Selamat malam");
    expect(greeting(3)).toBe("Selamat malam");
  });
});

describe("fullDate", () => {
  test("weekday, day and month in Indonesian", () => {
    expect(fullDate(at("2026-09-29T08:00:00+07:00"))).toBe("Selasa, 29 September");
  });
});

describe("months", () => {
  test("local month, shifting across years and labels", () => {
    expect(monthOf(at("2026-10-01T00:30:00+07:00"))).toBe("2026-10");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthLabel("2026-09")).toBe("September 2026");
  });
});
```

Run: `bun run test`
Expected: FAIL dengan `Cannot find module './money'`.

- [ ] **Step 2: Implementasi**

`src/money.ts`:

```ts
const RUPIAH = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 });
const GROUPED = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/** "Rp 25.000" (non-breaking space after "Rp"); negative amounts start with "-". */
export function formatRupiah(amount: number): string {
  return RUPIAH.format(amount);
}

/** "25.000": digits with thousands dots, for amount inputs. */
export function formatAmountInput(amount: number): string {
  return GROUPED.format(amount);
}

/** Accepts "25000", "25.000" or "Rp 25.000". Returns null for anything else, including decimals. */
export function parseRupiah(text: string): number | null {
  const digits = text.replace(/^\s*rp/i, "").replace(/\s/g, "");
  if (!/^(\d+|\d{1,3}(\.\d{3})+)$/.test(digits)) return null;
  return Number(digits.replaceAll(".", ""));
}
```

`src/format.ts` (seluruh isi file):

```ts
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function greeting(hour: number): string {
  if (hour >= 4 && hour < 11) return "Selamat pagi";
  if (hour >= 11 && hour < 15) return "Selamat siang";
  if (hour >= 15 && hour < 18) return "Selamat sore";
  return "Selamat malam";
}

/** "Selasa, 29 September" */
export function fullDate(ms: number): string {
  return new Date(ms).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
}

/** "12 Sep" */
export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

export function relativeTime(then: number, now: number): string {
  const diff = now - then;
  if (diff < MINUTE) return "baru saja";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} menit lalu`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} jam lalu`;
  // Math.round absorbs 23/25-hour days around DST changes.
  const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY);
  if (days <= 1) return "kemarin";
  if (days < 7) return `${days} hari lalu`;
  return shortDate(then);
}

/** `<input type="date">` value ("2026-10-01") to local midnight in epoch ms. */
export function dateInputToMs(value: string): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
}

export function msToDateInput(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local month of `ms` as "2026-09". */
export function monthOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-09" moved by `delta` months, e.g. shiftMonth("2026-12", 1) === "2027-01". */
export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number);
  return monthOf(new Date(year, mon - 1 + delta, 1).getTime());
}

/** "September 2026" */
export function monthLabel(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(year, mon - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
}
```

Run: `bun run test`
Expected: `10 pass, 0 fail`.

`Intl` memformat rupiah dengan spasi tak-terputus (U+00A0) setelah "Rp". Test sengaja memeriksa karakter itu.

- [ ] **Step 3: Commit**

```bash
git add src/money.ts src/money.test.ts src/format.ts src/format.test.ts
git commit -m "feat: add rupiah and month formatting helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.2: Tipe API, panel, dan label

**Files:**
- Modify: `src/api.ts`
- Create: `src/shell/Panel.tsx`, `src/finance/labels.ts`

- [ ] **Step 1: Tulis ulang `src/api.ts`**

```ts
// The only module that talks to the Rust backend.
import { invoke } from "@tauri-apps/api/core";

export interface Item {
  id: string;
  type: string;
  title: string;
  body: string;
  parentId: string | null;
  dueAt: number | null;
  createdAt: number;
  updatedAt: number;
  openedAt: number | null;
}

export interface ItemSummary {
  id: string;
  type: string;
  title: string;
  dueAt: number | null;
  lastActivityAt: number;
}

/** Omitted fields stay unchanged; `dueAt: null` clears the due date. */
export interface ItemPatch {
  title?: string;
  body?: string;
  dueAt?: number | null;
}

export type AccountKind = "cash" | "bank" | "ewallet" | "credit";

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  openingBalance: number;
  balance: number;
}

export interface AccountInput {
  name: string;
  kind: AccountKind;
  openingBalance: number;
}

/** Amounts are integer rupiah; negative means money left the account. */
export interface Transaction {
  id: string;
  title: string;
  body: string;
  amount: number;
  category: string | null;
  accountId: string;
  accountName: string;
  occurredAt: number;
  createdAt: number;
  transferId: string | null;
  counterAccountId: string | null;
  counterAccountName: string | null;
}

/** `amount` is always positive; `kind` sets the sign. */
export interface TransactionInput {
  id?: string;
  kind: "expense" | "income";
  amount: number;
  accountId: string;
  occurredAt: number;
  category?: string;
  title: string;
  body?: string;
}

export interface TransferInput {
  transferId?: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  occurredAt: number;
  title?: string;
}

export interface Categories {
  expense: string[];
  income: string[];
}

export interface Dashboard {
  today: { dueToday: ItemSummary[]; overdue: ItemSummary[] };
  recent: ItemSummary[];
}

export interface DbStatus {
  path: string;
  error: string | null;
  backupError: string | null;
}

export interface DataPaths {
  dataDir: string;
  backupDir: string;
  logDir: string;
}

export type FolderKind = "data" | "backup" | "log";

export const api = {
  dbStatus: () => invoke<DbStatus>("db_status"),
  openFolder: (kind: FolderKind) => invoke<void>("open_folder", { kind }),
  captureNote: (text: string) => invoke<Item>("capture_note", { text }),
  openItem: (id: string) => invoke<Item>("open_item", { id }),
  updateItem: (id: string, patch: ItemPatch) => invoke<Item>("update_item", { id, patch }),
  deleteItem: (id: string) => invoke<void>("delete_item", { id }),
  listInbox: () => invoke<ItemSummary[]>("list_inbox"),
  getDashboard: () => invoke<Dashboard>("get_dashboard"),
  listAccounts: () => invoke<Account[]>("list_accounts"),
  createAccount: (input: AccountInput) => invoke<Account>("create_account", { input }),
  updateAccount: (id: string, patch: Partial<AccountInput>) => invoke<Account>("update_account", { id, patch }),
  deleteAccount: (id: string) => invoke<void>("delete_account", { id }),
  listTransactions: (month: string, accountId: string | null) =>
    invoke<Transaction[]>("list_transactions", { month, accountId }),
  saveTransaction: (input: TransactionInput) => invoke<Transaction>("save_transaction", { input }),
  saveTransfer: (input: TransferInput) => invoke<Transaction>("save_transfer", { input }),
  deleteTransaction: (id: string) => invoke<void>("delete_transaction", { id }),
  financeCategories: () => invoke<Categories>("finance_categories"),
  backupNow: () => invoke<string>("backup_now"),
  dataPaths: () => invoke<DataPaths>("data_paths"),
};

/** Backend errors arrive as `{ code, message }`. */
export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}
```

- [ ] **Step 2: Tulis `src/shell/Panel.tsx`**

```tsx
import { useEffect, type ReactNode } from "react";

/** Side panel over the page; Esc closes it. */
export function Panel({ title, onClose, children }: Readonly<{ title: string; onClose: () => void; children: ReactNode }>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
      <section
        aria-label={title}
        className="h-full w-96 overflow-y-auto bg-white p-6 shadow-xl dark:bg-neutral-900"
      >
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        {children}
      </section>
    </div>
  );
}

export const FIELD = "w-full rounded border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700";
export const PRIMARY = "rounded-md bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700";
export const SECONDARY =
  "rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800";
```

- [ ] **Step 3: Tulis `src/finance/labels.ts`**

```ts
import type { AccountKind } from "../api";

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  cash: "Tunai",
  bank: "Bank",
  ewallet: "E-wallet",
  credit: "Kartu kredit",
};
```

- [ ] **Step 4: Typecheck dan commit**

Run: `bun run typecheck`
Expected: tanpa output.

```bash
git add src
git commit -m "feat: add finance API types, side panel and account labels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.3: Halaman Keuangan, tab Akun dan Transaksi, dan formulir

**Files:**
- Create: `src/finance/AccountForm.tsx`, `src/finance/AccountsTab.tsx`, `src/finance/TransactionForm.tsx`, `src/finance/TransactionsTab.tsx`, `src/finance/FinancePage.tsx`
- Modify: `src/shell/Sidebar.tsx`, `src/App.tsx`

**Interfaces:**
- Produces:
  - `FinancePage({ initialTab? })`
  - `type FinanceTab` (`"transactions" | "accounts"`; PR F2-4 menambah `"summary"`)
  - `type Page` di `App.tsx` mendapat field opsional `tab`.

- [ ] **Step 1: Tulis `src/finance/AccountForm.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { api, errorMessage, type Account, type AccountKind } from "../api";
import { formatAmountInput, parseRupiah } from "../money";
import { FIELD, Panel, PRIMARY, SECONDARY } from "../shell/Panel";
import { useToast } from "../shell/toast";
import { ACCOUNT_KIND_LABEL } from "./labels";

export function AccountForm({ account, onDone }: Readonly<{ account?: Account; onDone: () => void }>) {
  const toast = useToast();
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "bank");
  const [opening, setOpening] = useState(account ? formatAmountInput(account.openingBalance) : "0");

  async function save(e: FormEvent) {
    e.preventDefault();
    const openingBalance = parseRupiah(opening);
    if (openingBalance === null) {
      toast("Saldo awal tidak valid", "error");
      return;
    }
    try {
      const input = { name, kind, openingBalance };
      await (account ? api.updateAccount(account.id, input) : api.createAccount(input));
      onDone();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function remove() {
    if (!account) return;
    try {
      await api.deleteAccount(account.id);
      onDone();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <Panel title={account ? "Ubah akun" : "Akun baru"} onClose={onDone}>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span>Nama</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
        </label>
        <label className="flex flex-col gap-1">
          <span>Jenis</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)} className={FIELD}>
            {Object.entries(ACCOUNT_KIND_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>Saldo awal (Rp)</span>
          <input
            inputMode="numeric"
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
            onBlur={() => {
              const value = parseRupiah(opening);
              if (value !== null) setOpening(formatAmountInput(value));
            }}
            className={FIELD}
          />
        </label>
        <div className="mt-2 flex gap-2">
          <button type="submit" className={PRIMARY}>
            Simpan
          </button>
          <button type="button" onClick={onDone} className={SECONDARY}>
            Batal
          </button>
          {account && (
            <button type="button" onClick={() => void remove()} className="ml-auto text-red-600">
              Hapus
            </button>
          )}
        </div>
      </form>
    </Panel>
  );
}
```

- [ ] **Step 2: Tulis `src/finance/AccountsTab.tsx`**

```tsx
import type { Account } from "../api";
import { formatRupiah } from "../money";
import { PRIMARY } from "../shell/Panel";
import { ACCOUNT_KIND_LABEL } from "./labels";

export function AccountsTab({
  accounts,
  onAdd,
  onEdit,
}: Readonly<{ accounts: Account[]; onAdd: () => void; onEdit: (account: Account) => void }>) {
  const total = accounts.reduce((sum, a) => sum + a.balance, 0);
  return (
    <div className="flex flex-col gap-3">
      {accounts.length === 0 && <p className="text-sm text-neutral-500">Belum ada akun. Buat akun dulu untuk mencatat transaksi.</p>}
      {accounts.map((a) => (
        <button
          key={a.id}
          onClick={() => onEdit(a)}
          className="flex items-center justify-between rounded-lg border border-neutral-200 px-4 py-3 text-left hover:bg-neutral-100 dark:border-neutral-800 dark:hover:bg-neutral-900"
        >
          <span>
            <span className="block font-medium">{a.name}</span>
            <span className="text-xs text-neutral-500">{ACCOUNT_KIND_LABEL[a.kind]}</span>
          </span>
          <span className={a.balance < 0 ? "text-red-600" : ""}>{formatRupiah(a.balance)}</span>
        </button>
      ))}
      {accounts.length > 0 && (
        <p className="flex justify-between px-4 text-sm font-semibold">
          <span>Saldo total</span>
          <span className={total < 0 ? "text-red-600" : ""}>{formatRupiah(total)}</span>
        </p>
      )}
      <button onClick={onAdd} className={`${PRIMARY} self-start`}>
        + Akun
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Tulis `src/finance/TransactionForm.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, type Account, type Categories, type Transaction } from "../api";
import { dateInputToMs, msToDateInput } from "../format";
import { formatAmountInput, parseRupiah } from "../money";
import { FIELD, Panel, PRIMARY, SECONDARY } from "../shell/Panel";
import { useToast } from "../shell/toast";

type Mode = "expense" | "income" | "transfer";
const MODE_LABEL: Record<Mode, string> = { expense: "Pengeluaran", income: "Pemasukan", transfer: "Transfer" };
const LAST_ACCOUNT_KEY = "anchoa.lastAccountId";

function lastAccount(accounts: Account[]): string {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(LAST_ACCOUNT_KEY);
  } catch {
    // Storage can be unavailable; fall back to the first account.
  }
  return accounts.find((a) => a.id === saved)?.id ?? accounts[0]?.id ?? "";
}

function rememberAccount(id: string) {
  try {
    localStorage.setItem(LAST_ACCOUNT_KEY, id);
  } catch {
    // Only a convenience; ignore.
  }
}

function initialMode(t?: Transaction): Mode {
  if (!t) return "expense";
  if (t.transferId) return "transfer";
  return t.amount < 0 ? "expense" : "income";
}

function todayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function TransactionForm({
  transaction: t,
  accounts,
  onDone,
}: Readonly<{ transaction?: Transaction; accounts: Account[]; onDone: () => void }>) {
  const toast = useToast();
  // For a transfer, "from" is the leg that lost money whichever leg was opened.
  let legs: [string | null, string | null] | null = null;
  if (t?.transferId) legs = t.amount < 0 ? [t.accountId, t.counterAccountId] : [t.counterAccountId, t.accountId];
  const initialFrom = legs?.[0] ?? t?.accountId ?? lastAccount(accounts);

  const [mode, setMode] = useState<Mode>(initialMode(t));
  const [amount, setAmount] = useState(t ? formatAmountInput(Math.abs(t.amount)) : "");
  const [date, setDate] = useState(msToDateInput(t?.occurredAt ?? todayMs()));
  const [accountId, setAccountId] = useState(initialFrom);
  const [toAccountId, setToAccountId] = useState(legs?.[1] ?? accounts.find((a) => a.id !== initialFrom)?.id ?? "");
  const [category, setCategory] = useState(t?.category ?? "");
  const [title, setTitle] = useState(t?.title ?? "");
  const [body, setBody] = useState(t?.body ?? "");
  const [categories, setCategories] = useState<Categories>({ expense: [], income: [] });

  useEffect(() => {
    api.financeCategories().then(setCategories, () => {});
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    const value = parseRupiah(amount);
    if (value === null || value <= 0) {
      toast("Jumlah harus angka lebih dari 0", "error");
      return;
    }
    const occurredAt = dateInputToMs(date) ?? todayMs();
    try {
      if (mode === "transfer") {
        await api.saveTransfer({ transferId: t?.transferId ?? undefined, fromAccountId: accountId, toAccountId, amount: value, occurredAt, title });
      } else {
        await api.saveTransaction({ id: t?.id, kind: mode, amount: value, accountId, occurredAt, category, title, body });
        rememberAccount(accountId);
      }
      onDone();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  async function remove() {
    if (!t) return;
    try {
      await api.deleteTransaction(t.id);
      onDone();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  const accountOptions = accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {a.name}
    </option>
  ));

  return (
    <Panel title={t ? "Ubah transaksi" : "Transaksi baru"} onClose={onDone}>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3 text-sm">
        <div className="flex gap-1">
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              // A saved transfer cannot become a plain transaction or the other way round.
              disabled={t !== undefined && (m === "transfer") !== (t.transferId !== null)}
              onClick={() => setMode(m)}
              className={`flex-1 rounded px-2 py-1.5 disabled:opacity-40 ${
                mode === m ? "bg-violet-600 text-white" : "border border-neutral-300 dark:border-neutral-700"
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1">
          <span>Jumlah (Rp)</span>
          <input
            autoFocus
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onBlur={() => {
              const value = parseRupiah(amount);
              if (value !== null) setAmount(formatAmountInput(value));
            }}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span>Tanggal</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} />
        </label>
        {mode === "transfer" ? (
          <>
            <label className="flex flex-col gap-1">
              <span>Dari</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={FIELD}>
                {accountOptions}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span>Ke</span>
              <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} className={FIELD}>
                {accountOptions}
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span>Akun</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={FIELD}>
                {accountOptions}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span>Kategori</span>
              <input list="finance-categories" value={category} onChange={(e) => setCategory(e.target.value)} className={FIELD} />
              <datalist id="finance-categories">
                {categories[mode].map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
          </>
        )}
        <label className="flex flex-col gap-1">
          <span>Keterangan</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={mode === "transfer" ? "Transfer" : "Makan siang"}
            className={FIELD}
          />
        </label>
        {mode !== "transfer" && (
          <label className="flex flex-col gap-1">
            <span>Catatan</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={FIELD} />
          </label>
        )}
        <div className="mt-2 flex gap-2">
          <button type="submit" className={PRIMARY}>
            Simpan
          </button>
          <button type="button" onClick={onDone} className={SECONDARY}>
            Batal
          </button>
          {t && (
            <button type="button" onClick={() => void remove()} className="ml-auto text-red-600">
              Hapus
            </button>
          )}
        </div>
      </form>
    </Panel>
  );
}
```

- [ ] **Step 4: Tulis `src/finance/TransactionsTab.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, errorMessage, type Account, type Transaction } from "../api";
import { fullDate } from "../format";
import { formatRupiah } from "../money";
import { useToast } from "../shell/toast";

function groupByDay(list: Transaction[]): [number, Transaction[]][] {
  const days = new Map<number, Transaction[]>();
  for (const t of list) {
    const day = days.get(t.occurredAt);
    if (day) day.push(t);
    else days.set(t.occurredAt, [t]);
  }
  return [...days.entries()];
}

function describe(t: Transaction): { detail: string; amount: string; color: string } {
  if (t.transferId) {
    const [from, to] = t.amount < 0 ? [t.accountName, t.counterAccountName] : [t.counterAccountName, t.accountName];
    return { detail: `${from} → ${to}`, amount: formatRupiah(Math.abs(t.amount)), color: "" };
  }
  const detail = `${t.category ?? "Tanpa kategori"} · ${t.accountName}`;
  if (t.amount < 0) return { detail, amount: `− ${formatRupiah(-t.amount)}`, color: "text-red-600" };
  return { detail, amount: `+ ${formatRupiah(t.amount)}`, color: "text-green-600" };
}

export function TransactionsTab({
  month,
  accounts,
  version,
  onEdit,
}: Readonly<{ month: string; accounts: Account[]; version: number; onEdit: (t: Transaction) => void }>) {
  const toast = useToast();
  const [accountFilter, setAccountFilter] = useState("");
  const [list, setList] = useState<Transaction[] | null>(null);

  useEffect(() => {
    api.listTransactions(month, accountFilter || null).then(setList, (e) => toast(errorMessage(e), "error"));
  }, [month, accountFilter, version, toast]);

  return (
    <div className="flex flex-col gap-4">
      <select
        aria-label="Filter akun"
        value={accountFilter}
        onChange={(e) => setAccountFilter(e.target.value)}
        className="w-48 self-end rounded border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
      >
        <option value="">Semua akun</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {list?.length === 0 && <p className="text-sm text-neutral-500">Belum ada transaksi di bulan ini</p>}
      {groupByDay(list ?? []).map(([day, items]) => (
        <section key={day}>
          <h3 className="mb-1 text-xs font-semibold uppercase text-neutral-500">{fullDate(day)}</h3>
          {items.map((t) => {
            const { detail, amount, color } = describe(t);
            return (
              <button
                key={t.id}
                onClick={() => onEdit(t)}
                className="flex w-full items-center justify-between gap-4 rounded px-2 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                <span className="min-w-0">
                  <span className="block truncate">{t.title || "Tanpa keterangan"}</span>
                  <span className="text-xs text-neutral-500">{detail}</span>
                </span>
                <span className={`shrink-0 ${color}`}>{amount}</span>
              </button>
            );
          })}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Tulis `src/finance/FinancePage.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type Account, type Transaction } from "../api";
import { monthLabel, monthOf, shiftMonth } from "../format";
import { PRIMARY } from "../shell/Panel";
import { useToast } from "../shell/toast";
import { AccountForm } from "./AccountForm";
import { AccountsTab } from "./AccountsTab";
import { TransactionForm } from "./TransactionForm";
import { TransactionsTab } from "./TransactionsTab";

export type FinanceTab = "transactions" | "accounts";

const TABS: [FinanceTab, string][] = [
  ["transactions", "Transaksi"],
  ["accounts", "Akun"],
];

type Form = { kind: "account"; account?: Account } | { kind: "transaction"; transaction?: Transaction };

export function FinancePage({ initialTab }: Readonly<{ initialTab?: FinanceTab }>) {
  const toast = useToast();
  const [tab, setTab] = useState<FinanceTab>(initialTab ?? "transactions");
  const [month, setMonth] = useState(() => monthOf(Date.now()));
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  // Bumped after every save so the lists reload.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api.listAccounts().then(setAccounts, (e) => toast(errorMessage(e), "error"));
  }, [version, toast]);

  const closeForm = useCallback(() => {
    setForm(null);
    setVersion((v) => v + 1);
  }, []);

  if (!accounts) return null;

  function newTransaction() {
    if (accounts?.length === 0) {
      setTab("accounts");
      toast("Buat akun dulu sebelum mencatat transaksi");
      return;
    }
    setForm({ kind: "transaction" });
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">Keuangan</h1>
        {tab !== "accounts" && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            <button aria-label="Bulan sebelumnya" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="px-2">
              ‹
            </button>
            <span className="w-36 text-center">{monthLabel(month)}</span>
            <button aria-label="Bulan berikutnya" onClick={() => setMonth((m) => shiftMonth(m, 1))} className="px-2">
              ›
            </button>
          </div>
        )}
        <button onClick={newTransaction} className={`${PRIMARY} ${tab === "accounts" ? "ml-auto" : ""}`}>
          + Transaksi
        </button>
      </div>

      <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === id ? "border-violet-600 text-violet-600" : "border-transparent text-neutral-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "transactions" && accounts.length === 0 && (
        <p className="text-sm text-neutral-500">
          Belum ada akun.{" "}
          <button onClick={() => setTab("accounts")} className="text-violet-600">
            Buat akun dulu
          </button>
        </p>
      )}
      {tab === "transactions" && accounts.length > 0 && (
        <TransactionsTab
          month={month}
          accounts={accounts}
          version={version}
          onEdit={(transaction) => setForm({ kind: "transaction", transaction })}
        />
      )}
      {tab === "accounts" && (
        <AccountsTab
          accounts={accounts}
          onAdd={() => setForm({ kind: "account" })}
          onEdit={(account) => setForm({ kind: "account", account })}
        />
      )}

      {form?.kind === "account" && <AccountForm account={form.account} onDone={closeForm} />}
      {form?.kind === "transaction" && (
        <TransactionForm transaction={form.transaction} accounts={accounts} onDone={closeForm} />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Tulis ulang `src/shell/Sidebar.tsx` dan `src/App.tsx`**

`src/shell/Sidebar.tsx`:

```tsx
export type TopPage = "dashboard" | "inbox" | "finance" | "settings";

export function Sidebar({ current, onSelect }: Readonly<{ current: string; onSelect: (page: TopPage) => void }>) {
  const link = (page: TopPage, label: string) => (
    <button
      onClick={() => onSelect(page)}
      aria-current={current === page ? "page" : undefined}
      className={`w-full rounded-md px-3 py-2 text-left text-sm ${
        current === page
          ? "bg-violet-600 text-white"
          : "text-neutral-600 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-neutral-200 bg-neutral-100 p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-4 px-3 text-lg font-bold">Anchoa</div>
      {link("dashboard", "Dashboard")}
      {link("inbox", "Inbox")}
      {link("finance", "Keuangan")}
      <div className="mt-auto">{link("settings", "Pengaturan")}</div>
    </nav>
  );
}
```

`src/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, type DbStatus } from "./api";
import { Dashboard } from "./dashboard/Dashboard";
import { FinancePage, type FinanceTab } from "./finance/FinancePage";
import { Inbox } from "./inbox/Inbox";
import { ItemPage } from "./item/ItemPage";
import { Settings } from "./settings/Settings";
import { AiColumn } from "./shell/AiColumn";
import { ErrorScreen } from "./shell/ErrorScreen";
import { Sidebar, type TopPage } from "./shell/Sidebar";
import { useToast } from "./shell/toast";

type Page = { name: TopPage; tab?: FinanceTab } | { name: "item"; id: string };

export function App() {
  const toast = useToast();
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [stack, setStack] = useState<Page[]>([{ name: "dashboard" }]);
  const [focusCapture, setFocusCapture] = useState(0);
  const page = stack[stack.length - 1];

  useEffect(() => {
    api.dbStatus().then((s) => {
      setStatus(s);
      if (s.backupError) toast(`Backup harian gagal: ${s.backupError}`, "error");
    });
  }, [toast]);

  // Ctrl+N: jump to the dashboard and focus quick capture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setStack([{ name: "dashboard" }]);
        setFocusCapture((n) => n + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!status) return null;
  if (status.error) return <ErrorScreen path={status.path} message={status.error} />;

  const openItem = (id: string) => setStack((s) => [...s, { name: "item", id }]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  return (
    <div className="flex h-full">
      <Sidebar current={page.name} onSelect={(name) => setStack([{ name }])} />
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {page.name === "dashboard" && <Dashboard onOpen={openItem} focusCapture={focusCapture} />}
        {page.name === "inbox" && <Inbox onOpen={openItem} />}
        {page.name === "item" && <ItemPage key={page.id} id={page.id} onBack={back} />}
        {page.name === "finance" && <FinancePage key={page.tab ?? "default"} initialTab={page.tab} />}
        {page.name === "settings" && <Settings />}
      </main>
      <AiColumn />
    </div>
  );
}
```

- [ ] **Step 7: Typecheck, test, build, commit**

Run: `bun run typecheck && bun run test && bun run build`
Expected: semua lulus, dengan `10 pass`.

```bash
git add src
git commit -m "feat: add finance page with accounts and transactions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.4: E2E keuangan

**Files:**
- Modify: `scripts/e2e-smoke.sh`

- [ ] **Step 1: Tambah `check_finance` dan opsi `E2E_ONLY`**

Ganti blok pemanggilan di akhir skrip, mulai dari baris `check_shell` sampai `echo "PASS. Screenshots in $WORK"`, dengan:

```bash
check_finance() {
  fresh
  start_app
  click 60 158          # sidebar: Keuangan
  click 351 95          # tab: Akun
  click 270 180         # + Akun (name field has focus)
  xdotool type --delay 20 'BCA'
  xdotool key Tab Tab ctrl+a
  xdotool type --delay 20 '1000000'
  xdotool key Return
  sleep 1
  [[ "$(sql "SELECT i.title || ':' || a.opening_balance FROM accounts a JOIN items i ON i.id = a.item_id")" = "BCA:1000000" ]] \
    || fail "account not saved"
  shot 7-accounts

  click 962 42          # + Transaksi (amount field has focus)
  xdotool type --delay 20 '25000'
  shot 7-transaction-form
  xdotool key Return
  sleep 1
  [[ "$(sql "SELECT amount FROM transactions")" = "-25000" ]] || fail "expense not saved"
  click 275 95          # tab: Transaksi
  shot 7-transactions
  stop_app
}

if [[ -n "${E2E_ONLY:-}" ]]; then
  "$E2E_ONLY"
  echo "PASS ($E2E_ONLY). Screenshots in $WORK"
  exit 0
fi

check_shell
check_corrupt_db
check_items
check_dashboard
check_backup
check_finance
echo "PASS. Screenshots in $WORK"
```

Dengan `E2E_ONLY=check_finance scripts/e2e-smoke.sh <binary>`, hanya satu skenario yang dijalankan. Ini berguna saat mencari koordinat klik.

- [ ] **Step 2: Jalankan dan periksa screenshot**

Run: `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`
Expected: `PASS`. Periksa screenshot berikut:
- `7-accounts.png`: kartu "BCA · Bank · Rp 1.000.000" dan Saldo total.
- `7-transaction-form.png`: panel "Transaksi baru" dengan jenis Pengeluaran aktif.
- `7-transactions.png`: "Selasa, 29 September" (atau tanggal hari ini), "Tanpa keterangan", "Tanpa kategori · BCA", dan "− Rp 25.000" berwarna merah. Filter akun ada di kanan dengan lebar 12rem.

- [ ] **Step 3: Commit, push, PR**

```bash
git add scripts/e2e-smoke.sh
git commit -m "test: cover accounts and transactions in e2e smoke test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```bash
git push -u origin feat/f2-3-finance-ui
gh pr create --title "Halaman Keuangan: akun dan transaksi" --body "Halaman Keuangan (pemilih bulan, tab Transaksi dan Akun), formulir akun dan transaksi (pengeluaran, pemasukan, transfer) di panel samping, format rupiah. Verifikasi: bun test 10, e2e PASS (akun + pengeluaran). Closes #<issue F2-3>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---
## PR F2-4: Ringkasan dan widget dashboard (`feat/f2-4-summary-widget`)

### Task 4.1: Tab Ringkasan

**Files:**
- Modify: `src/api.ts`, `src/finance/FinancePage.tsx`
- Create: `src/finance/SummaryTab.tsx`

- [ ] **Step 1: Buat branch, lalu tulis ulang `src/api.ts`**

```bash
git switch main && git pull && git switch -c feat/f2-4-summary-widget
```

```ts
// The only module that talks to the Rust backend.
import { invoke } from "@tauri-apps/api/core";

export interface Item {
  id: string;
  type: string;
  title: string;
  body: string;
  parentId: string | null;
  dueAt: number | null;
  createdAt: number;
  updatedAt: number;
  openedAt: number | null;
}

export interface ItemSummary {
  id: string;
  type: string;
  title: string;
  dueAt: number | null;
  lastActivityAt: number;
}

/** Omitted fields stay unchanged; `dueAt: null` clears the due date. */
export interface ItemPatch {
  title?: string;
  body?: string;
  dueAt?: number | null;
}

export type AccountKind = "cash" | "bank" | "ewallet" | "credit";

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  openingBalance: number;
  balance: number;
}

export interface AccountInput {
  name: string;
  kind: AccountKind;
  openingBalance: number;
}

/** Amounts are integer rupiah; negative means money left the account. */
export interface Transaction {
  id: string;
  title: string;
  body: string;
  amount: number;
  category: string | null;
  accountId: string;
  accountName: string;
  occurredAt: number;
  createdAt: number;
  transferId: string | null;
  counterAccountId: string | null;
  counterAccountName: string | null;
}

/** `amount` is always positive; `kind` sets the sign. */
export interface TransactionInput {
  id?: string;
  kind: "expense" | "income";
  amount: number;
  accountId: string;
  occurredAt: number;
  category?: string;
  title: string;
  body?: string;
}

export interface TransferInput {
  transferId?: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  occurredAt: number;
  title?: string;
}

export interface MonthSummary {
  income: number;
  expense: number;
  byCategory: { category: string | null; amount: number }[];
}

export interface Categories {
  expense: string[];
  income: string[];
}

export interface FinanceOverview {
  hasAccounts: boolean;
  balance: number;
  income: number;
  expense: number;
}

export interface Dashboard {
  today: { dueToday: ItemSummary[]; overdue: ItemSummary[] };
  recent: ItemSummary[];
  finance: FinanceOverview;
}

export interface DbStatus {
  path: string;
  error: string | null;
  backupError: string | null;
}

export interface DataPaths {
  dataDir: string;
  backupDir: string;
  logDir: string;
}

export type FolderKind = "data" | "backup" | "log";

export const api = {
  dbStatus: () => invoke<DbStatus>("db_status"),
  openFolder: (kind: FolderKind) => invoke<void>("open_folder", { kind }),
  captureNote: (text: string) => invoke<Item>("capture_note", { text }),
  openItem: (id: string) => invoke<Item>("open_item", { id }),
  updateItem: (id: string, patch: ItemPatch) => invoke<Item>("update_item", { id, patch }),
  deleteItem: (id: string) => invoke<void>("delete_item", { id }),
  listInbox: () => invoke<ItemSummary[]>("list_inbox"),
  getDashboard: () => invoke<Dashboard>("get_dashboard"),
  listAccounts: () => invoke<Account[]>("list_accounts"),
  createAccount: (input: AccountInput) => invoke<Account>("create_account", { input }),
  updateAccount: (id: string, patch: Partial<AccountInput>) => invoke<Account>("update_account", { id, patch }),
  deleteAccount: (id: string) => invoke<void>("delete_account", { id }),
  listTransactions: (month: string, accountId: string | null) =>
    invoke<Transaction[]>("list_transactions", { month, accountId }),
  saveTransaction: (input: TransactionInput) => invoke<Transaction>("save_transaction", { input }),
  saveTransfer: (input: TransferInput) => invoke<Transaction>("save_transfer", { input }),
  deleteTransaction: (id: string) => invoke<void>("delete_transaction", { id }),
  monthSummary: (month: string) => invoke<MonthSummary>("month_summary", { month }),
  financeCategories: () => invoke<Categories>("finance_categories"),
  backupNow: () => invoke<string>("backup_now"),
  dataPaths: () => invoke<DataPaths>("data_paths"),
};

/** Backend errors arrive as `{ code, message }`. */
export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}
```

- [ ] **Step 2: Tulis `src/finance/SummaryTab.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, errorMessage, type MonthSummary } from "../api";
import { formatRupiah } from "../money";
import { useToast } from "../shell/toast";

export function SummaryTab({ month, version }: Readonly<{ month: string; version: number }>) {
  const toast = useToast();
  const [summary, setSummary] = useState<MonthSummary | null>(null);

  useEffect(() => {
    api.monthSummary(month).then(setSummary, (e) => toast(errorMessage(e), "error"));
  }, [month, version, toast]);

  if (!summary) return null;
  const net = summary.income - summary.expense;
  const largest = Math.max(1, ...summary.byCategory.map((c) => c.amount));

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <span className="block text-xs text-neutral-500">Pemasukan</span>
          <span className="text-lg text-green-600">{formatRupiah(summary.income)}</span>
        </div>
        <div>
          <span className="block text-xs text-neutral-500">Pengeluaran</span>
          <span className="text-lg text-red-600">{formatRupiah(summary.expense)}</span>
        </div>
        <div>
          <span className="block text-xs text-neutral-500">Selisih</span>
          <span className={`text-lg ${net < 0 ? "text-red-600" : ""}`}>{formatRupiah(net)}</span>
        </div>
      </div>
      <section className="flex flex-col gap-3">
        <h3 className="font-semibold">Pengeluaran per kategori</h3>
        {summary.byCategory.length === 0 && <p className="text-sm text-neutral-500">Belum ada pengeluaran di bulan ini</p>}
        {summary.byCategory.map((c) => (
          <div key={c.category ?? ""} className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <span>{c.category ?? "Tanpa kategori"}</span>
              <span>{formatRupiah(c.amount)}</span>
            </div>
            <div className="h-2 rounded bg-violet-500" style={{ width: `${(c.amount / largest) * 100}%` }} />
          </div>
        ))}
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Tulis ulang `src/finance/FinancePage.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type Account, type Transaction } from "../api";
import { monthLabel, monthOf, shiftMonth } from "../format";
import { PRIMARY } from "../shell/Panel";
import { useToast } from "../shell/toast";
import { AccountForm } from "./AccountForm";
import { AccountsTab } from "./AccountsTab";
import { SummaryTab } from "./SummaryTab";
import { TransactionForm } from "./TransactionForm";
import { TransactionsTab } from "./TransactionsTab";

export type FinanceTab = "transactions" | "accounts" | "summary";

const TABS: [FinanceTab, string][] = [
  ["transactions", "Transaksi"],
  ["accounts", "Akun"],
  ["summary", "Ringkasan"],
];

type Form = { kind: "account"; account?: Account } | { kind: "transaction"; transaction?: Transaction };

export function FinancePage({ initialTab }: Readonly<{ initialTab?: FinanceTab }>) {
  const toast = useToast();
  const [tab, setTab] = useState<FinanceTab>(initialTab ?? "transactions");
  const [month, setMonth] = useState(() => monthOf(Date.now()));
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  // Bumped after every save so the lists reload.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api.listAccounts().then(setAccounts, (e) => toast(errorMessage(e), "error"));
  }, [version, toast]);

  const closeForm = useCallback(() => {
    setForm(null);
    setVersion((v) => v + 1);
  }, []);

  if (!accounts) return null;

  function newTransaction() {
    if (accounts?.length === 0) {
      setTab("accounts");
      toast("Buat akun dulu sebelum mencatat transaksi");
      return;
    }
    setForm({ kind: "transaction" });
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">Keuangan</h1>
        {tab !== "accounts" && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            <button aria-label="Bulan sebelumnya" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="px-2">
              ‹
            </button>
            <span className="w-36 text-center">{monthLabel(month)}</span>
            <button aria-label="Bulan berikutnya" onClick={() => setMonth((m) => shiftMonth(m, 1))} className="px-2">
              ›
            </button>
          </div>
        )}
        <button onClick={newTransaction} className={`${PRIMARY} ${tab === "accounts" ? "ml-auto" : ""}`}>
          + Transaksi
        </button>
      </div>

      <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === id ? "border-violet-600 text-violet-600" : "border-transparent text-neutral-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "transactions" && accounts.length === 0 && (
        <p className="text-sm text-neutral-500">
          Belum ada akun.{" "}
          <button onClick={() => setTab("accounts")} className="text-violet-600">
            Buat akun dulu
          </button>
        </p>
      )}
      {tab === "transactions" && accounts.length > 0 && (
        <TransactionsTab
          month={month}
          accounts={accounts}
          version={version}
          onEdit={(transaction) => setForm({ kind: "transaction", transaction })}
        />
      )}
      {tab === "accounts" && (
        <AccountsTab
          accounts={accounts}
          onAdd={() => setForm({ kind: "account" })}
          onEdit={(account) => setForm({ kind: "account", account })}
        />
      )}
      {tab === "summary" && <SummaryTab month={month} version={version} />}

      {form?.kind === "account" && <AccountForm account={form.account} onDone={closeForm} />}
      {form?.kind === "transaction" && (
        <TransactionForm transaction={form.transaction} accounts={accounts} onDone={closeForm} />
      )}
    </div>
  );
}
```

### Task 4.2: Widget dashboard aktif

**Files:**
- Modify: `src/dashboard/FinanceWidget.tsx`, `src/dashboard/Dashboard.tsx`, `src/App.tsx`

- [ ] **Step 1: Tulis ulang `src/dashboard/FinanceWidget.tsx`**

```tsx
import type { FinanceOverview } from "../api";
import type { FinanceTab } from "../finance/FinancePage";
import { formatRupiah } from "../money";
import { Card } from "../shell/Card";

export function FinanceWidget({
  finance,
  onOpenFinance,
}: Readonly<{ finance?: FinanceOverview; onOpenFinance: (tab: FinanceTab) => void }>) {
  return (
    <Card title="Keuangan bulan ini">
      {finance && !finance.hasAccounts && (
        <>
          <p className="text-sm text-neutral-500">Belum ada akun</p>
          <button onClick={() => onOpenFinance("accounts")} className="mt-2 text-sm text-violet-600">
            Buat akun
          </button>
        </>
      )}
      {finance?.hasAccounts && (
        <>
          <p className={`text-2xl font-semibold ${finance.balance < 0 ? "text-red-600" : ""}`}>
            {formatRupiah(finance.balance)}
          </p>
          <p className="text-xs text-neutral-500">Saldo total</p>
          <div className="mt-3 flex gap-6 text-sm">
            <span>
              <span className="block text-xs text-neutral-500">Pemasukan</span>
              <span className="text-green-600">{formatRupiah(finance.income)}</span>
            </span>
            <span>
              <span className="block text-xs text-neutral-500">Pengeluaran</span>
              <span className="text-red-600">{formatRupiah(finance.expense)}</span>
            </span>
          </div>
          <button onClick={() => onOpenFinance("transactions")} className="mt-3 text-sm text-violet-600">
            Buka Keuangan
          </button>
        </>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Tulis ulang `src/dashboard/Dashboard.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type Dashboard as DashboardData } from "../api";
import type { FinanceTab } from "../finance/FinancePage";
import { useToast } from "../shell/toast";
import { FinanceWidget } from "./FinanceWidget";
import { QuickCapture } from "./QuickCapture";
import { RecentWidget } from "./RecentWidget";
import { TodayWidget } from "./TodayWidget";

export function Dashboard({
  onOpen,
  onOpenFinance,
  focusCapture,
}: Readonly<{ onOpen: (id: string) => void; onOpenFinance: (tab: FinanceTab) => void; focusCapture: number }>) {
  const toast = useToast();
  const [data, setData] = useState<DashboardData | null>(null);

  const load = useCallback(() => {
    api.getDashboard().then(setData, (e) => toast(errorMessage(e), "error"));
  }, [toast]);

  useEffect(load, [load]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <QuickCapture onSaved={load} focusSignal={focusCapture} />
      <div className="grid grid-cols-2 gap-4">
        <TodayWidget today={data?.today} onOpen={onOpen} />
        <FinanceWidget finance={data?.finance} onOpenFinance={onOpenFinance} />
        <div className="col-span-2">
          <RecentWidget items={data?.recent} onOpen={onOpen} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Tulis ulang `src/App.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, type DbStatus } from "./api";
import { Dashboard } from "./dashboard/Dashboard";
import { FinancePage, type FinanceTab } from "./finance/FinancePage";
import { Inbox } from "./inbox/Inbox";
import { ItemPage } from "./item/ItemPage";
import { Settings } from "./settings/Settings";
import { AiColumn } from "./shell/AiColumn";
import { ErrorScreen } from "./shell/ErrorScreen";
import { Sidebar, type TopPage } from "./shell/Sidebar";
import { useToast } from "./shell/toast";

type Page = { name: TopPage; tab?: FinanceTab } | { name: "item"; id: string };

export function App() {
  const toast = useToast();
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [stack, setStack] = useState<Page[]>([{ name: "dashboard" }]);
  const [focusCapture, setFocusCapture] = useState(0);
  const page = stack[stack.length - 1];

  useEffect(() => {
    api.dbStatus().then((s) => {
      setStatus(s);
      if (s.backupError) toast(`Backup harian gagal: ${s.backupError}`, "error");
    });
  }, [toast]);

  // Ctrl+N: jump to the dashboard and focus quick capture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setStack([{ name: "dashboard" }]);
        setFocusCapture((n) => n + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!status) return null;
  if (status.error) return <ErrorScreen path={status.path} message={status.error} />;

  const openItem = (id: string) => setStack((s) => [...s, { name: "item", id }]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  return (
    <div className="flex h-full">
      <Sidebar current={page.name} onSelect={(name) => setStack([{ name }])} />
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {page.name === "dashboard" && (
          <Dashboard
            onOpen={openItem}
            onOpenFinance={(tab) => setStack([{ name: "finance", tab }])}
            focusCapture={focusCapture}
          />
        )}
        {page.name === "inbox" && <Inbox onOpen={openItem} />}
        {page.name === "item" && <ItemPage key={page.id} id={page.id} onBack={back} />}
        {page.name === "finance" && <FinancePage key={page.tab ?? "default"} initialTab={page.tab} />}
        {page.name === "settings" && <Settings />}
      </main>
      <AiColumn />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck, test, build, commit**

Run: `bun run typecheck && bun run test && bun run build`
Expected: semua lulus.

```bash
git add src
git commit -m "feat: add monthly summary tab and live finance widget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.3: E2E ringkasan dan dashboard, lalu PR

- [ ] **Step 1: Tambahkan langkah ini di akhir `check_finance`, sebelum `stop_app`**

```bash
  click 431 95          # tab: Ringkasan
  shot 7-summary
  click 60 78           # sidebar: Dashboard
  shot 7-dashboard      # expect: Saldo total Rp 975.000, Pengeluaran Rp 25.000
```

- [ ] **Step 2: Jalankan dan periksa screenshot**

Run: `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`
Expected: `PASS`. Periksa screenshot berikut:
- `7-summary.png`: Pemasukan Rp 0, Pengeluaran Rp 25.000, Selisih -Rp 25.000, dan "Tanpa kategori Rp 25.000" dengan batang penuh.
- `7-dashboard.png`: widget "Keuangan bulan ini" menampilkan Rp 975.000 (Saldo total), Pemasukan Rp 0, Pengeluaran Rp 25.000, dan tautan "Buka Keuangan".

- [ ] **Step 3: Commit, push, PR**

```bash
git add scripts/e2e-smoke.sh
git commit -m "test: cover summary tab and finance widget in e2e smoke test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

```bash
git push -u origin feat/f2-4-summary-widget
gh pr create --title "Ringkasan bulanan dan widget dashboard" --body "Tab Ringkasan (pemasukan, pengeluaran, selisih, per kategori) dan widget Keuangan bulan ini yang aktif. Verifikasi: e2e PASS (screenshot ringkasan + dashboard Rp 975.000). Closes #<issue F2-4>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Setelah merge**

Tutup milestone "Fase 2". Rilis `v0.2.0` dibuat bersama user, dengan cara yang sama seperti rilis Fase 1: naikkan `version` di `package.json`, `src-tauri/Cargo.toml`, dan `src-tauri/tauri.conf.json`, lalu build RPM, uji instalasi, dan buat GitHub Release.

## Cakupan spec

| Bagian spec | Task |
|---|---|
| §4 Tabel `accounts`/`transactions`, pemetaan ke `items`, soft delete | 1.1, 1.3, 2.2 |
| §4 Aturan saldo, transfer, pemasukan/pengeluaran bulanan, per kategori | 1.3, 2.2 |
| §5 Command akun | 1.3, 1.4 |
| §5 Command transaksi, transfer, ringkasan, kategori, `finance` di dashboard | 2.2, 2.3 |
| §5 Validasi (`invalid`, `account_in_use`), parameter `month` | 1.1, 1.3, 2.1, 2.2 |
| §6 Sidebar, halaman Keuangan, pemilih bulan, tab Transaksi dan Akun, formulir | 3.2, 3.3 |
| §6 Tab Ringkasan, widget dashboard | 4.1, 4.2 |
| §6 Format uang | 3.1 |
| §7 Error handling (panel tetap terbuka saat gagal, transfer atomik) | 2.2, 3.3 |
| §8 Testing | semua task |
| A9 Inbox dan Item terbaru hanya `note` | 1.2 |
| §9 Kriteria 6 (upgrade DB Fase 1 dan `.bak-v1`) | 1.1 |
