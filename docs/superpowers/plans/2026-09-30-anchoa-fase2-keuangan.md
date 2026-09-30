# Anchoa Fase 2 (Keuangan): Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Di repo ini, setiap task ditulis oleh Gemini 3.8 Flash High lewat `agy` (lihat "Menjalankan task dengan agy"), lalu dicek oleh sesi Opus. Review per PR juga memakai `agy`; lihat CLAUDE.md "Model per step".

## Status verifikasi

Semua blok kode di rencana ini sudah diterapkan di worktree percobaan (tidak di-push), dengan hasil berikut:
- `cargo test`: 71 lulus;
- `cargo clippy --all-targets -- -D warnings`: bersih;
- `bun run typecheck`: bersih;
- `bun run test`: 43 lulus;
- E2E: `PASS`, termasuk `check_finance` dan `check_bills`. Koordinat klik di bawah diukur dari build itu.

## Menjalankan task dengan agy

Satu task per run, di branch PR yang sedang dikerjakan, dari root repo:

```bash
agy --model gemini-3.8-flash-high --dangerously-skip-permissions --print-timeout 1200s -p "Implement Task <N> of docs/superpowers/plans/2026-09-30-anchoa-fase2-keuangan.md exactly as written, step by step, including its tests and its commit. Follow CLAUDE.md. Rules: work only inside this repository; do not push, merge, open PRs, change git remotes or branches, or touch files the task does not list; do not open URLs. When done, print the output of the task's test commands and the commit hash."
```

`--dangerously-skip-permissions` menyetujui semua permintaan tool tanpa bertanya. Karena itu aturan di prompt membatasi pekerjaannya ke repo ini. Push, PR, dan merge tetap dikerjakan sesi Opus. Setelah setiap run, sesi Opus menjalankan test task itu dan membaca diff commit-nya. Kalau satu task gagal dua kali, pakai agent `implementer` (Sonnet).

**Goal:** Membangun halaman Keuangan sesuai artboard: beberapa akun, transaksi dan transfer, kartu bulanan, grafik arus kas 6 bulan, tagihan sekali atau bulanan dengan "Tandai lunas", dan satu batas pengeluaran bulanan. Kartu Keuangan di dashboard, panel notifikasi, dan command palette ikut memakai data ini.

**Architecture:**
- Setiap akun, transaksi, tagihan, dan batas adalah satu baris `items` dengan tabel ekstensi (`accounts`, `transactions`, `bills`, `budgets`) dari migrasi `004_finance.sql`.
- Logika backend berupa fungsi murni yang menerima `&Connection`, `now`, dan `&TimeZone`, dibagi per tanggung jawab:
  - `finance.rs`: akun, transaksi, transfer, kategori;
  - `overview.rs`: total bulan, grafik, batas;
  - `bills.rs`: tagihan dan pelunasan.
  `commands.rs` hanya glue.
- Frontend memanggil backend hanya lewat `src/api.ts`. Komponen Keuangan ada di `src/finance/`, dan logika tampilan yang bisa diuji ada di fungsi murni (`src/money.ts`, `src/finance/view.ts`).

**Tech Stack:** Tauri 2, Rust 2024, rusqlite 0.40, jiff 0.2, React 19, TypeScript, Tailwind CSS 4, bun test. Tidak ada dependency baru.

**Spec:** `docs/superpowers/specs/2026-09-30-anchoa-fase2-keuangan-design.md`

## Global Constraints

- Uang disimpan sebagai integer rupiah, tidak pernah float. Nilai negatif berarti uang keluar dari akun.
- Semua query keuangan melakukan join ke `items` dan memfilter `deleted_at IS NULL`.
- Batas hari dan bulan dihitung di Rust dengan zona waktu lokal (`TimeZone::system()` di `commands.rs`). Test memakai offset tetap +7, dan "sekarang" di test keuangan adalah Selasa 29 September 2026 12:00 WIB (`finance::testing::now()`).
- Saldo menghitung transaksi yang tanggalnya sebelum awal hari besok (spec K4).
- `save_transfer`, `delete_transaction` pada transfer, dan `pay_bill` berjalan dalam satu transaksi SQLite (`unchecked_transaction`).
- Validasi mengembalikan `AppError::Invalid` (`code: "invalid"`) dengan pesan dalam Bahasa Indonesia. Akun yang masih dipakai mengembalikan `AppError::AccountInUse` (`code: "account_in_use"`).
- Query Inbox, Terbaru, Hari ini, dan 7 hari ke depan hanya membaca `type = 'note'` (spec K9).
- Clean code, supaya mudah di-maintain:
  - satu file, satu tanggung jawab;
  - logika ada di fungsi murni yang dites, sedangkan komponen dan command hanya merangkai;
  - nama menjelaskan maksud;
  - tidak ada duplikasi, jadi pakai helper yang sudah ada (`items::insert`, `finance::testing`, `Dialog`, `useSave`, `fields.tsx`);
  - nilai yang punya cabang logika memakai tipe tertutup (enum di Rust, union di TypeScript), bukan string bebas;
  - komentar menjelaskan kenapa, bukan apa.
- Semua teks UI dalam Bahasa Indonesia; kode, komentar, dan nama file dalam bahasa Inggris.
- Props komponen React dibungkus `Readonly<...>`. Jangan pakai `Math.random()`. Script bash memakai `[[ ... ]]`. Elemen dengan `onClick` yang bukan tombol atau tautan butuh handler keyboard.
- Animasi hanya `transform` dan `opacity`, dengan atribut `data-anim`.
- Warna dari token `src/index.css`. Token baru: `--color-warn: #c98500` (sama dengan `--cat-tagihan` di `docs/design/tokens.css`), untuk tingkat batas `warn`.
- Frontend tidak menyentuh DB. Semua panggilan backend lewat `src/api.ts`.
- E2E berjalan di Xvfb `:99` dan tidak pernah menyentuh display `:0`. Koordinat klik baru diukur dari screenshot di `~/.cache/anchoa-e2e/` sebelum dipakai.
- Perintah pemeriksaan:
  - `bun run typecheck`
  - `bun run test`
  - `cd src-tauri && cargo test`
  - `cd src-tauri && cargo clippy --all-targets -- -D warnings`
  - `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`

## Koordinat

Nav (x = 36): Dashboard 94, Inbox 148, Email 202, Jadwal 256, Keuangan 310, Proyek 364, Berkas 418, Unduhan 472, Notifikasi 652, Profil 706, Pengaturan 760. Tombol asisten mini: 1226, 746.

Halaman Keuangan (diukur dari build percobaan rencana ini; ukur ulang kalau layout berubah):
- konten mulai x = 100 dan berakhir x = 1252; kolom kanan (Akun, Tagihan) mulai x = 873;
- kartu Pengeluaran: 820, 200. Kartu ini 12px lebih tinggi setelah batas diatur;
- dengan satu akun dan tanpa batas: "+ Tambah" Tagihan di 1207, 461, dan "Tandai lunas" pada tagihan pertama di 1177, 508.

## Prosedur penutup PR

Task terakhir setiap PR menjalankan langkah ini. Nomor issue, branch, dan base ditulis di task tersebut.

1. Jalankan semua perintah pemeriksaan di Global Constraints, lalu simpan ekor outputnya.
2. Buka screenshot E2E yang disebut di task, lalu cocokkan dengan artboard `docs/design/artboards/Keuangan.dc.html` (atau `Main.dc.html` dan `NotifPanel.dc.html` untuk dashboard dan notifikasi).
3. Review dengan `agy`:
   ```bash
   git diff <base>...HEAD > .git/review.diff
   agy --model gemini-3.8-flash-high --mode plan --print-timeout 600s -p "Rules: do not run shell commands, do not open URLs, and read only files inside this repository with your built-in file viewing tool. Task: review the diff in .git/review.diff against CLAUDE.md, docs/superpowers/specs/2026-09-30-anchoa-fase2-keuangan-design.md and docs/superpowers/plans/2026-09-30-anchoa-fase2-keuangan.md. Open changed files for context. Report bugs, security issues and spec mismatches, one per line as path:line: problem. Say NONE if clean."
   ```
   Kalau `agy` gagal dua kali, pakai agent `reviewer-opus`. Periksa setiap temuan; perbaiki yang benar, lalu commit.
4. `git push -u origin <branch>`, lalu `gh pr create --base <base>`. Body PR memuat ringkasan, output pemeriksaan, daftar screenshot, hasil review, `Closes #<issue>`, dan baris atribusi Claude Code.
5. Jangan merge. Merge hanya kalau user bilang.

**Base branch:** kalau PR sebelumnya sudah di-merge, branch baru dibuat dari `main` dan base-nya `main`. Kalau belum, branch baru dibuat dari branch PR sebelumnya dan base-nya branch itu (PR bertumpuk).

## Pembagian PR

| PR | Branch | Isi |
|---|---|---|
| F2-1 | `feat/<N1>-f2-1-accounts` | Migrasi 004, filter `type = 'note'`, varian `AppError`, backend akun |
| F2-2 | `feat/<N2>-f2-2-transactions` | Helper bulan, transaksi, transfer, kategori, `finance_overview`, `set_budget` |
| F2-3 | `feat/<N3>-f2-3-bills` | Backend tagihan dan `finance` di `get_dashboard` |
| F2-4 | `feat/<N4>-f2-4-finance-page` | Format uang, dialog formulir, halaman Keuangan, kartu dashboard, aksi palette, E2E keuangan |
| F2-5 | `feat/<N5>-f2-5-bills-ui` | Bagian Tagihan, toast dengan aksi, ringkasan satu baris, panel notifikasi, E2E tagihan |

`<N1>`–`<N5>` adalah nomor issue dari Task 0.

---

## Task 0: Milestone dan issue

- [ ] **Step 1: Buat milestone "Fase 2" dan 5 issue**

```bash
gh api repos/Syharipf/Anchoa/milestones -f title="Fase 2" -f description="Keuangan. Spec: docs/superpowers/specs/2026-09-30-anchoa-fase2-keuangan-design.md"
P=docs/superpowers/plans/2026-09-30-anchoa-fase2-keuangan.md
gh issue create --milestone "Fase 2" --title "F2-1: migrasi keuangan dan backend akun" --body "Rencana: $P, PR F2-1."
gh issue create --milestone "Fase 2" --title "F2-2: transaksi, transfer, ringkasan, dan batas" --body "Rencana: $P, PR F2-2."
gh issue create --milestone "Fase 2" --title "F2-3: backend tagihan dan data dashboard" --body "Rencana: $P, PR F2-3."
gh issue create --milestone "Fase 2" --title "F2-4: halaman Keuangan" --body "Rencana: $P, PR F2-4."
gh issue create --milestone "Fase 2" --title "F2-5: tagihan di UI dan notifikasi" --body "Rencana: $P, PR F2-5."
gh issue list --milestone "Fase 2"
```

Catat nomor kelima issue itu. Nomor tersebut dipakai untuk nama branch dan `Closes #N`.

---

# PR F2-1: Migrasi dan backend akun

### Task 1: Migrasi 004 dan test upgrade

**Files:**
- Create: `src-tauri/migrations/004_finance.sql`
- Modify: `src-tauri/src/db.rs` (`MIGRATIONS` dan test baru)
- Modify: `scripts/e2e-smoke.sh` (`check_shell`)

**Interfaces:**
- Produces: tabel `accounts`, `transactions`, `bills`, `budgets`. `MIGRATIONS` berisi 4 migrasi, dan `user_version` DB baru = 4.

- [ ] **Step 1: Buat branch**

```bash
git switch main && git pull && git switch -c feat/<N1>-f2-1-accounts
```

- [ ] **Step 2: Tulis test yang gagal**

Tambahkan test ini di modul `tests` di `src-tauri/src/db.rs`, tepat setelah `upgrade_backs_up_old_version_first`:

```rust
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

        assert_eq!(version(&conn), 4);
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
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `cd src-tauri && cargo test db::tests::version_3 ; cd ..`
Expected: FAIL di `assert_eq!(version(&conn), 4)` dengan `left: 3, right: 4`.

- [ ] **Step 4: Tulis `src-tauri/migrations/004_finance.sql`**

```sql
-- Fase 2: accounts, transactions, bills and the monthly limit. Each row
-- extends an `items` row with the same id (spec Fase 2 §3).
CREATE TABLE accounts (
  item_id         TEXT PRIMARY KEY REFERENCES items(id),
  kind            TEXT NOT NULL,              -- cash | bank | ewallet | credit
  currency        TEXT NOT NULL DEFAULT 'IDR',
  opening_balance INTEGER NOT NULL DEFAULT 0  -- rupiah
);

CREATE TABLE transactions (
  item_id     TEXT PRIMARY KEY REFERENCES items(id),
  account_id  TEXT NOT NULL REFERENCES items(id),
  amount      INTEGER NOT NULL,          -- rupiah; negative = money leaving the account
  category    TEXT,                      -- NULL = no category; always NULL for transfers
  occurred_at INTEGER NOT NULL,          -- local midnight of the date, epoch ms UTC
  transfer_id TEXT,                      -- shared by both legs of a transfer
  bill_id     TEXT REFERENCES items(id)  -- set when recorded by "Tandai lunas"
);

CREATE TABLE bills (
  item_id    TEXT PRIMARY KEY REFERENCES items(id),
  account_id TEXT NOT NULL REFERENCES items(id),
  amount     INTEGER NOT NULL,  -- rupiah, positive
  repeat     TEXT NOT NULL,     -- once | monthly
  due_day    INTEGER NOT NULL   -- original day of month, 1-31
);

CREATE TABLE budgets (
  item_id  TEXT PRIMARY KEY REFERENCES items(id),
  category TEXT,             -- NULL = the total monthly limit (the only kind in Fase 2)
  amount   INTEGER NOT NULL  -- rupiah per month, positive
);

CREATE INDEX transactions_account  ON transactions(account_id);
CREATE INDEX transactions_occurred ON transactions(occurred_at);
CREATE INDEX transactions_transfer ON transactions(transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX transactions_bill     ON transactions(bill_id)     WHERE bill_id IS NOT NULL;
```

- [ ] **Step 5: Daftarkan migrasi di `src-tauri/src/db.rs`**

```rust
pub const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/001_init.sql"),
    include_str!("../migrations/002_item_completion.sql"),
    include_str!("../migrations/003_contributions.sql"),
    include_str!("../migrations/004_finance.sql"),
];
```

- [ ] **Step 6: Jalankan test**

Run: `cd src-tauri && cargo test db:: ; cd ..`
Expected: `6 passed`.

- [ ] **Step 7: Naikkan versi skema di E2E**

Di `check_shell` di `scripts/e2e-smoke.sh`, ganti `= 3 ]]` menjadi `= 4 ]]`:

```bash
  [[ "$(sql 'PRAGMA user_version')" = 4 ]] || fail "database not created or not migrated"
```

- [ ] **Step 8: Commit**

```bash
git add src-tauri/migrations/004_finance.sql src-tauri/src/db.rs scripts/e2e-smoke.sh
git commit -m "feat: add finance schema migration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Daftar catatan hanya berisi `note`

**Files:**
- Modify: `src-tauri/src/items.rs` (`list_inbox` dan test)
- Modify: `src-tauri/src/dashboard.rs` (`today_tasks`, `upcoming`, `get`, dan test)

**Interfaces:**
- Produces: `list_inbox`, `Dashboard.today`, `Dashboard.upcoming`, `Dashboard.recent`, dan `Dashboard.inbox_count` hanya membaca item `type = 'note'`. Palette memakai `recent`, jadi "Terbaru" ikut bersih.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di modul `tests` di `src-tauri/src/items.rs`, setelah `inbox_lists_newest_first`:

```rust
    #[test]
    fn inbox_lists_notes_only() {
        let conn = open_in_memory();
        capture_note(&conn, "catatan", 1000).unwrap();
        conn.execute("INSERT INTO items (id, type, title, created_at, updated_at) VALUES ('a1', 'account', 'BCA', 2000, 2000)", [])
            .unwrap();
        let titles: Vec<String> = list_inbox(&conn).unwrap().into_iter().map(|s| s.title).collect();
        assert_eq!(titles, ["catatan"]);
    }
```

Tambahkan di modul `tests` di `src-tauri/src/dashboard.rs`, di akhir modul:

```rust
    #[test]
    fn finance_items_stay_out_of_note_lists() {
        let conn = open_in_memory();
        capture_note(&conn, "catatan", 1).unwrap();
        let today = ms("2026-09-29T00:00:00+07:00");
        let tomorrow = ms("2026-09-30T00:00:00+07:00");
        for (id, kind, due) in [("a1", "account", None), ("b1", "bill", Some(today)), ("b2", "bill", Some(tomorrow))] {
            conn.execute(
                "INSERT INTO items (id, type, title, due_at, created_at, updated_at) VALUES (?1, ?2, ?1, ?3, 5, 5)",
                params![id, kind, due],
            )
            .unwrap();
        }

        let d = get(&conn, ms("2026-09-29T12:00:00+07:00"), &jakarta()).unwrap();

        assert!(d.today.is_empty());
        assert!(d.upcoming.iter().all(|day| day.tasks.is_empty()));
        let titles: Vec<&str> = d.recent.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, ["catatan"]);
        assert_eq!(d.inbox_count, 1);
    }
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Cargo hanya menerima satu filter, jadi jalankan dua kali:

```bash
cd src-tauri && cargo test inbox_lists_notes_only; cargo test finance_items_stay_out; cd ..
```

Expected: keduanya FAIL. `inbox_lists_notes_only` mendapat `["BCA", "catatan"]`, dan `finance_items_stay_out_of_note_lists` gagal di `d.today.is_empty()`.

- [ ] **Step 3: Filter query di `src-tauri/src/items.rs`**

```rust
/// Unfiled notes. Accounts, transactions and bills have their own pages (spec Fase 2 K9).
pub fn list_inbox(conn: &Connection) -> Result<Vec<ItemSummary>, AppError> {
    summaries(conn, "type = 'note' AND parent_id IS NULL ORDER BY created_at DESC, id DESC", [])
}
```

- [ ] **Step 4: Filter query di `src-tauri/src/dashboard.rs`**

Di `today_tasks`, baris `WHERE` menjadi:

```rust
         WHERE deleted_at IS NULL AND type = 'note' AND due_at IS NOT NULL AND (
```

Di `upcoming`, baris `WHERE` menjadi:

```rust
         WHERE deleted_at IS NULL AND type = 'note' AND completed_at IS NULL AND due_at >= ?1 AND due_at < ?2
```

Di `get`, klausa `recent` dan query `inbox_count` menjadi:

```rust
        recent: summaries(
            conn,
            "type = 'note' ORDER BY last_activity_at DESC, id DESC LIMIT ?1",
            params![RECENT_LIMIT as i64],
        )?,
        inbox_count: conn.query_row(
            "SELECT COUNT(*) FROM items WHERE deleted_at IS NULL AND type = 'note' AND parent_id IS NULL",
            [],
            |r| r.get(0),
        )?,
```

- [ ] **Step 5: Jalankan test**

Run: `cd src-tauri && cargo test ; cd ..`
Expected: `0 failed`. `items::` berisi 12 test dan `dashboard::` berisi 5 test.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/items.rs src-tauri/src/dashboard.rs
git commit -m "feat: keep note lists to notes only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Backend akun

**Files:**
- Modify: `src-tauri/src/error.rs` (varian `Invalid` dan `AccountInUse`)
- Modify: `src-tauri/src/items.rs` (helper `insert` dan `soft_delete`)
- Create: `src-tauri/src/finance.rs`
- Modify: `src-tauri/src/lib.rs` (tambah `mod finance;` setelah `mod error;`)

**Interfaces:**
- Produces:
  - `AppError::Invalid(String)` → `code: "invalid"`; `AppError::AccountInUse` → `code: "account_in_use"`, pesan "Akun masih punya transaksi atau tagihan".
  - `items::insert(conn, kind, title, body, now) -> Result<String, AppError>` (id UUIDv7 baru) dan `items::soft_delete(conn, id, now) -> Result<bool, AppError>`.
  - `finance::AccountView { id, name, kind, currency, opening_balance, balance }` (JSON camelCase).
  - `finance::AccountInput { id: Option<String>, name, kind, opening_balance }`.
  - `finance::list_accounts(conn, now, tz)`, `get_account(conn, id, now, tz)`, `save_account(conn, &input, now, tz)`, `delete_account(conn, id, now, tz)`.
  - `finance::invalid(msg) -> AppError`, `finance::balance_cutoff(now, tz) -> Result<i64, AppError>`, `finance::ACCOUNT_KINDS`.
  - Modul test bersama `finance::testing` berisi `ms`, `jakarta`, `now`, `account(conn, name, opening) -> String`.

- [ ] **Step 1: Tulis ulang `src-tauri/src/error.rs`**

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
    #[error("Akun masih punya transaksi atau tagihan")]
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

- [ ] **Step 2: Tambah helper di `src-tauri/src/items.rs`**

Tambahkan dua fungsi ini tepat setelah `get`:

```rust
/// Inserts a bare `items` row and returns its new UUIDv7 id. Modules add
/// their extension row with the same id.
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
```

Lalu pakai keduanya di `capture_note` dan `delete`:

```rust
pub fn capture_note(conn: &Connection, text: &str, now: i64) -> Result<Item, AppError> {
    let title = text.trim();
    if title.is_empty() {
        return Err(AppError::Empty);
    }
    let id = insert(conn, "note", title, "", now)?;
    get(conn, &id)
}
```

```rust
pub fn delete(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    if !soft_delete(conn, id, now)? {
        return Err(AppError::NotFound);
    }
    Ok(())
}
```

- [ ] **Step 3: Buat `src-tauri/src/finance.rs` berisi test dan helper test**

Tambahkan juga `mod finance;` setelah `mod error;` di `src-tauri/src/lib.rs`.

```rust
#[cfg(test)]
pub(crate) mod testing {
    //! Helpers shared by the finance, overview, bills and dashboard tests.
    use super::*;
    use jiff::Timestamp;

    pub fn ms(rfc3339: &str) -> i64 {
        rfc3339.parse::<Timestamp>().unwrap().as_millisecond()
    }

    pub fn jakarta() -> TimeZone {
        TimeZone::fixed(jiff::tz::offset(7))
    }

    /// "Now" in every finance test: Tuesday 29 Sep 2026, 12:00 in Jakarta.
    pub fn now() -> i64 {
        ms("2026-09-29T12:00:00+07:00")
    }

    pub fn account(conn: &Connection, name: &str, opening: i64) -> String {
        let input = AccountInput { name: name.into(), kind: "bank".into(), opening_balance: opening, ..Default::default() };
        save_account(conn, &input, now(), &jakarta()).unwrap().id
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn new_account_starts_at_its_opening_balance() {
        let conn = open_in_memory();
        let bca = account(&conn, "  BCA ", 1_000_000);
        let view = get_account(&conn, &bca, now(), &jakarta()).unwrap();
        assert_eq!(
            (view.name.as_str(), view.kind.as_str(), view.currency.as_str(), view.balance),
            ("BCA", "bank", "IDR", 1_000_000)
        );
        let kind: String = conn.query_row("SELECT type FROM items WHERE id = ?1", [&bca], |r| r.get(0)).unwrap();
        assert_eq!(kind, "account");
    }

    #[test]
    fn account_input_is_validated() {
        let conn = open_in_memory();
        let blank = AccountInput { name: "  ".into(), kind: "bank".into(), ..Default::default() };
        assert!(matches!(save_account(&conn, &blank, now(), &jakarta()), Err(AppError::Invalid(_))));
        let odd = AccountInput { name: "X".into(), kind: "crypto".into(), ..Default::default() };
        assert!(matches!(save_account(&conn, &odd, now(), &jakarta()), Err(AppError::Invalid(_))));
        assert!(list_accounts(&conn, now(), &jakarta()).unwrap().is_empty());
    }

    #[test]
    fn saving_with_an_id_updates_and_lists_by_name() {
        let conn = open_in_memory();
        let gopay = account(&conn, "gopay", 0);
        account(&conn, "BCA", 0);
        let input =
            AccountInput { id: Some(gopay.clone()), name: "GoPay".into(), kind: "ewallet".into(), opening_balance: -50_000 };

        let updated = save_account(&conn, &input, now(), &jakarta()).unwrap();

        assert_eq!(
            (updated.id.as_str(), updated.name.as_str(), updated.kind.as_str(), updated.balance),
            (gopay.as_str(), "GoPay", "ewallet", -50_000)
        );
        let names: Vec<String> = list_accounts(&conn, now(), &jakarta()).unwrap().into_iter().map(|a| a.name).collect();
        assert_eq!(names, ["BCA", "GoPay"]);
    }

    #[test]
    fn unknown_account_is_not_found() {
        let conn = open_in_memory();
        let input = AccountInput { id: Some("nope".into()), name: "X".into(), kind: "bank".into(), ..Default::default() };
        assert!(matches!(save_account(&conn, &input, now(), &jakarta()), Err(AppError::NotFound)));
        assert!(matches!(delete_account(&conn, "nope", now(), &jakarta()), Err(AppError::NotFound)));
    }

    #[test]
    fn unused_account_can_be_deleted_once() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        delete_account(&conn, &bca, now(), &jakarta()).unwrap();
        assert!(list_accounts(&conn, now(), &jakarta()).unwrap().is_empty());
        assert!(matches!(delete_account(&conn, &bca, now(), &jakarta()), Err(AppError::NotFound)));
    }
}
```

- [ ] **Step 4: Jalankan test, pastikan gagal**

Run: `cd src-tauri && cargo test finance:: ; cd ..`
Expected: FAIL saat compile, dengan `cannot find struct, variant or union type 'AccountInput'` dan `cannot find function 'save_account'`.

- [ ] **Step 5: Implementasi**

Tambahkan kode ini di atas modul `testing` di `src-tauri/src/finance.rs`:

```rust
//! Accounts, transactions and transfers (spec Fase 2). Amounts are integer
//! rupiah; a negative amount is money leaving the account.
use jiff::tz::TimeZone;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::items;
use crate::time::day_bounds;

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

/// `id: None` creates an account; otherwise that account is updated.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: String,
    pub opening_balance: i64,
}

pub fn invalid(message: &str) -> AppError {
    AppError::Invalid(message.to_string())
}

/// Balances count transactions dated before this: the start of tomorrow (spec K4).
pub fn balance_cutoff(now: i64, tz: &TimeZone) -> Result<i64, AppError> {
    Ok(day_bounds(now, tz)?.1)
}

// ---------- accounts ----------

// ?1 = balance cutoff
const ACCOUNT_SELECT: &str = "
    SELECT i.id, i.title, a.kind, a.currency, a.opening_balance,
           a.opening_balance + COALESCE((
               SELECT SUM(t.amount) FROM transactions t JOIN items ti ON ti.id = t.item_id
               WHERE t.account_id = i.id AND ti.deleted_at IS NULL AND t.occurred_at < ?1), 0)
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

pub fn list_accounts(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Vec<AccountView>, AppError> {
    let mut stmt = conn.prepare(&format!("{ACCOUNT_SELECT} ORDER BY i.title COLLATE NOCASE, i.id"))?;
    let rows = stmt.query_map([balance_cutoff(now, tz)?], account_from_row)?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get_account(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<AccountView, AppError> {
    conn.query_row(&format!("{ACCOUNT_SELECT} AND i.id = ?2"), params![balance_cutoff(now, tz)?, id], account_from_row)
        .optional()?
        .ok_or(AppError::NotFound)
}

pub fn save_account(conn: &Connection, input: &AccountInput, now: i64, tz: &TimeZone) -> Result<AccountView, AppError> {
    let name = account_name(&input.name)?;
    if !ACCOUNT_KINDS.contains(&input.kind.as_str()) {
        return Err(invalid("Jenis akun tidak dikenal"));
    }
    let tx = conn.unchecked_transaction()?;
    let id = match &input.id {
        None => {
            let id = items::insert(&tx, "account", &name, "", now)?;
            tx.execute(
                "INSERT INTO accounts (item_id, kind, opening_balance) VALUES (?1, ?2, ?3)",
                params![id, input.kind, input.opening_balance],
            )?;
            id
        }
        Some(id) => {
            get_account(&tx, id, now, tz)?;
            tx.execute("UPDATE items SET title = ?2, updated_at = ?3 WHERE id = ?1", params![id, name, now])?;
            tx.execute(
                "UPDATE accounts SET kind = ?2, opening_balance = ?3 WHERE item_id = ?1",
                params![id, input.kind, input.opening_balance],
            )?;
            id.clone()
        }
    };
    tx.commit()?;
    get_account(conn, &id, now, tz)
}

/// Refused with `AccountInUse` while a live transaction or an unfinished bill uses it (spec K8).
pub fn delete_account(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<(), AppError> {
    get_account(conn, id, now, tz)?;
    let in_use: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM transactions t JOIN items i ON i.id = t.item_id
                        WHERE t.account_id = ?1 AND i.deleted_at IS NULL)
             OR EXISTS (SELECT 1 FROM bills b JOIN items i ON i.id = b.item_id
                        WHERE b.account_id = ?1 AND i.deleted_at IS NULL AND i.completed_at IS NULL)",
        [id],
        |r| r.get(0),
    )?;
    if in_use {
        return Err(AppError::AccountInUse);
    }
    items::soft_delete(conn, id, now)?;
    Ok(())
}
```

- [ ] **Step 6: Jalankan test**

Run: `cd src-tauri && cargo test ; cd ..`
Expected: `0 failed`, dan `finance::` berisi 5 test. Fungsi akun belum dipanggil dari command, jadi `cargo clippy` akan memperingatkan dead code sampai Task 4 selesai. Jangan tambahkan `allow`.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/error.rs src-tauri/src/items.rs src-tauri/src/finance.rs src-tauri/src/lib.rs
git commit -m "feat: add accounts with balances up to today

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Command akun dan penutup PR F2-1

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (`generate_handler!`)

**Interfaces:**
- Produces: command `list_accounts()`, `save_account(input)`, `delete_account(id)`.

- [ ] **Step 1: Tambah command di `src-tauri/src/commands.rs`**

Tambahkan import:

```rust
use jiff::tz::TimeZone;

use crate::finance::{self, AccountInput, AccountView};
```

Ganti `&jiff::tz::TimeZone::system()` di `get_dashboard` menjadi `&TimeZone::system()`, lalu tambahkan tepat setelah `get_dashboard`:

```rust
#[tauri::command]
pub fn list_accounts(db: State<'_, Db>) -> Result<Vec<AccountView>, AppError> {
    finance::list_accounts(&*db.conn()?, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn save_account(db: State<'_, Db>, input: AccountInput) -> Result<AccountView, AppError> {
    finance::save_account(&*db.conn()?, &input, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn delete_account(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    finance::delete_account(&*db.conn()?, &id, time::now_ms(), &TimeZone::system())
}
```

- [ ] **Step 2: Daftarkan di `src-tauri/src/lib.rs`**

Di `generate_handler!`, tambahkan setelah `commands::get_dashboard,`:

```rust
            commands::list_accounts,
            commands::save_account,
            commands::delete_account,
```

- [ ] **Step 3: Pemeriksaan**

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings; echo "clippy $?"; cd ..`
Expected: `clippy 0`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: expose account commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Penutup PR**

Jalankan "Prosedur penutup PR" dengan branch `feat/<N1>-f2-1-accounts`, base `main`, judul "F2-1: migrasi keuangan dan backend akun", dan `Closes #<N1>`. Screenshot: `1-shell.png` (DB baru dengan `user_version` 4).

---

# PR F2-2: Transaksi, ringkasan, dan batas

### Task 5: Helper bulan lokal

**Files:**
- Modify: `src-tauri/src/time.rs`

**Interfaces:**
- Produces:
  - `month_of(now_ms, &TimeZone) -> Result<String, jiff::Error>`, contohnya `"2026-09"`;
  - `month_bounds("2026-09", &TimeZone) -> Result<(i64, i64), AppError>`: awal (inklusif) dan akhir (eksklusif) bulan lokal. Input yang tidak valid mengembalikan `AppError::Invalid`;
  - `add_months("2026-01", -1) -> Result<String, AppError>`, contohnya `"2025-12"`.

- [ ] **Step 1: Buat branch**

```bash
git switch main && git pull && git switch -c feat/<N2>-f2-2-transactions
```

Kalau F2-1 belum di-merge, buat branch dari `feat/<N1>-f2-1-accounts` (lihat "Base branch").

- [ ] **Step 2: Tulis test yang gagal**

Tambahkan ke modul `tests` di `src-tauri/src/time.rs`:

```rust
    fn jakarta() -> TimeZone {
        TimeZone::fixed(jiff::tz::offset(7))
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
        for bad in ["2026", "2026-13", "abcd-01", "", "2026-9-1", "2026-9"] {
            assert!(matches!(month_bounds(bad, &jakarta()), Err(AppError::Invalid(_))), "{bad}");
        }
    }

    #[test]
    fn month_of_uses_the_local_date() {
        // 30 Sep 20:00 UTC is already 1 Oct in Jakarta.
        assert_eq!(month_of(ms("2026-09-30T20:00:00Z"), &jakarta()).unwrap(), "2026-10");
    }

    #[test]
    fn add_months_crosses_years() {
        assert_eq!(add_months("2026-01", -1).unwrap(), "2025-12");
        assert_eq!(add_months("2026-09", -5).unwrap(), "2026-04");
        assert_eq!(add_months("2026-12", 1).unwrap(), "2027-01");
        assert!(matches!(add_months("x", 1), Err(AppError::Invalid(_))));
    }
```

Run: `cd src-tauri && cargo test time:: ; cd ..`
Expected: FAIL saat compile, dengan `cannot find function 'month_bounds'`.

- [ ] **Step 3: Implementasi**

Ganti baris `use` di atas `src-tauri/src/time.rs` dengan:

```rust
use jiff::{Timestamp, ToSpan, Zoned, civil::Date, tz::TimeZone};

use crate::error::AppError;
```

Tambahkan fungsi ini setelah `day_bounds`:

```rust
/// Local month containing `now_ms`, as `YYYY-MM`.
pub fn month_of(now_ms: i64, tz: &TimeZone) -> Result<String, jiff::Error> {
    Ok(Timestamp::from_millisecond(now_ms)?.to_zoned(tz.clone()).strftime("%Y-%m").to_string())
}

/// First day of a `YYYY-MM` month.
fn first_day(month: &str) -> Result<Date, AppError> {
    let invalid = || AppError::Invalid(format!("Bulan tidak valid: {month}"));
    let (year, mon) = month.split_once('-').ok_or_else(invalid)?;
    if year.len() != 4 || mon.len() != 2 {
        return Err(invalid());
    }
    let year: i16 = year.parse().map_err(|_| invalid())?;
    let mon: i8 = mon.parse().map_err(|_| invalid())?;
    Date::new(year, mon, 1).map_err(|_| invalid())
}

/// Start (inclusive) and end (exclusive) of a local month given as `YYYY-MM`.
pub fn month_bounds(month: &str, tz: &TimeZone) -> Result<(i64, i64), AppError> {
    let first = first_day(month)?;
    let start = first.to_zoned(tz.clone())?;
    let end = first.checked_add(1.month())?.to_zoned(tz.clone())?;
    Ok((start.timestamp().as_millisecond(), end.timestamp().as_millisecond()))
}

/// `month` moved by `n` months, e.g. `add_months("2026-01", -1)` is `2025-12`.
pub fn add_months(month: &str, n: i32) -> Result<String, AppError> {
    Ok(first_day(month)?.checked_add(n.months())?.strftime("%Y-%m").to_string())
}
```

- [ ] **Step 4: Jalankan test**

Run: `cd src-tauri && cargo test time:: ; cd ..`
Expected: `5 passed`. Helper ini baru dipakai di Task 6 dan 7, jadi `cargo clippy` memperingatkan dead code sampai saat itu. Jangan tambahkan `allow`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/time.rs
git commit -m "feat: add local month helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Transaksi, transfer, dan kategori

**Files:**
- Modify: `src-tauri/src/finance.rs`

**Interfaces:**
- Consumes: `month_bounds` (Task 5), `items::insert`, `items::soft_delete`, `balance_cutoff`, `get_account` (Task 3).
- Produces (semua JSON camelCase):
  - `TransactionView { id, title, body, amount, category, account_id, account_name, occurred_at, created_at, transfer_id, counter_account_id, counter_account_name, bill_id, scheduled }`
  - `enum TransactionKind { Expense, Income }` (JSON `"expense"`, `"income"`) dan `enum Flow { All, In, Out }` (JSON `"all"`, `"in"`, `"out"`). Nilai lain ditolak saat deserialisasi.
  - `TransactionInput { id, kind: TransactionKind, amount (> 0), account_id, occurred_at, category, title, body }`
  - `TransferInput { transfer_id, from_account_id, to_account_id, amount (> 0), occurred_at, title }`
  - `TransactionQuery { until: "YYYY-MM", flow: Flow, offset }` dan `TransactionPage { items, more }`
  - `Categories { expense, income }`
  - `NewTransaction<'a>` dan `insert_transaction(conn, &NewTransaction, now) -> Result<String, AppError>`, yang juga dipakai `bills::pay_bill`
  - `get_transaction(conn, id, now, tz)`, `list_transactions(conn, &query, now, tz)`, `save_transaction(conn, &input, now, tz)`, `save_transfer(conn, &input, now, tz)`, `delete_transaction(conn, id, now, tz)`, `categories(conn)`
  - `require_live_account(conn, id)` dan `positive(amount)`, keduanya mengembalikan `AppError::Invalid`
  - `EXPENSE_CATEGORIES`, `INCOME_CATEGORIES`, `PAGE_SIZE = 50`
  - Helper test baru di `finance::testing`: `spend`, `earn`, `transfer`

- [ ] **Step 1: Tambah helper test**

Tambahkan di dalam modul `testing`, setelah `account`:

```rust
    fn entry(kind: TransactionKind, account_id: &str, amount: i64, category: &str, day: &str) -> TransactionInput {
        TransactionInput {
            kind,
            amount,
            account_id: account_id.into(),
            occurred_at: ms(day),
            category: Some(category.into()),
            title: category.into(),
            ..Default::default()
        }
    }

    pub fn spend(conn: &Connection, account_id: &str, amount: i64, category: &str, day: &str) -> TransactionView {
        let input = entry(TransactionKind::Expense, account_id, amount, category, day);
        save_transaction(conn, &input, now(), &jakarta()).unwrap()
    }

    pub fn earn(conn: &Connection, account_id: &str, amount: i64, day: &str) -> TransactionView {
        let input = entry(TransactionKind::Income, account_id, amount, "Gaji", day);
        save_transaction(conn, &input, now(), &jakarta()).unwrap()
    }

    pub fn transfer(conn: &Connection, from: &str, to: &str, amount: i64, day: &str) -> TransactionView {
        let input =
            TransferInput { from_account_id: from.into(), to_account_id: to.into(), amount, occurred_at: ms(day), ..Default::default() };
        save_transfer(conn, &input, now(), &jakarta()).unwrap()
    }
```

- [ ] **Step 2: Tulis test yang gagal**

Tambahkan di modul `tests`, tepat setelah baris `use crate::db::open_in_memory;`:

```rust
    const TODAY: &str = "2026-09-29T00:00:00+07:00";

    fn balance(conn: &Connection, id: &str) -> i64 {
        get_account(conn, id, now(), &jakarta()).unwrap().balance
    }

    fn page(conn: &Connection, until: &str, flow: Flow, offset: i64) -> TransactionPage {
        let query = TransactionQuery { until: until.into(), flow, offset };
        list_transactions(conn, &query, now(), &jakarta()).unwrap()
    }
```

Lalu tambahkan test berikut di akhir modul `tests`:

```rust
    #[test]
    fn balance_counts_live_transactions_up_to_today() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 1_000_000);
        spend(&conn, &bca, 25_000, "Makan & minum", TODAY);
        earn(&conn, &bca, 500_000, "2026-09-28T00:00:00+07:00");
        let gone = spend(&conn, &bca, 5_000, "Belanja", TODAY);
        delete_transaction(&conn, &gone.id, now(), &jakarta()).unwrap();
        let later = spend(&conn, &bca, 70_000, "Belanja", "2026-09-30T00:00:00+07:00");

        assert!(later.scheduled);
        assert_eq!(balance(&conn, &bca), 1_475_000);
    }

    #[test]
    fn account_with_transactions_cannot_be_deleted() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let t = spend(&conn, &bca, 1_000, "Belanja", TODAY);
        assert!(matches!(delete_account(&conn, &bca, now(), &jakarta()), Err(AppError::AccountInUse)));

        delete_transaction(&conn, &t.id, now(), &jakarta()).unwrap();
        delete_account(&conn, &bca, now(), &jakarta()).unwrap();
    }

    #[test]
    fn transaction_input_is_validated() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let base = || TransactionInput { amount: 1_000, account_id: bca.clone(), title: "x".into(), ..Default::default() };
        for bad in [
            TransactionInput { amount: 0, ..base() },
            TransactionInput { amount: -5, ..base() },
            TransactionInput { account_id: "nope".into(), ..base() },
        ] {
            assert!(matches!(save_transaction(&conn, &bad, now(), &jakarta()), Err(AppError::Invalid(_))));
        }
    }

    #[test]
    fn saving_with_an_id_updates_the_transaction() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let t = spend(&conn, &bca, 1_000, "Belanja", TODAY);
        let input = TransactionInput {
            id: Some(t.id.clone()),
            kind: TransactionKind::Income,
            amount: 7_000,
            account_id: bca.clone(),
            occurred_at: t.occurred_at,
            category: Some("  ".into()),
            title: " bonus ".into(),
            body: Some("catatan".into()),
        };

        let updated = save_transaction(&conn, &input, now(), &jakarta()).unwrap();

        assert_eq!(updated.id, t.id);
        assert_eq!(
            (updated.amount, updated.category.clone(), updated.title.as_str(), updated.body.as_str()),
            (7_000, None, "bonus", "catatan")
        );
        assert_eq!(balance(&conn, &bca), 7_000);
    }

    #[test]
    fn transfer_moves_money_between_accounts() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 1_000_000);
        let gopay = account(&conn, "GoPay", 0);

        let out = transfer(&conn, &bca, &gopay, 100_000, TODAY);

        assert_eq!((out.amount, out.title.as_str(), out.category.clone()), (-100_000, "Transfer", None));
        assert_eq!(
            (out.counter_account_id.as_deref(), out.counter_account_name.as_deref()),
            (Some(gopay.as_str()), Some("GoPay"))
        );
        assert_eq!((balance(&conn, &bca), balance(&conn, &gopay)), (900_000, 100_000));
        let listed: Vec<String> = page(&conn, "2026-09", Flow::All, 0).items.into_iter().map(|t| t.id).collect();
        assert_eq!(listed, [out.id.as_str()], "a transfer is listed once, by its outgoing leg");
        assert!(page(&conn, "2026-09", Flow::In, 0).items.is_empty());
        assert!(page(&conn, "2026-09", Flow::Out, 0).items.is_empty());
    }

    #[test]
    fn transfer_edit_and_delete_touch_both_legs() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 1_000_000);
        let gopay = account(&conn, "GoPay", 0);
        let out = transfer(&conn, &bca, &gopay, 100_000, TODAY);
        let edit = TransferInput {
            transfer_id: out.transfer_id.clone(),
            from_account_id: bca.clone(),
            to_account_id: gopay.clone(),
            amount: 40_000,
            occurred_at: out.occurred_at,
            title: Some("isi saldo".into()),
        };

        let edited = save_transfer(&conn, &edit, now(), &jakarta()).unwrap();

        assert_eq!((edited.id.as_str(), edited.title.as_str()), (out.id.as_str(), "isi saldo"));
        assert_eq!((balance(&conn, &bca), balance(&conn, &gopay)), (960_000, 40_000));
        let plain_edit = TransactionInput { id: Some(out.id.clone()), amount: 1, account_id: bca.clone(), ..Default::default() };
        assert!(matches!(save_transaction(&conn, &plain_edit, now(), &jakarta()), Err(AppError::Invalid(_))));

        delete_transaction(&conn, &out.id, now(), &jakarta()).unwrap();
        assert_eq!((balance(&conn, &bca), balance(&conn, &gopay)), (1_000_000, 0));
    }

    #[test]
    fn transfer_input_is_validated() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let same = TransferInput { from_account_id: bca.clone(), to_account_id: bca.clone(), amount: 1, ..Default::default() };
        assert!(matches!(save_transfer(&conn, &same, now(), &jakarta()), Err(AppError::Invalid(_))));
        let ghost = TransferInput { from_account_id: bca.clone(), to_account_id: "nope".into(), amount: 1, ..Default::default() };
        assert!(matches!(save_transfer(&conn, &ghost, now(), &jakarta()), Err(AppError::Invalid(_))));
    }

    #[test]
    fn list_filters_by_flow_up_to_the_end_of_the_month() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        spend(&conn, &bca, 7_000, "Belanja", "2026-08-31T00:00:00+07:00");
        earn(&conn, &bca, 500_000, "2026-09-28T00:00:00+07:00");
        spend(&conn, &bca, 25_000, "Makan & minum", TODAY);
        spend(&conn, &bca, 99_000, "Belanja", "2026-10-01T00:00:00+07:00");

        let amounts = |flow: Flow| page(&conn, "2026-09", flow, 0).items.iter().map(|t| t.amount).collect::<Vec<_>>();

        assert_eq!(amounts(Flow::All), [-25_000, 500_000, -7_000]);
        assert_eq!(amounts(Flow::In), [500_000]);
        assert_eq!(amounts(Flow::Out), [-25_000, -7_000]);
        let bad_month = TransactionQuery { until: "2026-13".into(), flow: Flow::All, offset: 0 };
        assert!(matches!(list_transactions(&conn, &bad_month, now(), &jakarta()), Err(AppError::Invalid(_))));
    }

    #[test]
    fn wire_names_match_the_frontend() {
        let input: TransactionInput =
            serde_json::from_str(r#"{"kind":"income","amount":1,"accountId":"a","occurredAt":0,"title":""}"#).unwrap();
        assert_eq!(input.kind, TransactionKind::Income);
        let query: TransactionQuery = serde_json::from_str(r#"{"until":"2026-09","flow":"out","offset":0}"#).unwrap();
        assert_eq!(query.flow, Flow::Out);
        assert!(serde_json::from_str::<TransactionQuery>(r#"{"until":"2026-09","flow":"x","offset":0}"#).is_err());
    }

    #[test]
    fn list_pages_by_fifty() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        for _ in 0..51 {
            spend(&conn, &bca, 1_000, "Belanja", TODAY);
        }

        let first = page(&conn, "2026-09", Flow::All, 0);
        let rest = page(&conn, "2026-09", Flow::All, 50);

        assert_eq!((first.items.len(), first.more), (50, true));
        assert_eq!((rest.items.len(), rest.more), (1, false));
        assert!(!first.items.iter().any(|t| t.id == rest.items[0].id));
    }

    #[test]
    fn categories_merge_defaults_with_used_ones() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        spend(&conn, &bca, 1_000, "Kopi", TODAY);
        spend(&conn, &bca, 1_000, "Belanja", TODAY);

        let c = categories(&conn).unwrap();

        assert_eq!(c.expense.len(), EXPENSE_CATEGORIES.len() + 1);
        assert_eq!(c.expense.last().map(String::as_str), Some("Kopi"));
        assert_eq!(c.income, INCOME_CATEGORIES.map(String::from).to_vec());
    }
```

Run: `cd src-tauri && cargo test finance:: ; cd ..`
Expected: FAIL saat compile, dengan `cannot find struct, variant or union type 'TransactionInput'` dan `cannot find function 'save_transfer'`.

- [ ] **Step 3: Implementasi**

Ganti baris `use crate::time::day_bounds;` di atas file menjadi:

```rust
use crate::time::{day_bounds, month_bounds};
```

Tambahkan kode ini setelah `delete_account` (sebelum modul `testing`):

```rust
// ---------- transactions ----------

pub const EXPENSE_CATEGORIES: [&str; 8] =
    ["Makan & minum", "Transportasi", "Belanja", "Tagihan", "Kesehatan", "Hiburan", "Pendidikan", "Lainnya"];
pub const INCOME_CATEGORIES: [&str; 4] = ["Gaji", "Bonus", "Hadiah", "Lainnya"];
/// Rows per page of `list_transactions`.
pub const PAGE_SIZE: i64 = 50;

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
    pub bill_id: Option<String>,
    /// Dated after today, so not in the balance yet (spec K4).
    pub scheduled: bool,
}

/// Sets the sign of a plain transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransactionKind {
    #[default]
    Expense,
    Income,
}

/// Filter of "Transaksi terbaru".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Flow {
    All,
    In,
    Out,
}

/// `amount` is always positive; `kind` sets the sign.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionInput {
    pub id: Option<String>,
    pub kind: TransactionKind,
    pub amount: i64,
    pub account_id: String,
    pub occurred_at: i64,
    pub category: Option<String>,
    pub title: String,
    pub body: Option<String>,
}

/// `transfer_id: None` creates a transfer; otherwise both legs are updated.
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

/// One page of "Transaksi terbaru".
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionQuery {
    /// `YYYY-MM`: transactions dated before the end of this local month.
    pub until: String,
    pub flow: Flow,
    pub offset: i64,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct TransactionPage {
    pub items: Vec<TransactionView>,
    pub more: bool,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct Categories {
    pub expense: Vec<String>,
    pub income: Vec<String>,
}

/// One `transactions` row with its `items` row, for `insert_transaction`.
pub struct NewTransaction<'a> {
    pub title: &'a str,
    pub body: &'a str,
    pub account_id: &'a str,
    pub amount: i64,
    pub category: Option<&'a str>,
    pub occurred_at: i64,
    pub transfer_id: Option<&'a str>,
    pub bill_id: Option<&'a str>,
}

// ?1 = balance cutoff. Both legs of a transfer are written and deleted
// together, so the other leg (t2) of a live transfer is live too.
const TRANSACTION_SELECT: &str = "
    SELECT i.id, i.title, i.body, t.amount, t.category, t.account_id, ai.title,
           t.occurred_at, i.created_at, t.transfer_id, t2.account_id, ci.title, t.bill_id,
           t.occurred_at >= ?1
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
        bill_id: r.get(12)?,
        scheduled: r.get(13)?,
    })
}

pub fn get_transaction(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<TransactionView, AppError> {
    conn.query_row(
        &format!("{TRANSACTION_SELECT} AND i.id = ?2"),
        params![balance_cutoff(now, tz)?, id],
        transaction_from_row,
    )
    .optional()?
    .ok_or(AppError::NotFound)
}

/// Newest first, up to the end of `query.until`. A transfer appears once (its
/// outgoing leg) and only under `all`, since it is neither income nor expense.
pub fn list_transactions(
    conn: &Connection,
    query: &TransactionQuery,
    now: i64,
    tz: &TimeZone,
) -> Result<TransactionPage, AppError> {
    let (_, end) = month_bounds(&query.until, tz)?;
    let flow = match query.flow {
        Flow::All => "(t.transfer_id IS NULL OR t.amount < 0)",
        Flow::In => "t.transfer_id IS NULL AND t.amount > 0",
        Flow::Out => "t.transfer_id IS NULL AND t.amount < 0",
    };
    let sql = format!(
        "{TRANSACTION_SELECT} AND t.occurred_at < ?2 AND {flow}
         ORDER BY t.occurred_at DESC, i.created_at DESC, i.id DESC LIMIT ?3 OFFSET ?4"
    );
    let mut stmt = conn.prepare(&sql)?;
    let params = params![balance_cutoff(now, tz)?, end, PAGE_SIZE + 1, query.offset.max(0)];
    let mut items: Vec<TransactionView> = stmt.query_map(params, transaction_from_row)?.collect::<Result<_, _>>()?;
    let more = items.len() as i64 > PAGE_SIZE;
    items.truncate(PAGE_SIZE as usize);
    Ok(TransactionPage { items, more })
}

/// `Invalid` unless `id` is a live account.
pub fn require_live_account(conn: &Connection, id: &str) -> Result<(), AppError> {
    let live: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM accounts a JOIN items i ON i.id = a.item_id WHERE i.id = ?1 AND i.deleted_at IS NULL)",
        [id],
        |r| r.get(0),
    )?;
    if live { Ok(()) } else { Err(invalid("Akun tidak ditemukan")) }
}

pub fn positive(amount: i64) -> Result<(), AppError> {
    if amount > 0 { Ok(()) } else { Err(invalid("Jumlah harus lebih dari 0")) }
}

fn clean_category(category: Option<&str>) -> Option<String> {
    category.map(str::trim).filter(|c| !c.is_empty()).map(str::to_string)
}

/// Inserts the `items` and `transactions` rows; returns the new id.
pub fn insert_transaction(conn: &Connection, t: &NewTransaction, now: i64) -> Result<String, AppError> {
    let id = items::insert(conn, "transaction", t.title, t.body, now)?;
    conn.execute(
        "INSERT INTO transactions (item_id, account_id, amount, category, occurred_at, transfer_id, bill_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, t.account_id, t.amount, t.category, t.occurred_at, t.transfer_id, t.bill_id],
    )?;
    Ok(id)
}

pub fn save_transaction(
    conn: &Connection,
    input: &TransactionInput,
    now: i64,
    tz: &TimeZone,
) -> Result<TransactionView, AppError> {
    positive(input.amount)?;
    let amount = match input.kind {
        TransactionKind::Expense => -input.amount,
        TransactionKind::Income => input.amount,
    };
    require_live_account(conn, &input.account_id)?;
    let title = input.title.trim();
    let body = input.body.as_deref().unwrap_or("");
    let category = clean_category(input.category.as_deref());

    let tx = conn.unchecked_transaction()?;
    let id = match &input.id {
        None => {
            let row = NewTransaction {
                title,
                body,
                account_id: &input.account_id,
                amount,
                category: category.as_deref(),
                occurred_at: input.occurred_at,
                transfer_id: None,
                bill_id: None,
            };
            insert_transaction(&tx, &row, now)?
        }
        Some(id) => {
            if get_transaction(&tx, id, now, tz)?.transfer_id.is_some() {
                return Err(invalid("Transfer diubah lewat formulir transfer"));
            }
            tx.execute("UPDATE items SET title = ?2, body = ?3, updated_at = ?4 WHERE id = ?1", params![id, title, body, now])?;
            tx.execute(
                "UPDATE transactions SET account_id = ?2, amount = ?3, category = ?4, occurred_at = ?5 WHERE item_id = ?1",
                params![id, input.account_id, amount, category, input.occurred_at],
            )?;
            id.clone()
        }
    };
    tx.commit()?;
    get_transaction(conn, &id, now, tz)
}

/// Creates or updates both legs of a transfer; returns the outgoing leg.
pub fn save_transfer(conn: &Connection, input: &TransferInput, now: i64, tz: &TimeZone) -> Result<TransactionView, AppError> {
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
            let out = NewTransaction {
                title,
                body: "",
                account_id: &input.from_account_id,
                amount: -input.amount,
                category: None,
                occurred_at: input.occurred_at,
                transfer_id: Some(&transfer_id),
                bill_id: None,
            };
            let out_id = insert_transaction(&tx, &out, now)?;
            insert_transaction(&tx, &NewTransaction { account_id: &input.to_account_id, amount: input.amount, ..out }, now)?;
            out_id
        }
        Some(transfer_id) => {
            let (out_leg, in_leg) = transfer_legs(&tx, transfer_id)?.ok_or(AppError::NotFound)?;
            for (id, account, amount) in
                [(&out_leg, &input.from_account_id, -input.amount), (&in_leg, &input.to_account_id, input.amount)]
            {
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
    get_transaction(conn, &out_id, now, tz)
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

/// Deleting either leg of a transfer deletes both.
pub fn delete_transaction(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<(), AppError> {
    let existing = get_transaction(conn, id, now, tz)?;
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

/// Built-in categories first, then any other category already used (spec K6).
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
```

- [ ] **Step 4: Jalankan test**

Run: `cd src-tauri && cargo test finance:: ; cd ..`
Expected: `16 passed`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/finance.rs
git commit -m "feat: add transactions, transfers and categories

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Kartu bulanan, grafik, dan batas pengeluaran

**Files:**
- Create: `src-tauri/src/overview.rs`
- Modify: `src-tauri/src/lib.rs` (tambah `mod overview;` setelah `mod items;`)

**Interfaces:**
- Consumes: `month_of`, `month_bounds`, `add_months` (Task 5), `finance::list_accounts`, `finance::invalid`, `items::insert`, `items::soft_delete`.
- Produces (JSON camelCase):
  - `MonthFlow { month, income, expense }`
  - `enum BudgetLevel { Ok, Warn, Over }` (JSON `"ok"`, `"warn"`, `"over"`) dan `BudgetView { amount, level: BudgetLevel }`
  - `FinanceOverview { month, current_month, balance, account_count, income, expense, net, budget: Option<BudgetView>, chart: Vec<MonthFlow> }` (selalu 6 bulan)
  - `month_flow(conn, month, tz)`, `budget_level(expense, limit)`, `budget_amount(conn)`, `budget_view(conn, expense)`, `overview(conn, month: Option<&str>, now, tz)`, `set_budget(conn, amount: Option<i64>, now)`

- [ ] **Step 1: Tulis `src-tauri/src/overview.rs` berisi test saja**

Tambahkan juga `mod overview;` setelah `mod items;` di `src-tauri/src/lib.rs`.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::finance::testing::*;

    const TODAY: &str = "2026-09-29T00:00:00+07:00";

    #[test]
    fn month_flow_uses_local_bounds_and_skips_transfers() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let gopay = account(&conn, "GoPay", 0);
        spend(&conn, &bca, 20_000, "Makan & minum", "2026-09-01T00:00:00+07:00");
        spend(&conn, &bca, 30_000, "Makan & minum", "2026-09-30T00:00:00+07:00");
        spend(&conn, &bca, 99_000, "Belanja", "2026-10-01T00:00:00+07:00"); // 30 Sep 17:00 UTC
        spend(&conn, &bca, 7_000, "Belanja", "2026-08-31T00:00:00+07:00");
        earn(&conn, &bca, 8_000_000, "2026-09-25T00:00:00+07:00");
        transfer(&conn, &bca, &gopay, 100_000, "2026-09-10T00:00:00+07:00");

        let flow = month_flow(&conn, "2026-09", &jakarta()).unwrap();

        assert_eq!(flow, MonthFlow { month: "2026-09".into(), income: 8_000_000, expense: 50_000 });
    }

    #[test]
    fn overview_fills_the_cards_and_a_six_month_chart() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 1_000_000);
        spend(&conn, &bca, 25_000, "Makan & minum", TODAY);
        earn(&conn, &bca, 1_500_000, "2026-04-25T00:00:00+07:00");

        let o = overview(&conn, None, now(), &jakarta()).unwrap();

        assert_eq!((o.month.as_str(), o.current_month.as_str()), ("2026-09", "2026-09"));
        assert_eq!((o.balance, o.account_count, o.income, o.expense, o.net), (2_475_000, 1, 0, 25_000, -25_000));
        let months: Vec<&str> = o.chart.iter().map(|m| m.month.as_str()).collect();
        assert_eq!(months, ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
        assert_eq!((o.chart[0].income, o.chart[5].expense), (1_500_000, 25_000));
        assert_eq!(o.budget, None);
    }

    #[test]
    fn chart_ends_at_an_older_chosen_month() {
        let conn = open_in_memory();
        let inside = overview(&conn, Some("2026-05"), now(), &jakarta()).unwrap();
        assert_eq!((inside.month.as_str(), inside.chart[5].month.as_str()), ("2026-05", "2026-09"));

        let older = overview(&conn, Some("2026-01"), now(), &jakarta()).unwrap();
        assert_eq!((older.chart[0].month.as_str(), older.chart[5].month.as_str()), ("2025-08", "2026-01"));

        assert!(matches!(overview(&conn, Some("2026-13"), now(), &jakarta()), Err(AppError::Invalid(_))));
    }

    #[test]
    fn budget_level_thresholds() {
        assert_eq!(budget_level(79_000, 100_000), BudgetLevel::Ok);
        assert_eq!(budget_level(80_000, 100_000), BudgetLevel::Warn);
        assert_eq!(budget_level(100_000, 100_000), BudgetLevel::Warn);
        assert_eq!(budget_level(100_001, 100_000), BudgetLevel::Over);
        assert_eq!(serde_json::to_string(&BudgetLevel::Warn).unwrap(), r#""warn""#);
    }

    #[test]
    fn budget_can_be_set_changed_and_removed() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        spend(&conn, &bca, 175_000, "Belanja", TODAY);

        set_budget(&conn, Some(200_000), now()).unwrap();
        let expected = Some(BudgetView { amount: 200_000, level: BudgetLevel::Warn });
        assert_eq!(overview(&conn, None, now(), &jakarta()).unwrap().budget, expected);

        set_budget(&conn, Some(150_000), now()).unwrap();
        assert_eq!(budget_amount(&conn).unwrap(), Some(150_000));
        let live: i64 = conn
            .query_row("SELECT COUNT(*) FROM budgets b JOIN items i ON i.id = b.item_id WHERE i.deleted_at IS NULL", [], |r| r.get(0))
            .unwrap();
        assert_eq!(live, 1);

        set_budget(&conn, None, now()).unwrap();
        assert_eq!(budget_amount(&conn).unwrap(), None);
        assert!(matches!(set_budget(&conn, Some(0), now()), Err(AppError::Invalid(_))));
    }
}
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd src-tauri && cargo test overview:: ; cd ..`
Expected: FAIL saat compile, dengan `cannot find function 'month_flow'`.

- [ ] **Step 3: Implementasi**

Tambahkan kode ini di atas modul test di `src-tauri/src/overview.rs`:

```rust
//! Month cards, the 6-month cash-flow chart and the monthly spending limit (spec Fase 2 §3, K11).
use jiff::tz::TimeZone;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::error::AppError;
use crate::finance::{invalid, list_accounts};
use crate::items;
use crate::time::{add_months, month_bounds, month_of};

/// Bars in the cash-flow chart.
pub const CHART_MONTHS: i32 = 6;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthFlow {
    pub month: String,
    pub income: i64,
    pub expense: i64,
}

/// How much of the monthly limit is spent: under 80%, 80% to 100%, or above.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BudgetLevel {
    Ok,
    Warn,
    Over,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetView {
    pub amount: i64,
    pub level: BudgetLevel,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceOverview {
    pub month: String,
    pub current_month: String,
    pub balance: i64,
    pub account_count: usize,
    pub income: i64,
    pub expense: i64,
    pub net: i64,
    pub budget: Option<BudgetView>,
    pub chart: Vec<MonthFlow>,
}

/// Income and expense of a local month. Transfers count as neither.
pub fn month_flow(conn: &Connection, month: &str, tz: &TimeZone) -> Result<MonthFlow, AppError> {
    let (start, end) = month_bounds(month, tz)?;
    let (income, expense) = conn.query_row(
        "SELECT COALESCE(SUM(CASE WHEN t.amount > 0 THEN t.amount END), 0),
                COALESCE(-SUM(CASE WHEN t.amount < 0 THEN t.amount END), 0)
         FROM transactions t JOIN items i ON i.id = t.item_id
         WHERE i.deleted_at IS NULL AND t.transfer_id IS NULL AND t.occurred_at >= ?1 AND t.occurred_at < ?2",
        params![start, end],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(MonthFlow { month: month.to_string(), income, expense })
}

pub fn budget_level(expense: i64, limit: i64) -> BudgetLevel {
    if expense > limit {
        BudgetLevel::Over
    } else if expense * 5 >= limit * 4 {
        BudgetLevel::Warn
    } else {
        BudgetLevel::Ok
    }
}

const LIVE_TOTAL_BUDGET: &str = "
    FROM budgets b JOIN items i ON i.id = b.item_id
    WHERE i.deleted_at IS NULL AND b.category IS NULL
    ORDER BY i.created_at DESC LIMIT 1";

pub fn budget_amount(conn: &Connection) -> Result<Option<i64>, AppError> {
    Ok(conn.query_row(&format!("SELECT b.amount {LIVE_TOTAL_BUDGET}"), [], |r| r.get(0)).optional()?)
}

pub fn budget_view(conn: &Connection, expense: i64) -> Result<Option<BudgetView>, AppError> {
    Ok(budget_amount(conn)?.map(|amount| BudgetView { amount, level: budget_level(expense, amount) }))
}

/// `month: None` means the current local month. The chart ends at the current
/// month, unless the chosen month is older than its six bars.
pub fn overview(conn: &Connection, month: Option<&str>, now: i64, tz: &TimeZone) -> Result<FinanceOverview, AppError> {
    let current = month_of(now, tz)?;
    let month = month.map_or_else(|| current.clone(), str::to_string);
    let flow = month_flow(conn, &month, tz)?;
    let end = if month < add_months(&current, 1 - CHART_MONTHS)? { month.clone() } else { current.clone() };
    let chart = (1 - CHART_MONTHS..=0)
        .map(|n| month_flow(conn, &add_months(&end, n)?, tz))
        .collect::<Result<Vec<_>, _>>()?;
    let accounts = list_accounts(conn, now, tz)?;
    Ok(FinanceOverview {
        month,
        current_month: current,
        balance: accounts.iter().map(|a| a.balance).sum(),
        account_count: accounts.len(),
        income: flow.income,
        expense: flow.expense,
        net: flow.income - flow.expense,
        budget: budget_view(conn, flow.expense)?,
        chart,
    })
}

/// Sets the one monthly limit, or removes it with `None` (spec K11).
pub fn set_budget(conn: &Connection, amount: Option<i64>, now: i64) -> Result<(), AppError> {
    if amount.is_some_and(|a| a <= 0) {
        return Err(invalid("Batas harus lebih dari 0"));
    }
    let tx = conn.unchecked_transaction()?;
    let existing: Option<String> =
        tx.query_row(&format!("SELECT b.item_id {LIVE_TOTAL_BUDGET}"), [], |r| r.get(0)).optional()?;
    match (existing, amount) {
        (Some(id), Some(amount)) => {
            tx.execute("UPDATE budgets SET amount = ?2 WHERE item_id = ?1", params![id, amount])?;
            tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![id, now])?;
        }
        (Some(id), None) => {
            items::soft_delete(&tx, &id, now)?;
        }
        (None, Some(amount)) => {
            let id = items::insert(&tx, "budget", "", "", now)?;
            tx.execute("INSERT INTO budgets (item_id, amount) VALUES (?1, ?2)", params![id, amount])?;
        }
        (None, None) => {}
    }
    tx.commit()?;
    Ok(())
}
```

- [ ] **Step 4: Jalankan test**

Run: `cd src-tauri && cargo test overview:: ; cd ..`
Expected: `5 passed`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/overview.rs src-tauri/src/lib.rs
git commit -m "feat: add monthly totals, cash-flow chart and spending limit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Command transaksi dan ringkasan, penutup PR F2-2

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: command `list_transactions(query)`, `save_transaction(input)`, `save_transfer(input)`, `delete_transaction(id)`, `finance_categories()`, `finance_overview(month)`, `set_budget(amount)`.

- [ ] **Step 1: Tambah command**

Ganti import `finance` di `src-tauri/src/commands.rs` menjadi:

```rust
use crate::finance::{
    self, AccountInput, AccountView, Categories, TransactionInput, TransactionPage, TransactionQuery, TransactionView,
    TransferInput,
};
use crate::overview::{self, FinanceOverview};
```

Tambahkan setelah `delete_account`:

```rust
#[tauri::command]
pub fn list_transactions(db: State<'_, Db>, query: TransactionQuery) -> Result<TransactionPage, AppError> {
    finance::list_transactions(&*db.conn()?, &query, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn save_transaction(db: State<'_, Db>, input: TransactionInput) -> Result<TransactionView, AppError> {
    finance::save_transaction(&*db.conn()?, &input, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn save_transfer(db: State<'_, Db>, input: TransferInput) -> Result<TransactionView, AppError> {
    finance::save_transfer(&*db.conn()?, &input, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn delete_transaction(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    finance::delete_transaction(&*db.conn()?, &id, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn finance_categories(db: State<'_, Db>) -> Result<Categories, AppError> {
    finance::categories(&*db.conn()?)
}

/// `month: None` is the current local month.
#[tauri::command]
pub fn finance_overview(db: State<'_, Db>, month: Option<String>) -> Result<FinanceOverview, AppError> {
    overview::overview(&*db.conn()?, month.as_deref(), time::now_ms(), &TimeZone::system())
}

/// `amount: None` removes the monthly limit.
#[tauri::command]
pub fn set_budget(db: State<'_, Db>, amount: Option<i64>) -> Result<(), AppError> {
    overview::set_budget(&*db.conn()?, amount, time::now_ms())
}
```

- [ ] **Step 2: Daftarkan di `src-tauri/src/lib.rs`**

Di `generate_handler!`, setelah `commands::delete_account,`:

```rust
            commands::list_transactions,
            commands::save_transaction,
            commands::save_transfer,
            commands::delete_transaction,
            commands::finance_categories,
            commands::finance_overview,
            commands::set_budget,
```

- [ ] **Step 3: Pemeriksaan**

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings; echo "clippy $?"; cargo test; cd ..`
Expected: `clippy 0` dan `0 failed`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: expose transaction, overview and budget commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Penutup PR**

Jalankan "Prosedur penutup PR" dengan branch `feat/<N2>-f2-2-transactions`, judul "F2-2: transaksi, transfer, ringkasan, dan batas", dan `Closes #<N2>`. Belum ada UI baru, jadi cukup E2E `PASS`.

---

# PR F2-3: Backend tagihan

### Task 9: Tagihan

**Files:**
- Modify: `src-tauri/src/time.rs` (`local_date`, `next_month_due`)
- Create: `src-tauri/src/bills.rs`
- Modify: `src-tauri/src/lib.rs` (tambah `mod bills;` setelah `mod backup;`)

**Interfaces:**
- Consumes: `finance::insert_transaction`, `NewTransaction`, `get_transaction`, `require_live_account`, `positive`, `invalid` (Task 6), `day_bounds`.
- Produces:
  - `time::local_date(ms, tz) -> Result<Date, jiff::Error>` dan `time::next_month_due(due_at, due_day: i8, tz) -> Result<i64, jiff::Error>`
  - `enum BillStatus { Overdue, DueToday, Upcoming, PaidToday }` (JSON `"overdue"`, `"dueToday"`, `"upcoming"`, `"paidToday"`)
  - `enum Repeat { Once, Monthly }` (JSON dan kolom SQL `"once"`, `"monthly"`; default `Monthly`), dengan `ToSql`/`FromSql`
  - `BillView { id, name, amount, account_id, account_name, repeat: Repeat, due_at, status: BillStatus, days_late }` (JSON camelCase)
  - `BillInput { id, name, amount, account_id, repeat: Repeat, due_at }`
  - `list_bills(conn, now, tz)`, `get_bill(conn, id, now, tz)`, `save_bill(conn, &input, now, tz)`, `pay_bill(conn, id, now, tz) -> TransactionView`, `delete_bill(conn, id, now, tz)`

- [ ] **Step 1: Buat branch**

```bash
git switch main && git pull && git switch -c feat/<N3>-f2-3-bills
```

Kalau F2-2 belum di-merge, buat branch dari `feat/<N2>-f2-2-transactions`.

- [ ] **Step 2: Tulis test tanggal yang gagal**

Tambahkan di modul `tests` di `src-tauri/src/time.rs`:

```rust
    #[test]
    fn monthly_due_keeps_its_day() {
        let tz = jakarta();
        let feb = next_month_due(ms("2026-01-31T00:00:00+07:00"), 31, &tz).unwrap();
        assert_eq!(feb, ms("2026-02-28T00:00:00+07:00"));
        assert_eq!(next_month_due(feb, 31, &tz).unwrap(), ms("2026-03-31T00:00:00+07:00"));
        assert_eq!(next_month_due(ms("2028-01-31T00:00:00+07:00"), 31, &tz).unwrap(), ms("2028-02-29T00:00:00+07:00"));
        assert_eq!(next_month_due(ms("2026-12-15T00:00:00+07:00"), 15, &tz).unwrap(), ms("2027-01-15T00:00:00+07:00"));
    }
```

Run: `cd src-tauri && cargo test time:: ; cd ..`
Expected: FAIL saat compile, dengan `cannot find function 'next_month_due'`.

- [ ] **Step 3: Implementasi tanggal**

Tambahkan di `src-tauri/src/time.rs` setelah `add_months`:

```rust
/// Local calendar date of `ms`.
pub fn local_date(ms: i64, tz: &TimeZone) -> Result<Date, jiff::Error> {
    Ok(Timestamp::from_millisecond(ms)?.to_zoned(tz.clone()).date())
}

/// Next monthly due date after `due_at`: day `due_day` of the following month,
/// capped at that month's last day (31 Jan, 28 Feb, 31 Mar).
pub fn next_month_due(due_at: i64, due_day: i8, tz: &TimeZone) -> Result<i64, jiff::Error> {
    let first = local_date(due_at, tz)?.first_of_month().checked_add(1.month())?;
    let day = due_day.clamp(1, first.days_in_month());
    Ok(Date::new(first.year(), first.month(), day)?.to_zoned(tz.clone())?.timestamp().as_millisecond())
}
```

Run: `cd src-tauri && cargo test time:: ; cd ..`
Expected: `6 passed`.

- [ ] **Step 4: Tulis `src-tauri/src/bills.rs` berisi test saja**

Tambahkan juga `mod bills;` setelah `mod backup;` di `src-tauri/src/lib.rs`.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::finance::testing::*;
    use crate::finance::{delete_account, delete_transaction, get_account};

    const DAY: i64 = 86_400_000;

    fn bill(conn: &Connection, account_id: &str, name: &str, amount: i64, repeat: Repeat, due: &str) -> BillView {
        let input =
            BillInput { name: name.into(), amount, account_id: account_id.into(), repeat, due_at: ms(due), ..Default::default() };
        save_bill(conn, &input, now(), &jakarta()).unwrap()
    }

    #[test]
    fn status_covers_every_case() {
        let (start, end) = (100, 200);
        assert_eq!(status(50, None, false, start, end), Some(BillStatus::Overdue));
        assert_eq!(status(50, None, true, start, end), Some(BillStatus::Overdue));
        assert_eq!(status(300, None, true, start, end), Some(BillStatus::PaidToday));
        assert_eq!(status(150, None, false, start, end), Some(BillStatus::DueToday));
        assert_eq!(status(300, None, false, start, end), Some(BillStatus::Upcoming));
        assert_eq!(status(150, Some(120), true, start, end), Some(BillStatus::PaidToday));
        assert_eq!(status(50, Some(90), false, start, end), None);
    }

    #[test]
    fn paying_a_monthly_bill_records_the_expense_and_moves_the_due_date() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 1_000_000);
        let listrik = bill(&conn, &bca, "Listrik", 150_000, Repeat::Monthly, "2026-09-28T00:00:00+07:00");
        assert_eq!((listrik.status, listrik.days_late), (BillStatus::Overdue, 1));

        let paid = pay_bill(&conn, &listrik.id, now(), &jakarta()).unwrap();

        assert_eq!((paid.amount, paid.category.as_deref(), paid.title.as_str()), (-150_000, Some("Tagihan"), "Listrik"));
        assert_eq!((paid.bill_id.as_deref(), paid.occurred_at), (Some(listrik.id.as_str()), ms("2026-09-29T00:00:00+07:00")));
        let after = get_bill(&conn, &listrik.id, now(), &jakarta()).unwrap();
        assert_eq!((after.due_at, after.status), (ms("2026-10-28T00:00:00+07:00"), BillStatus::PaidToday));
        assert_eq!(get_account(&conn, &bca, now(), &jakarta()).unwrap().balance, 850_000);
        assert!(matches!(pay_bill(&conn, &listrik.id, now(), &jakarta()), Err(AppError::Invalid(_))));
        assert_eq!(get_bill(&conn, &listrik.id, now() + DAY, &jakarta()).unwrap().status, BillStatus::Upcoming);
    }

    #[test]
    fn one_payment_covers_one_period() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let kos = bill(&conn, &bca, "Kos", 1_000_000, Repeat::Monthly, "2026-01-31T00:00:00+07:00");

        pay_bill(&conn, &kos.id, now(), &jakarta()).unwrap();
        let after_one = get_bill(&conn, &kos.id, now(), &jakarta()).unwrap();
        pay_bill(&conn, &kos.id, now(), &jakarta()).unwrap();
        let after_two = get_bill(&conn, &kos.id, now(), &jakarta()).unwrap();

        assert_eq!((after_one.due_at, after_one.status), (ms("2026-02-28T00:00:00+07:00"), BillStatus::Overdue));
        assert_eq!(after_two.due_at, ms("2026-03-31T00:00:00+07:00"));
    }

    #[test]
    fn once_bill_is_done_after_payment() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let servis = bill(&conn, &bca, "Servis motor", 300_000, Repeat::Once, "2026-09-29T00:00:00+07:00");
        assert_eq!(servis.status, BillStatus::DueToday);

        pay_bill(&conn, &servis.id, now(), &jakarta()).unwrap();

        assert_eq!(list_bills(&conn, now(), &jakarta()).unwrap()[0].status, BillStatus::PaidToday);
        assert!(list_bills(&conn, now() + DAY, &jakarta()).unwrap().is_empty());
        assert!(matches!(get_bill(&conn, &servis.id, now() + DAY, &jakarta()), Err(AppError::NotFound)));
    }

    #[test]
    fn bills_are_listed_by_due_date_and_can_be_edited() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let internet = bill(&conn, &bca, "Internet", 250_000, Repeat::Monthly, "2026-10-05T00:00:00+07:00");
        bill(&conn, &bca, "Listrik", 150_000, Repeat::Monthly, "2026-09-28T00:00:00+07:00");
        let names: Vec<String> = list_bills(&conn, now(), &jakarta()).unwrap().into_iter().map(|b| b.name).collect();
        assert_eq!(names, ["Listrik", "Internet"]);

        let input = BillInput {
            id: Some(internet.id.clone()),
            name: " Internet rumah ".into(),
            amount: 300_000,
            account_id: bca.clone(),
            repeat: Repeat::Monthly,
            due_at: ms("2026-10-07T00:00:00+07:00"),
        };
        let edited = save_bill(&conn, &input, now(), &jakarta()).unwrap();

        assert_eq!(
            (edited.name.as_str(), edited.amount, edited.status, edited.account_name.as_str()),
            ("Internet rumah", 300_000, BillStatus::Upcoming, "BCA")
        );
        let due_day: i64 = conn.query_row("SELECT due_day FROM bills WHERE item_id = ?1", [&internet.id], |r| r.get(0)).unwrap();
        assert_eq!(due_day, 7);
        delete_bill(&conn, &internet.id, now(), &jakarta()).unwrap();
        assert_eq!(list_bills(&conn, now(), &jakarta()).unwrap().len(), 1);
    }

    #[test]
    fn bill_input_is_validated() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let base = || BillInput { name: "Listrik".into(), amount: 1_000, account_id: bca.clone(), ..Default::default() };
        for bad in [
            BillInput { name: "  ".into(), ..base() },
            BillInput { amount: 0, ..base() },
            BillInput { account_id: "nope".into(), ..base() },
        ] {
            assert!(matches!(save_bill(&conn, &bad, now(), &jakarta()), Err(AppError::Invalid(_))));
        }
    }

    #[test]
    fn account_with_a_bill_cannot_be_deleted() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let listrik = bill(&conn, &bca, "Listrik", 150_000, Repeat::Monthly, "2026-10-05T00:00:00+07:00");
        assert!(matches!(delete_account(&conn, &bca, now(), &jakarta()), Err(AppError::AccountInUse)));

        delete_bill(&conn, &listrik.id, now(), &jakarta()).unwrap();
        delete_account(&conn, &bca, now(), &jakarta()).unwrap();
    }

    #[test]
    fn deleting_the_payment_keeps_the_new_due_date() {
        let conn = open_in_memory();
        let bca = account(&conn, "BCA", 0);
        let listrik = bill(&conn, &bca, "Listrik", 150_000, Repeat::Monthly, "2026-09-28T00:00:00+07:00");
        let paid = pay_bill(&conn, &listrik.id, now(), &jakarta()).unwrap();

        delete_transaction(&conn, &paid.id, now(), &jakarta()).unwrap();

        let after = get_bill(&conn, &listrik.id, now(), &jakarta()).unwrap();
        assert_eq!((after.due_at, after.status), (ms("2026-10-28T00:00:00+07:00"), BillStatus::Upcoming));
    }

    #[test]
    fn wire_names_match_the_frontend() {
        let input: BillInput =
            serde_json::from_str(r#"{"name":"Air","amount":1,"accountId":"a","repeat":"once","dueAt":0}"#).unwrap();
        assert_eq!(input.repeat, Repeat::Once);
        assert!(serde_json::from_str::<BillInput>(r#"{"name":"Air","amount":1,"accountId":"a","repeat":"weekly","dueAt":0}"#).is_err());
        assert_eq!(serde_json::to_string(&BillStatus::DueToday).unwrap(), r#""dueToday""#);
    }
}
```

- [ ] **Step 5: Jalankan test, pastikan gagal**

Run: `cd src-tauri && cargo test bills:: ; cd ..`
Expected: FAIL saat compile, dengan `cannot find struct, variant or union type 'BillInput'`.

- [ ] **Step 6: Implementasi**

Tambahkan kode ini di atas modul test di `src-tauri/src/bills.rs`:

```rust
//! Bills, once or monthly, paid with one click (spec Fase 2 K10).
use jiff::tz::TimeZone;
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::finance::{self, NewTransaction, TransactionView, invalid};
use crate::items;
use crate::time::{day_bounds, local_date, next_month_due};

/// Category of the expense that "Tandai lunas" records.
pub const BILL_CATEGORY: &str = "Tagihan";

/// A bill's state today. Once bills paid before today are finished and never sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BillStatus {
    Overdue,
    DueToday,
    Upcoming,
    PaidToday,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Repeat {
    Once,
    #[default]
    Monthly,
}

/// Stored as `once` or `monthly`, the same words as in JSON.
impl ToSql for Repeat {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(match self {
            Repeat::Once => "once",
            Repeat::Monthly => "monthly",
        }
        .into())
    }
}

impl FromSql for Repeat {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "once" => Ok(Repeat::Once),
            "monthly" => Ok(Repeat::Monthly),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BillView {
    pub id: String,
    pub name: String,
    pub amount: i64,
    pub account_id: String,
    pub account_name: String,
    pub repeat: Repeat,
    pub due_at: i64,
    pub status: BillStatus,
    /// Local days since `due_at` when overdue, else 0.
    pub days_late: i64,
}

/// `id: None` creates a bill; otherwise that bill is updated.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillInput {
    pub id: Option<String>,
    pub name: String,
    pub amount: i64,
    pub account_id: String,
    pub repeat: Repeat,
    pub due_at: i64,
}

/// A bill row before its status is worked out.
struct Raw {
    view: BillView,
    completed_at: Option<i64>,
    paid_today: bool,
}

// ?1, ?2 = start and end of today
const BILL_SELECT: &str = "
    SELECT i.id, i.title, b.amount, b.account_id, ai.title, b.repeat, i.due_at, i.completed_at,
           EXISTS (SELECT 1 FROM transactions t JOIN items ti ON ti.id = t.item_id
                   WHERE t.bill_id = i.id AND ti.deleted_at IS NULL AND ti.created_at >= ?1 AND ti.created_at < ?2)
    FROM bills b
    JOIN items i ON i.id = b.item_id
    JOIN items ai ON ai.id = b.account_id
    WHERE i.deleted_at IS NULL";

fn raw_from_row(r: &Row) -> rusqlite::Result<Raw> {
    Ok(Raw {
        view: BillView {
            id: r.get(0)?,
            name: r.get(1)?,
            amount: r.get(2)?,
            account_id: r.get(3)?,
            account_name: r.get(4)?,
            repeat: r.get(5)?,
            due_at: r.get(6)?,
            status: BillStatus::Upcoming,
            days_late: 0,
        },
        completed_at: r.get(7)?,
        paid_today: r.get(8)?,
    })
}

/// Today's status, or None for a once bill paid before today. One payment
/// covers one period, so a bill still due before today stays overdue.
fn status(due_at: i64, completed_at: Option<i64>, paid_today: bool, start: i64, end: i64) -> Option<BillStatus> {
    match completed_at {
        Some(at) if at >= start => Some(BillStatus::PaidToday),
        Some(_) => None,
        None if due_at < start => Some(BillStatus::Overdue),
        None if paid_today => Some(BillStatus::PaidToday),
        None if due_at < end => Some(BillStatus::DueToday),
        None => Some(BillStatus::Upcoming),
    }
}

fn finish(raw: Raw, now: i64, tz: &TimeZone) -> Result<Option<BillView>, AppError> {
    let (start, end) = day_bounds(now, tz)?;
    let Some(status) = status(raw.view.due_at, raw.completed_at, raw.paid_today, start, end) else {
        return Ok(None);
    };
    let days_late = if status == BillStatus::Overdue {
        i64::from(local_date(raw.view.due_at, tz)?.until(local_date(now, tz)?)?.get_days())
    } else {
        0
    };
    Ok(Some(BillView { status, days_late, ..raw.view }))
}

/// Live bills that are not finished, by due date.
pub fn list_bills(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Vec<BillView>, AppError> {
    let (start, end) = day_bounds(now, tz)?;
    let mut stmt = conn.prepare(&format!("{BILL_SELECT} ORDER BY i.due_at, i.title COLLATE NOCASE, i.id"))?;
    let raws = stmt.query_map(params![start, end], raw_from_row)?.collect::<Result<Vec<_>, _>>()?;
    let mut bills = Vec::new();
    for raw in raws {
        if let Some(bill) = finish(raw, now, tz)? {
            bills.push(bill);
        }
    }
    Ok(bills)
}

pub fn get_bill(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<BillView, AppError> {
    let (start, end) = day_bounds(now, tz)?;
    let raw = conn
        .query_row(&format!("{BILL_SELECT} AND i.id = ?3"), params![start, end, id], raw_from_row)
        .optional()?
        .ok_or(AppError::NotFound)?;
    finish(raw, now, tz)?.ok_or(AppError::NotFound)
}

pub fn save_bill(conn: &Connection, input: &BillInput, now: i64, tz: &TimeZone) -> Result<BillView, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(invalid("Nama tagihan tidak boleh kosong"));
    }
    finance::positive(input.amount)?;
    finance::require_live_account(conn, &input.account_id)?;
    let due_day = local_date(input.due_at, tz)?.day();

    let tx = conn.unchecked_transaction()?;
    let id = match &input.id {
        None => {
            let id = items::insert(&tx, "bill", name, "", now)?;
            tx.execute("UPDATE items SET due_at = ?2 WHERE id = ?1", params![id, input.due_at])?;
            tx.execute(
                "INSERT INTO bills (item_id, account_id, amount, repeat, due_day) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, input.account_id, input.amount, input.repeat, due_day],
            )?;
            id
        }
        Some(id) => {
            get_bill(&tx, id, now, tz)?;
            tx.execute(
                "UPDATE items SET title = ?2, due_at = ?3, updated_at = ?4 WHERE id = ?1",
                params![id, name, input.due_at, now],
            )?;
            tx.execute(
                "UPDATE bills SET account_id = ?2, amount = ?3, repeat = ?4, due_day = ?5 WHERE item_id = ?1",
                params![id, input.account_id, input.amount, input.repeat, due_day],
            )?;
            id.clone()
        }
    };
    tx.commit()?;
    get_bill(conn, &id, now, tz)
}

/// "Tandai lunas": records the expense today, then moves a monthly bill to its
/// next due date or finishes a once bill, in one SQLite transaction.
// ponytail: deleting the payment does not move the due date back; the bill form
// can. Link them both ways if that turns out to confuse people.
pub fn pay_bill(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<TransactionView, AppError> {
    let bill = get_bill(conn, id, now, tz)?;
    if bill.status == BillStatus::PaidToday {
        return Err(invalid("Tagihan ini sudah dibayar hari ini"));
    }
    finance::require_live_account(conn, &bill.account_id)?;
    let (today, _) = day_bounds(now, tz)?;
    let due_day: i8 = conn.query_row("SELECT due_day FROM bills WHERE item_id = ?1", [id], |r| r.get(0))?;

    let tx = conn.unchecked_transaction()?;
    let expense = NewTransaction {
        title: &bill.name,
        body: "",
        account_id: &bill.account_id,
        amount: -bill.amount,
        category: Some(BILL_CATEGORY),
        occurred_at: today,
        transfer_id: None,
        bill_id: Some(id),
    };
    let paid = finance::insert_transaction(&tx, &expense, now)?;
    if bill.repeat == Repeat::Monthly {
        let next = next_month_due(bill.due_at, due_day, tz)?;
        tx.execute("UPDATE items SET due_at = ?2, updated_at = ?3 WHERE id = ?1", params![id, next, now])?;
    } else {
        tx.execute("UPDATE items SET completed_at = ?2, updated_at = ?2 WHERE id = ?1", params![id, now])?;
    }
    tx.commit()?;
    finance::get_transaction(conn, &paid, now, tz)
}

/// Soft-deletes the bill. Its past payments stay.
pub fn delete_bill(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<(), AppError> {
    get_bill(conn, id, now, tz)?;
    items::soft_delete(conn, id, now)?;
    Ok(())
}
```

- [ ] **Step 7: Jalankan test**

Run: `cd src-tauri && cargo test bills:: ; cd ..`
Expected: `9 passed`.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/time.rs src-tauri/src/bills.rs src-tauri/src/lib.rs
git commit -m "feat: add once and monthly bills with one-click payment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: `finance` di dashboard, command tagihan, penutup PR F2-3

**Files:**
- Modify: `src-tauri/src/dashboard.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `finance::list_accounts`, `overview::month_flow`, `overview::budget_view`, `bills::list_bills`, `month_of`.
- Produces:
  - `Dashboard.finance: FinanceSummary { has_accounts, balance, expense, budget: Option<BudgetView>, due_bills: Vec<BillView> }` (JSON camelCase). `due_bills` berisi tagihan berstatus `overdue` atau `dueToday`.
  - Command `list_bills()`, `save_bill(input)`, `pay_bill(id)`, `delete_bill(id)`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir modul `tests` di `src-tauri/src/dashboard.rs`:

```rust
    #[test]
    fn finance_summary_covers_the_current_month() {
        use crate::bills::{BillInput, BillStatus, save_bill};
        use crate::finance::testing::{account, now, spend};
        use crate::overview::{BudgetLevel, BudgetView, set_budget};

        let conn = open_in_memory();
        assert!(!get(&conn, now(), &jakarta()).unwrap().finance.has_accounts);
        let bca = account(&conn, "BCA", 1_000_000);
        spend(&conn, &bca, 25_000, "Makan & minum", "2026-09-29T00:00:00+07:00");
        spend(&conn, &bca, 10_000, "Belanja", "2026-08-31T00:00:00+07:00");
        set_budget(&conn, Some(30_000), now()).unwrap();
        for (name, due) in [
            ("Listrik", "2026-09-28T00:00:00+07:00"),
            ("Air", "2026-09-29T00:00:00+07:00"),
            ("Internet", "2026-10-05T00:00:00+07:00"),
        ] {
            let input = BillInput { name: name.into(), amount: 1_000, account_id: bca.clone(), due_at: ms(due), ..Default::default() };
            save_bill(&conn, &input, now(), &jakarta()).unwrap();
        }

        let d = get(&conn, now(), &jakarta()).unwrap();

        let f = d.finance;
        assert_eq!((f.has_accounts, f.balance, f.expense), (true, 965_000, 25_000));
        assert_eq!(f.budget, Some(BudgetView { amount: 30_000, level: BudgetLevel::Warn }));
        let due: Vec<(&str, BillStatus)> = f.due_bills.iter().map(|b| (b.name.as_str(), b.status)).collect();
        assert_eq!(due, [("Listrik", BillStatus::Overdue), ("Air", BillStatus::DueToday)]);
        assert!(d.today.is_empty(), "bills never show up as tasks");
    }
```

Run: `cd src-tauri && cargo test finance_summary ; cd ..`
Expected: FAIL saat compile, dengan `no field 'finance' on type 'Dashboard'`.

- [ ] **Step 2: Implementasi di `src-tauri/src/dashboard.rs`**

Ganti import `use crate::time::day_bounds;` dengan:

```rust
use crate::bills::{self, BillStatus, BillView};
use crate::finance;
use crate::overview::{self, BudgetView};
use crate::time::{day_bounds, month_of};
```

Ganti struct `Dashboard` (termasuk komentar "Fase 2 adds a `finance` field.") dengan:

```rust
/// Data for the dashboard, the palette and the notification bell.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub today: Vec<DayTask>,
    pub upcoming: Vec<UpcomingDay>,
    pub recent: Vec<ItemSummary>,
    pub inbox_count: i64,
    pub finance: FinanceSummary,
}

/// The Keuangan card, the bell and the notification panel (spec Fase 2 §5).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinanceSummary {
    pub has_accounts: bool,
    pub balance: i64,
    /// Spent this local month.
    pub expense: i64,
    pub budget: Option<BudgetView>,
    /// Overdue or due today.
    pub due_bills: Vec<BillView>,
}

fn finance_summary(conn: &Connection, now: i64, tz: &TimeZone) -> Result<FinanceSummary, AppError> {
    let accounts = finance::list_accounts(conn, now, tz)?;
    let expense = overview::month_flow(conn, &month_of(now, tz)?, tz)?.expense;
    let due_bills =
        bills::list_bills(conn, now, tz)?.into_iter().filter(|b| matches!(b.status, BillStatus::Overdue | BillStatus::DueToday)).collect();
    Ok(FinanceSummary {
        has_accounts: !accounts.is_empty(),
        balance: accounts.iter().map(|a| a.balance).sum(),
        expense,
        budget: overview::budget_view(conn, expense)?,
        due_bills,
    })
}
```

Di `get`, tambahkan field terakhir di literal `Dashboard`:

```rust
        finance: finance_summary(conn, now, tz)?,
```

- [ ] **Step 3: Jalankan test**

Run: `cd src-tauri && cargo test dashboard:: ; cd ..`
Expected: `6 passed`.

- [ ] **Step 4: Command tagihan**

Di `src-tauri/src/commands.rs`, tambahkan import:

```rust
use crate::bills::{self, BillInput, BillView};
```

Tambahkan setelah `set_budget`:

```rust
#[tauri::command]
pub fn list_bills(db: State<'_, Db>) -> Result<Vec<BillView>, AppError> {
    bills::list_bills(&*db.conn()?, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn save_bill(db: State<'_, Db>, input: BillInput) -> Result<BillView, AppError> {
    bills::save_bill(&*db.conn()?, &input, time::now_ms(), &TimeZone::system())
}

/// Returns the recorded expense, so the toast can open it for editing.
#[tauri::command]
pub fn pay_bill(db: State<'_, Db>, id: String) -> Result<TransactionView, AppError> {
    bills::pay_bill(&*db.conn()?, &id, time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn delete_bill(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    bills::delete_bill(&*db.conn()?, &id, time::now_ms(), &TimeZone::system())
}
```

Di `generate_handler!` di `src-tauri/src/lib.rs`, setelah `commands::set_budget,`:

```rust
            commands::list_bills,
            commands::save_bill,
            commands::pay_bill,
            commands::delete_bill,
```

- [ ] **Step 5: Pemeriksaan**

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings; echo "clippy $?"; cargo test; cd ..`
Expected: `clippy 0` dan `0 failed`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/dashboard.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add finance summary to the dashboard and bill commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Penutup PR**

Jalankan "Prosedur penutup PR" dengan branch `feat/<N3>-f2-3-bills`, judul "F2-3: backend tagihan dan data dashboard", dan `Closes #<N3>`. Belum ada UI baru, jadi cukup E2E `PASS`.

---

# PR F2-4: Halaman Keuangan

### Task 11: Format rupiah dan bulan

**Files:**
- Create: `src/money.ts`, `src/money.test.ts`

**Interfaces:**
- Produces:
  - `formatDigits(n)`: `"25.000"`, atau `"-25.000"` untuk nilai negatif. Dipakai di field formulir.
  - `formatRupiah(n)`: `"Rp 25.000"`, tanpa tanda.
  - `signedRupiah(n)`: `"+Rp 25.000"`, `"−Rp 25.000"` (U+2212), atau `"Rp 0"`.
  - `formatBalance(n)`: `"Rp 25.000"`, atau `"−Rp 25.000"` untuk utang.
  - `parseRupiah(text) -> number | null`.
  - `monthLabel("2026-09")` → `"September 2026"`, `monthShort("2026-09")` → `"Sep"`, `monthOf(ms)` → `"2026-09"`, `addMonths("2026-01", -1)` → `"2025-12"`.

- [ ] **Step 1: Buat branch**

```bash
git switch main && git pull && git switch -c feat/<N4>-f2-4-finance-page
```

Kalau F2-3 belum di-merge, buat branch dari `feat/<N3>-f2-3-bills`.

- [ ] **Step 2: Tulis test yang gagal di `src/money.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import {
  addMonths,
  formatBalance,
  formatDigits,
  formatRupiah,
  monthLabel,
  monthOf,
  monthShort,
  parseRupiah,
  signedRupiah,
} from "./money";

describe("rupiah formatting", () => {
  test("groups thousands with dots and drops the sign", () => {
    expect(formatRupiah(25000)).toBe("Rp 25.000");
    expect(formatRupiah(-1500000)).toBe("Rp 1.500.000");
    expect(formatRupiah(0)).toBe("Rp 0");
  });

  test("signed and balance forms", () => {
    expect(signedRupiah(25000)).toBe("+Rp 25.000");
    expect(signedRupiah(-5000)).toBe("−Rp 5.000");
    expect(signedRupiah(0)).toBe("Rp 0");
    expect(formatBalance(-50000)).toBe("−Rp 50.000");
    expect(formatBalance(975000)).toBe("Rp 975.000");
  });

  test("form digits keep a plain minus", () => {
    expect(formatDigits(1000000)).toBe("1.000.000");
    expect(formatDigits(-25000)).toBe("-25.000");
  });
});

describe("parseRupiah", () => {
  test("accepts plain, grouped and Rp-prefixed amounts", () => {
    expect(parseRupiah("25000")).toBe(25000);
    expect(parseRupiah("25.000")).toBe(25000);
    expect(parseRupiah("Rp 25.000")).toBe(25000);
    expect(parseRupiah(" rp25.000 ")).toBe(25000);
    expect(parseRupiah("-50.000")).toBe(-50000);
  });

  test("rejects decimals and text", () => {
    for (const bad of ["25,5", "25.5", "1.2345", "abc", "", "Rp", "--5"]) {
      expect(parseRupiah(bad)).toBeNull();
    }
  });
});

describe("months", () => {
  test("labels", () => {
    expect(monthLabel("2026-09")).toBe("September 2026");
    expect(monthShort("2026-08")).toBe("Agu");
  });

  test("addMonths crosses years", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-09", -5)).toBe("2026-04");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });

  test("monthOf uses the local date", () => {
    // 30 Sep 20:00 UTC is 1 Oct 03:00 in Jakarta (bun run test sets TZ=Asia/Jakarta).
    expect(monthOf(Date.UTC(2026, 8, 30, 20))).toBe("2026-10");
  });
});
```

Run: `TZ=Asia/Jakarta bun test src/money.test.ts`
Expected: FAIL, dengan `Cannot find module './money'`.

- [ ] **Step 3: Tulis `src/money.ts`**

```ts
// Rupiah amounts are whole numbers (spec Fase 2 K2). Months are "YYYY-MM" strings.

const DIGITS = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const MINUS = "−";
const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const AMOUNT = /^([-−]?)\s*(?:rp\.?\s*)?(\d{1,3}(?:\.\d{3})+|\d+)$/i;

/** 25000 → "25.000", -25000 → "-25.000". The format of the amount fields. */
export function formatDigits(amount: number): string {
  return (amount < 0 ? "-" : "") + DIGITS.format(Math.abs(amount));
}

/** "Rp 25.000". The sign is dropped; see signedRupiah and formatBalance. */
export function formatRupiah(amount: number): string {
  return `Rp ${DIGITS.format(Math.abs(amount))}`;
}

/** "+Rp 25.000", "−Rp 25.000" or "Rp 0", for transaction rows and net flow. */
export function signedRupiah(amount: number): string {
  if (amount > 0) return `+${formatRupiah(amount)}`;
  if (amount < 0) return MINUS + formatRupiah(amount);
  return formatRupiah(0);
}

/** A balance: "Rp 25.000", or "−Rp 25.000" when it is debt. */
export function formatBalance(amount: number): string {
  return amount < 0 ? signedRupiah(amount) : formatRupiah(amount);
}

/** "25000", "25.000", "Rp 25.000" or "-25.000" to whole rupiah. Decimals and text give null. */
export function parseRupiah(text: string): number | null {
  const match = AMOUNT.exec(text.trim());
  if (!match) return null;
  const value = Number(match[2].replaceAll(".", ""));
  if (!Number.isSafeInteger(value)) return null;
  return match[1] ? -value : value;
}

function parts(month: string): [year: number, month: number] {
  const [year, mon] = month.split("-").map(Number);
  return [year, mon];
}

/** "2026-09" → "September 2026". */
export function monthLabel(month: string): string {
  const [year, mon] = parts(month);
  return `${MONTHS[mon - 1]} ${year}`;
}

/** "2026-09" → "Sep". */
export function monthShort(month: string): string {
  return MONTHS_SHORT[parts(month)[1] - 1];
}

/** Local "YYYY-MM" of an epoch-ms date. */
export function monthOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-01" moved by -1 → "2025-12". */
export function addMonths(month: string, n: number): string {
  const [year, mon] = parts(month);
  return monthOf(new Date(year, mon - 1 + n, 1).getTime());
}
```

- [ ] **Step 4: Jalankan test**

Run: `TZ=Asia/Jakarta bun test src/money.test.ts`
Expected: `8 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/money.ts src/money.test.ts
git commit -m "feat: add rupiah and month formatting

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: Tipe API dan helper tampilan

**Files:**
- Modify: `src/api.ts`
- Create: `src/finance/view.ts`, `src/finance/view.test.ts`

**Interfaces:**
- Consumes: semua command dari F2-1 sampai F2-3.
- Produces:
  - Tipe: `AccountKind`, `AccountView`, `AccountInput`, `TransactionKind`, `TransactionView`, `TransactionInput`, `TransferInput`, `Flow`, `TransactionPage`, `Categories`, `BudgetLevel`, `BudgetView`, `MonthFlow`, `FinanceOverview`, `Repeat`, `BillStatus`, `BillView`, `BillInput`, `FinanceSummary`, dan `Dashboard.finance`.
  - `api.listAccounts`, `saveAccount`, `deleteAccount`, `listTransactions(until, flow, offset)`, `saveTransaction`, `saveTransfer`, `deleteTransaction`, `financeCategories`, `financeOverview(month | null)`, `setBudget(amount | null)`, `listBills`, `saveBill`, `payBill`, `deleteBill`.
  - `view.ts`: `KIND_LABELS`, `TransactionIcon`, `iconFor(t)`, `isIncome(t)`, `transactionMeta(t)`, `MonthGroup`, `groupByMonth(items)`, `accountShares(accounts) -> Map<id, percent>`.

- [ ] **Step 1: Tambah tipe di `src/api.ts`**

Tambahkan setelah interface `UpcomingDay`:

```ts
export type AccountKind = "cash" | "bank" | "ewallet" | "credit";

export interface AccountView {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  openingBalance: number;
  /** Opening balance plus transactions dated up to today. */
  balance: number;
}

/** No `id` creates an account. */
export interface AccountInput {
  id?: string;
  name: string;
  kind: AccountKind;
  openingBalance: number;
}

export interface TransactionView {
  id: string;
  title: string;
  body: string;
  /** Rupiah; negative is money leaving the account. */
  amount: number;
  category: string | null;
  accountId: string;
  accountName: string;
  occurredAt: number;
  createdAt: number;
  transferId: string | null;
  counterAccountId: string | null;
  counterAccountName: string | null;
  billId: string | null;
  /** Dated after today, so not in the balance yet. */
  scheduled: boolean;
}

export type TransactionKind = "expense" | "income";

/** `amount` is always positive; `kind` sets the sign. No `id` creates a transaction. */
export interface TransactionInput {
  id?: string;
  kind: TransactionKind;
  amount: number;
  accountId: string;
  occurredAt: number;
  category?: string;
  title: string;
  body?: string;
}

/** No `transferId` creates a transfer. */
export interface TransferInput {
  transferId?: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  occurredAt: number;
  title?: string;
}

export type Flow = "all" | "in" | "out";

export interface TransactionPage {
  items: TransactionView[];
  more: boolean;
}

export interface Categories {
  expense: string[];
  income: string[];
}

export type BudgetLevel = "ok" | "warn" | "over";

export interface BudgetView {
  amount: number;
  level: BudgetLevel;
}

export interface MonthFlow {
  month: string;
  income: number;
  expense: number;
}

export interface FinanceOverview {
  month: string;
  currentMonth: string;
  balance: number;
  accountCount: number;
  income: number;
  expense: number;
  net: number;
  budget: BudgetView | null;
  /** Six months, oldest first. */
  chart: MonthFlow[];
}

export type Repeat = "once" | "monthly";
export type BillStatus = "overdue" | "dueToday" | "upcoming" | "paidToday";

export interface BillView {
  id: string;
  name: string;
  amount: number;
  accountId: string;
  accountName: string;
  repeat: Repeat;
  dueAt: number;
  status: BillStatus;
  daysLate: number;
}

/** No `id` creates a bill. */
export interface BillInput {
  id?: string;
  name: string;
  amount: number;
  accountId: string;
  repeat: Repeat;
  dueAt: number;
}

/** The dashboard's Keuangan card, the bell and the notification panel. */
export interface FinanceSummary {
  hasAccounts: boolean;
  balance: number;
  /** Spent this month. */
  expense: number;
  budget: BudgetView | null;
  /** Overdue or due today. */
  dueBills: BillView[];
}
```

Tambahkan field terakhir di interface `Dashboard`:

```ts
  finance: FinanceSummary;
```

Tambahkan entri ini di objek `api`, setelah `getDashboard`:

```ts
  listAccounts: () => invoke<AccountView[]>("list_accounts"),
  saveAccount: (input: AccountInput) => invoke<AccountView>("save_account", { input }),
  deleteAccount: (id: string) => invoke<void>("delete_account", { id }),
  listTransactions: (until: string, flow: Flow, offset: number) =>
    invoke<TransactionPage>("list_transactions", { query: { until, flow, offset } }),
  saveTransaction: (input: TransactionInput) => invoke<TransactionView>("save_transaction", { input }),
  saveTransfer: (input: TransferInput) => invoke<TransactionView>("save_transfer", { input }),
  deleteTransaction: (id: string) => invoke<void>("delete_transaction", { id }),
  financeCategories: () => invoke<Categories>("finance_categories"),
  /** `null` is the current month. */
  financeOverview: (month: string | null) => invoke<FinanceOverview>("finance_overview", { month }),
  /** `null` removes the monthly limit. */
  setBudget: (amount: number | null) => invoke<void>("set_budget", { amount }),
  listBills: () => invoke<BillView[]>("list_bills"),
  saveBill: (input: BillInput) => invoke<BillView>("save_bill", { input }),
  /** Returns the recorded expense. */
  payBill: (id: string) => invoke<TransactionView>("pay_bill", { id }),
  deleteBill: (id: string) => invoke<void>("delete_bill", { id }),
```

- [ ] **Step 2: Tulis test yang gagal di `src/finance/view.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import type { AccountView, TransactionView } from "../api";
import { accountShares, groupByMonth, iconFor, isIncome, transactionMeta } from "./view";

const tx = (over: Partial<TransactionView> = {}): TransactionView => ({
  id: "t",
  title: "",
  body: "",
  amount: -1000,
  category: null,
  accountId: "a",
  accountName: "BCA",
  occurredAt: 0,
  createdAt: 0,
  transferId: null,
  counterAccountId: null,
  counterAccountName: null,
  billId: null,
  scheduled: false,
  ...over,
});

const account = (id: string, balance: number): AccountView => ({
  id,
  name: id,
  kind: "bank",
  currency: "IDR",
  openingBalance: 0,
  balance,
});

describe("transaction rows", () => {
  test("icons follow transfers, income and the category", () => {
    expect(iconFor(tx({ transferId: "x" }))).toBe("transfer");
    expect(iconFor(tx({ amount: 5000, category: "Gaji" }))).toBe("income");
    expect(iconFor(tx({ category: "Transportasi" }))).toBe("car");
    expect(iconFor(tx({ category: "Makan & minum" }))).toBe("food");
    expect(iconFor(tx({ category: "constructor" }))).toBe("other");
    expect(iconFor(tx())).toBe("other");
  });

  test("income leaves out the incoming leg of a transfer", () => {
    expect(isIncome(tx({ amount: 5000 }))).toBe(true);
    expect(isIncome(tx({ amount: 5000, transferId: "x" }))).toBe(false);
    expect(isIncome(tx())).toBe(false);
  });

  test("meta line", () => {
    expect(transactionMeta(tx({ category: "Belanja" }))).toBe("Belanja · BCA");
    expect(transactionMeta(tx())).toBe("Tanpa kategori · BCA");
    expect(transactionMeta(tx({ transferId: "x", counterAccountName: "GoPay" }))).toBe("BCA → GoPay");
  });

  test("groups consecutive rows by local month", () => {
    const sep = new Date(2026, 8, 29).getTime();
    const aug = new Date(2026, 7, 31).getTime();
    const groups = groupByMonth([tx({ id: "a", occurredAt: sep }), tx({ id: "b", occurredAt: sep }), tx({ id: "c", occurredAt: aug })]);
    expect(groups.map((g) => [g.month, g.items.map((t) => t.id)])).toEqual([
      ["2026-09", ["a", "b"]],
      ["2026-08", ["c"]],
    ]);
  });
});

describe("accountShares", () => {
  test("splits the positive total and skips debt and empty accounts", () => {
    const shares = accountShares([account("bank", 850000), account("tunai", 125000), account("kartu", -50000), account("kosong", 0)]);
    expect([...shares]).toEqual([
      ["bank", 87],
      ["tunai", 13],
    ]);
  });
});
```

Run: `TZ=Asia/Jakarta bun test src/finance/view.test.ts`
Expected: FAIL, dengan `Cannot find module './view'`.

- [ ] **Step 3: Tulis `src/finance/view.ts`**

```ts
// Pure display rules for the Keuangan page (spec Fase 2 §5).
import type { AccountKind, AccountView, TransactionView } from "../api";
import { monthOf } from "../money";

export const KIND_LABELS: Record<AccountKind, string> = {
  cash: "Tunai",
  bank: "Bank",
  ewallet: "E-wallet",
  credit: "Kartu kredit",
};

export type TransactionIcon = "car" | "food" | "bill" | "bag" | "income" | "transfer" | "other";

const CATEGORY_ICONS = new Map<string, TransactionIcon>([
  ["Transportasi", "car"],
  ["Makan & minum", "food"],
  ["Tagihan", "bill"],
  ["Belanja", "bag"],
]);

export function iconFor(t: Pick<TransactionView, "amount" | "category" | "transferId">): TransactionIcon {
  if (t.transferId) return "transfer";
  if (t.amount > 0) return "income";
  return CATEGORY_ICONS.get(t.category ?? "") ?? "other";
}

/** Money coming in from outside, shown in the accent colour. A transfer's incoming leg is not income. */
export function isIncome(t: Pick<TransactionView, "amount" | "transferId">): boolean {
  return t.amount > 0 && t.transferId === null;
}

/** "Makan & minum · BCA", or "BCA → GoPay" for a transfer. */
export function transactionMeta(t: TransactionView): string {
  if (t.transferId) return `${t.accountName} → ${t.counterAccountName ?? "?"}`;
  return `${t.category ?? "Tanpa kategori"} · ${t.accountName}`;
}

export interface MonthGroup {
  month: string;
  items: TransactionView[];
}

/** Consecutive rows of the same local month, in the given order (newest first). */
export function groupByMonth(items: TransactionView[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const t of items) {
    const month = monthOf(t.occurredAt);
    const last = groups.at(-1);
    if (last?.month === month) last.items.push(t);
    else groups.push({ month, items: [t] });
  }
  return groups;
}

/** Whole-percent share of the positive total, only for accounts with a positive balance. */
export function accountShares(accounts: AccountView[]): Map<string, number> {
  const total = accounts.reduce((sum, a) => sum + Math.max(a.balance, 0), 0);
  return new Map(accounts.filter((a) => a.balance > 0).map((a) => [a.id, Math.round((a.balance * 100) / total)]));
}
```

- [ ] **Step 4: Jalankan test dan typecheck**

Run: `bun run typecheck && TZ=Asia/Jakarta bun test src/finance/view.test.ts`
Expected: typecheck exit 0, lalu `5 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/api.ts src/finance/view.ts src/finance/view.test.ts
git commit -m "feat: add finance API types and display rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: Dialog, field, dan ikon

**Files:**
- Create: `src/shell/Dialog.tsx`, `src/finance/fields.tsx`, `src/finance/useSave.ts`, `src/finance/icons.tsx`
- Modify: `src/index.css` (token `--color-warn`)

**Interfaces:**
- Produces:
  - `Dialog({ title, onClose, children })`: modal dengan fokus terkunci, Esc menutup, dan fokus kembali ke pemicu. Input pertama mendapat fokus.
  - `Field({ label, children })` dan `DialogActions({ busy, onCancel, onDelete?, deleteLabel? })`. Hapus perlu dua klik ("Yakin hapus?").
  - `MoneyField({ label, value, onChange })`, `AccountSelect({ label, accounts, value, onChange })`, `Segmented<T>({ label, options, value, onChange, disabled? })`.
  - `useSave(onDone) -> { busy, run, toast }`: satu simpan dalam satu waktu. Kalau gagal, muncul toast dan formulir tetap terbuka.
  - `FinanceIcon({ name: Glyph, size? })`, dengan `Glyph = TransactionIcon | AccountKind`.
  - Kelas Tailwind `text-warn`, `bg-warn`.

- [ ] **Step 1: Token warna**

Di `@theme` di `src/index.css`, tambahkan setelah `--color-danger-row`:

```css
  --color-warn: #c98500;
```

- [ ] **Step 2: Tulis `src/shell/Dialog.tsx`**

```tsx
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { H2, PRIMARY, SECONDARY } from "./ui";

const FOCUSABLE = "input, select, textarea, button:not([disabled])";

/** Modal form: focus stays inside, Esc closes, focus returns to the opener (spec Fase 2 §5). */
export function Dialog({ title, onClose, children }: Readonly<{ title: string; onClose: () => void; children: ReactNode }>) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    return () => previous?.focus();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      const items = box.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div className="fixed inset-0 z-40" onKeyDown={onKeyDown}>
      <button aria-label="Tutup" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-[#05070a]/80" />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-anim
        style={{ animation: "anchoa-pop 0.16s ease-out" }}
        className="absolute top-[90px] left-1/2 -ml-[240px] flex w-[480px] flex-col gap-4 rounded-2xl border border-[#2e3440] bg-surface p-6 shadow-[0_24px_60px_rgb(0_0_0/0.65)]"
      >
        <h2 id={titleId} className={H2}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/** A labelled form control. */
export function Field({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-muted">
      {label}
      {children}
    </label>
  );
}

/** Hapus (asks once more), Batal and Simpan. Pass `onDelete` only when editing. */
export function DialogActions({
  busy,
  onCancel,
  onDelete,
  deleteLabel = "Hapus",
}: Readonly<{ busy: boolean; onCancel: () => void; onDelete?: () => void; deleteLabel?: string }>) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2">
      {onDelete && (
        <button
          type="button"
          disabled={busy}
          onClick={() => (confirming ? onDelete() : setConfirming(true))}
          className="min-h-10 rounded-full px-3 text-[13px] text-danger transition-colors hover:bg-danger-row"
        >
          {confirming ? "Yakin hapus?" : deleteLabel}
        </button>
      )}
      <button type="button" onClick={onCancel} className={`${SECONDARY} ml-auto`}>
        Batal
      </button>
      <button type="submit" disabled={busy} className={PRIMARY}>
        Simpan
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Tulis `src/finance/fields.tsx`**

```tsx
import type { AccountView } from "../api";
import { formatDigits, parseRupiah } from "../money";
import { Field } from "../shell/Dialog";
import { FIELD } from "../shell/ui";

/** Rupiah text field: accepts "25000", "25.000" or "Rp 25.000" and regroups the digits on blur. */
export function MoneyField({
  label,
  value,
  onChange,
}: Readonly<{ label: string; value: string; onChange: (value: string) => void }>) {
  return (
    <Field label={label}>
      <input
        inputMode="numeric"
        value={value}
        placeholder="0"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const amount = parseRupiah(value);
          if (amount !== null) onChange(formatDigits(amount));
        }}
        className={FIELD}
      />
    </Field>
  );
}

export function AccountSelect({
  label,
  accounts,
  value,
  onChange,
}: Readonly<{ label: string; accounts: AccountView[]; value: string; onChange: (id: string) => void }>) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={FIELD}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Mutually exclusive buttons, e.g. Pengeluaran | Pemasukan | Transfer. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: Readonly<{
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: (value: T) => boolean;
}>) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-[10px] border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          disabled={disabled?.(o.value)}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] disabled:text-disabled ${
            value === o.value ? "bg-surface-2 text-ink" : "text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Tulis `src/finance/useSave.ts`**

```ts
import { useState } from "react";
import { errorMessage } from "../api";
import { useToast } from "../shell/toast";

/** Runs one save at a time. A failure shows a toast and keeps the form open with what was typed. */
export function useSave(onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      onDone();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return { busy, run, toast };
}
```

- [ ] **Step 5: Tulis `src/finance/icons.tsx`**

```tsx
import type { ReactNode } from "react";
import type { AccountKind } from "../api";
import type { TransactionIcon } from "./view";

export type Glyph = TransactionIcon | AccountKind;

const PATHS: Record<Glyph, ReactNode> = {
  car: <path d="M5 17h14M6 17v2M18 17v2M4 13l2-5h12l2 5v4H4z" />,
  food: <path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M16 3c-2 1-3 4-3 7h3v11" />,
  bill: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />,
  bag: <path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2" />,
  income: <path d="M12 19V5M6 11l6-6 6 6" />,
  transfer: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
  other: <circle cx="12" cy="12" r="8" />,
  cash: (
    <>
      <rect x="3" y="7" width="18" height="10" rx="2" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  bank: <path d="M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18M12 4l9 5H3z" />,
  ewallet: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  credit: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18" />
    </>
  ),
};

/** 24×24 stroke icon for finance rows. */
export function FinanceIcon({ name, size = 15 }: Readonly<{ name: Glyph; size?: number }>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: exit 0. Komponen ini baru dipakai di Task 14–16.

- [ ] **Step 7: Commit**

```bash
git add src/index.css src/shell/Dialog.tsx src/finance/fields.tsx src/finance/useSave.ts src/finance/icons.tsx
git commit -m "feat: add form dialog, finance fields and icons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: Kartu, grafik, dan bagian Akun

**Files:**
- Create: `src/finance/SummaryCards.tsx`, `src/finance/CashFlowChart.tsx`, `src/finance/AccountsSection.tsx`

**Interfaces:**
- Consumes: `FinanceOverview`, `MonthFlow`, `AccountView` (Task 12), helper uang dan bulan (Task 11), `accountShares`, `KIND_LABELS` (Task 12), `FinanceIcon` (Task 13).
- Produces:
  - `SummaryCards({ overview, onBudget })`
  - `CashFlowChart({ chart, month, onPick })`
  - `AccountsSection({ accounts, onAdd, onEdit })`

- [ ] **Step 1: Tulis `src/finance/SummaryCards.tsx`**

```tsx
import type { BudgetLevel, FinanceOverview } from "../api";
import { formatBalance, formatRupiah, monthLabel, monthShort, signedRupiah } from "../money";
import { PANEL } from "../shell/ui";

const CARD = `${PANEL} flex flex-col gap-1`;
const VALUE = "font-display text-[22px] font-semibold";
const LEVEL_BAR: Record<BudgetLevel, string> = { ok: "bg-accent", warn: "bg-warn", over: "bg-danger" };

function Card({ label, value, tone = "", note }: Readonly<{ label: string; value: string; tone?: string; note: string }>) {
  return (
    <section className={CARD}>
      <span className="text-xs text-muted">{label}</span>
      <span className={`${VALUE} ${tone}`}>{value}</span>
      <span className="text-xs text-muted">{note}</span>
    </section>
  );
}

/** Saldo, Pemasukan, Pengeluaran (with the monthly limit) and Arus bersih. */
export function SummaryCards({ overview: o, onBudget }: Readonly<{ overview: FinanceOverview; onBudget: () => void }>) {
  const used = o.budget ? Math.min(100, Math.round((o.expense * 100) / o.budget.amount)) : 0;
  return (
    <div className="grid grid-cols-4 gap-3.5">
      <Card
        label="Saldo total"
        value={formatBalance(o.balance)}
        tone={o.balance < 0 ? "text-danger" : ""}
        note={`${o.accountCount} akun · per hari ini`}
      />
      <Card
        label={`Pemasukan ${monthShort(o.month)}`}
        value={formatRupiah(o.income)}
        tone={o.income > 0 ? "text-accent" : ""}
        note={monthLabel(o.month)}
      />
      <button
        onClick={onBudget}
        aria-label={`Pengeluaran ${monthLabel(o.month)} ${formatRupiah(o.expense)}. Atur batas pengeluaran`}
        className={`${CARD} text-left transition-colors hover:bg-surface-2`}
      >
        <span className="text-xs text-muted">Pengeluaran {monthShort(o.month)}</span>
        <span className={VALUE}>{formatRupiah(o.expense)}</span>
        {o.budget ? (
          <>
            <span className="text-xs text-muted">dari {formatRupiah(o.budget.amount)}</span>
            <span aria-hidden="true" className="mt-1 block h-1 overflow-hidden rounded-sm bg-line">
              <span className={`block h-full rounded-sm ${LEVEL_BAR[o.budget.level]}`} style={{ width: `${used}%` }} />
            </span>
          </>
        ) : (
          <span className="text-xs text-muted">Atur batas</span>
        )}
      </button>
      <Card
        label="Arus bersih"
        value={signedRupiah(o.net)}
        tone={o.net < 0 ? "text-danger" : "text-accent"}
        note="pemasukan − pengeluaran"
      />
    </div>
  );
}
```

- [ ] **Step 2: Tulis `src/finance/CashFlowChart.tsx`**

```tsx
import type { MonthFlow } from "../api";
import { formatRupiah, monthLabel, monthShort } from "../money";
import { H2, PANEL } from "../shell/ui";

const BAR_MAX = 104;

/** Pixel height of a bar: at least 3px when there is money, 2px when there is none. */
function barHeight(value: number, max: number): number {
  return value > 0 ? Math.max(3, Math.round((value / max) * BAR_MAX)) : 2;
}

/** "Arus kas 6 bulan": CSS bars, one button per month; picking one changes the page's month. */
export function CashFlowChart({
  chart,
  month,
  onPick,
}: Readonly<{ chart: MonthFlow[]; month: string; onPick: (month: string) => void }>) {
  const max = Math.max(1, ...chart.flatMap((m) => [m.income, m.expense]));
  return (
    <section aria-labelledby="arus-judul" className={`${PANEL} flex flex-col gap-3`}>
      <div className="flex items-center justify-between">
        <h2 id="arus-judul" className={H2}>
          Arus kas 6 bulan
        </h2>
        <div aria-hidden="true" className="flex gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-accent" />
            Masuk
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-danger" />
            Keluar
          </span>
        </div>
      </div>
      <div className="flex h-[120px] items-end gap-2">
        {chart.map((m) => {
          const on = m.month === month;
          const label = `${monthLabel(m.month)}: masuk ${formatRupiah(m.income)}, keluar ${formatRupiah(m.expense)}`;
          return (
            <button
              key={m.month}
              onClick={() => onPick(m.month)}
              aria-pressed={on}
              aria-label={label}
              title={label}
              className={`flex h-full flex-1 items-end justify-center gap-1 rounded-lg pb-1 transition-colors ${
                on ? "bg-surface-2" : "hover:bg-surface-2"
              }`}
            >
              <span
                className={`w-3 rounded-sm ${m.income > 0 ? "bg-accent" : "bg-disabled"}`}
                style={{ height: barHeight(m.income, max), opacity: on ? 1 : 0.4 }}
              />
              <span
                className={`w-3 rounded-sm ${m.expense > 0 ? "bg-danger" : "bg-disabled"}`}
                style={{ height: barHeight(m.expense, max), opacity: on ? 1 : 0.4 }}
              />
            </button>
          );
        })}
      </div>
      <div aria-hidden="true" className="flex gap-2">
        {chart.map((m) => (
          <span
            key={m.month}
            className={`flex-1 text-center text-xs ${m.month === month ? "font-semibold text-ink" : "text-muted"}`}
          >
            {monthShort(m.month)}
          </span>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Tulis `src/finance/AccountsSection.tsx`**

```tsx
import type { AccountView } from "../api";
import { formatBalance } from "../money";
import { H2, PANEL, ROW, SECONDARY } from "../shell/ui";
import { FinanceIcon } from "./icons";
import { accountShares, KIND_LABELS } from "./view";

/** Colours of the stacked share bar, in account order. */
const SEGMENTS = ["bg-accent", "bg-heat-2", "bg-heat-3", "bg-muted"];

export function AccountsSection({
  accounts,
  onAdd,
  onEdit,
}: Readonly<{ accounts: AccountView[]; onAdd: () => void; onEdit: (account: AccountView) => void }>) {
  const shares = accountShares(accounts);
  return (
    <section aria-labelledby="akun-judul" className={`${PANEL} flex flex-col gap-3`}>
      <div className="flex items-center justify-between">
        <h2 id="akun-judul" className={H2}>
          Akun
        </h2>
        <button onClick={onAdd} className="text-xs text-accent hover:text-accent-hover">
          + Tambah
        </button>
      </div>
      {accounts.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 text-sm text-muted">Belum ada akun</p>
          <button onClick={onAdd} className={SECONDARY}>
            Buat akun
          </button>
        </div>
      ) : (
        <>
          <div aria-hidden="true" className="flex h-1.5 gap-[3px]">
            {[...shares].map(([id, share], i) => (
              <span key={id} className={`rounded-[3px] ${SEGMENTS[i % SEGMENTS.length]}`} style={{ width: `${share}%` }} />
            ))}
          </div>
          <div className="flex flex-col">
            {accounts.map((a) => {
              const share = shares.get(a.id);
              return (
                <button key={a.id} onClick={() => onEdit(a)} className={`${ROW} flex items-center gap-3 px-2 py-2 text-left`}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                    <FinanceIcon name={a.kind} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{a.name}</span>
                    <span className="text-xs text-muted">{share === undefined ? KIND_LABELS[a.kind] : `${share}% saldo`}</span>
                  </span>
                  <span className={`font-mono text-sm ${a.balance < 0 ? "text-danger" : ""}`}>{formatBalance(a.balance)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/finance/SummaryCards.tsx src/finance/CashFlowChart.tsx src/finance/AccountsSection.tsx
git commit -m "feat: add finance cards, cash-flow chart and accounts section

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: Daftar transaksi dan formulir

**Files:**
- Create: `src/finance/TransactionList.tsx`, `src/finance/TransactionForm.tsx`, `src/finance/AccountForm.tsx`, `src/finance/BudgetForm.tsx`

**Interfaces:**
- Consumes: `api` (Task 12), `Dialog`, `DialogActions`, `Field`, `MoneyField`, `AccountSelect`, `Segmented`, `useSave`, `FinanceIcon` (Task 13), `groupByMonth`, `iconFor`, `isIncome`, `transactionMeta`, `KIND_LABELS` (Task 12), `dateInputToMs`, `msToDateInput`, `shortDate` (`src/format.ts`).
- Produces:
  - `TransactionList({ until, version, onEdit })`: memuat ulang halaman pertama saat `until`, filter, atau `version` berubah.
  - `TransactionForm({ edit?, accounts, categories, onClose, onSaved })`: `accounts` tidak boleh kosong.
  - `AccountForm({ edit?, note?, onClose, onSaved })`
  - `BudgetForm({ current, onClose, onSaved })`
  - Urutan fokus formulir transaksi (dipakai E2E): Jumlah → Akun (atau Dari, Ke) → Kategori → Keterangan → Tanggal → Catatan → tombol. Urutan fokus formulir akun: Nama → Jenis → Saldo awal.

- [ ] **Step 1: Tulis `src/finance/TransactionList.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, errorMessage, type Flow, type TransactionView } from "../api";
import { shortDate } from "../format";
import { formatRupiah, monthLabel, signedRupiah } from "../money";
import { useToast } from "../shell/toast";
import { H2, PANEL, ROW, SECONDARY } from "../shell/ui";
import { Segmented } from "./fields";
import { FinanceIcon } from "./icons";
import { groupByMonth, iconFor, isIncome, transactionMeta } from "./view";

const FLOWS = [
  { value: "all", label: "Semua" },
  { value: "in", label: "Masuk" },
  { value: "out", label: "Keluar" },
] as const;

function TransactionRow({ t, onEdit }: Readonly<{ t: TransactionView; onEdit: (t: TransactionView) => void }>) {
  const income = isIncome(t);
  return (
    <button onClick={() => onEdit(t)} className={`${ROW} flex items-center gap-3 px-2 py-2 text-left`}>
      <span className="w-12 shrink-0 font-mono text-xs text-muted">{shortDate(t.occurredAt)}</span>
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 ${income ? "text-accent" : "text-muted"}`}
      >
        <FinanceIcon name={iconFor(t)} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{t.title || "Tanpa keterangan"}</span>
        <span className="truncate text-xs text-muted">{transactionMeta(t)}</span>
      </span>
      {t.scheduled && <span className="shrink-0 rounded-md border border-line px-1.5 py-px text-[11px] text-muted">terjadwal</span>}
      <span className={`shrink-0 font-mono text-sm ${income ? "text-accent" : ""}`}>
        {t.transferId ? formatRupiah(t.amount) : signedRupiah(t.amount)}
      </span>
    </button>
  );
}

/** "Transaksi terbaru": everything up to the end of `until`, 50 rows at a time (spec Fase 2 §4). */
export function TransactionList({
  until,
  version,
  onEdit,
}: Readonly<{ until: string; version: number; onEdit: (t: TransactionView) => void }>) {
  const toast = useToast();
  const [flow, setFlow] = useState<Flow>("all");
  const [items, setItems] = useState<TransactionView[] | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    api.listTransactions(until, flow, 0).then(
      (page) => {
        setItems(page.items);
        setMore(page.more);
      },
      (e) => toast(errorMessage(e), "error"),
    );
  }, [until, flow, version, toast]);

  const loadMore = () =>
    api.listTransactions(until, flow, items?.length ?? 0).then(
      (page) => {
        setItems((list) => [...(list ?? []), ...page.items]);
        setMore(page.more);
      },
      (e) => toast(errorMessage(e), "error"),
    );

  return (
    <section aria-labelledby="transaksi-judul" className={`${PANEL} flex flex-col gap-2`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="transaksi-judul" className={H2}>
          Transaksi terbaru
        </h2>
        <div className="w-[220px]">
          <Segmented label="Filter transaksi" options={FLOWS} value={flow} onChange={setFlow} />
        </div>
      </div>
      {items?.length === 0 && <p className="m-0 py-6 text-center text-sm text-muted">Tidak ada transaksi untuk filter ini.</p>}
      {groupByMonth(items ?? []).map((g) => (
        <div key={g.month} className="flex flex-col">
          <span className="px-2 pt-2 pb-1 text-[11px] tracking-[0.08em] text-muted uppercase">{monthLabel(g.month)}</span>
          {g.items.map((t) => (
            <TransactionRow key={t.id} t={t} onEdit={onEdit} />
          ))}
        </div>
      ))}
      {more && (
        <button onClick={() => void loadMore()} className={`${SECONDARY} self-center`}>
          Muat lagi
        </button>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Tulis `src/finance/TransactionForm.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { api, type AccountView, type Categories, type TransactionView } from "../api";
import { dateInputToMs, msToDateInput } from "../format";
import { formatDigits, parseRupiah } from "../money";
import { Dialog, DialogActions, Field } from "../shell/Dialog";
import { FIELD } from "../shell/ui";
import { AccountSelect, MoneyField, Segmented } from "./fields";
import { useSave } from "./useSave";

type Kind = "expense" | "income" | "transfer";

const KINDS = [
  { value: "expense", label: "Pengeluaran" },
  { value: "income", label: "Pemasukan" },
  { value: "transfer", label: "Transfer" },
] as const;

// ponytail: remembered for this session only; persist it if people ask for it across restarts.
let lastAccountId: string | null = null;

function kindOf(t: TransactionView): Kind {
  if (t.transferId) return "transfer";
  return t.amount > 0 ? "income" : "expense";
}

/** Add or edit an expense, income or transfer. `accounts` must not be empty. */
export function TransactionForm({
  edit,
  accounts,
  categories,
  onClose,
  onSaved,
}: Readonly<{
  edit?: TransactionView;
  accounts: AccountView[];
  categories: Categories | null;
  onClose: () => void;
  onSaved: () => void;
}>) {
  const defaultAccount = accounts.find((a) => a.id === lastAccountId)?.id ?? accounts[0].id;
  const [kind, setKind] = useState<Kind>(edit ? kindOf(edit) : "expense");
  const [amount, setAmount] = useState(edit ? formatDigits(Math.abs(edit.amount)) : "");
  const [account, setAccount] = useState(edit?.accountId ?? defaultAccount);
  const [to, setTo] = useState(edit?.counterAccountId ?? accounts.find((a) => a.id !== account)?.id ?? account);
  const [category, setCategory] = useState(edit?.category ?? "");
  const [title, setTitle] = useState(edit?.title ?? "");
  const [date, setDate] = useState(msToDateInput(edit?.occurredAt ?? Date.now()));
  const [body, setBody] = useState(edit?.body ?? "");
  const { busy, run, toast } = useSave(onSaved);
  const suggestions = kind === "income" ? categories?.income : categories?.expense;
  // A saved transfer cannot become a plain transaction or the other way round (the backend refuses).
  const locked = (k: Kind) => edit !== undefined && (k === "transfer") !== (kind === "transfer");

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = parseRupiah(amount);
    const occurredAt = dateInputToMs(date);
    if (value === null || value <= 0) {
      toast("Jumlah harus angka bulat lebih dari 0", "error");
      return;
    }
    if (occurredAt === null) {
      toast("Tanggal wajib diisi", "error");
      return;
    }
    lastAccountId = account;
    void run(() =>
      kind === "transfer"
        ? api.saveTransfer({ transferId: edit?.transferId ?? undefined, fromAccountId: account, toAccountId: to, amount: value, occurredAt, title })
        : api.saveTransaction({ id: edit?.id, kind, amount: value, accountId: account, occurredAt, category, title, body }),
    );
  }

  const remove = edit ? () => void run(() => api.deleteTransaction(edit.id)) : undefined;

  return (
    <Dialog title={edit ? "Ubah transaksi" : "Transaksi baru"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Segmented label="Jenis transaksi" options={KINDS} value={kind} onChange={setKind} disabled={locked} />
        <MoneyField label="Jumlah" value={amount} onChange={setAmount} />
        {kind === "transfer" ? (
          <div className="grid grid-cols-2 gap-3">
            <AccountSelect label="Dari" accounts={accounts} value={account} onChange={setAccount} />
            <AccountSelect label="Ke" accounts={accounts} value={to} onChange={setTo} />
          </div>
        ) : (
          <>
            <AccountSelect label="Akun" accounts={accounts} value={account} onChange={setAccount} />
            <Field label="Kategori">
              <input list="finance-categories" value={category} onChange={(e) => setCategory(e.target.value)} className={FIELD} />
              <datalist id="finance-categories">
                {suggestions?.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
          </>
        )}
        <Field label="Keterangan">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === "transfer" ? "Transfer" : "Tanpa keterangan"}
            className={FIELD}
          />
        </Field>
        <Field label="Tanggal">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} />
        </Field>
        {kind !== "transfer" && (
          <Field label="Catatan">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} className={`${FIELD} resize-none`} />
          </Field>
        )}
        <DialogActions busy={busy} onCancel={onClose} onDelete={remove} />
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 3: Tulis `src/finance/AccountForm.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { api, type AccountKind, type AccountView } from "../api";
import { formatDigits, parseRupiah } from "../money";
import { Dialog, DialogActions, Field } from "../shell/Dialog";
import { FIELD } from "../shell/ui";
import { MoneyField } from "./fields";
import { useSave } from "./useSave";
import { KIND_LABELS } from "./view";

const KINDS = Object.entries(KIND_LABELS) as [AccountKind, string][];

/** Add or edit an account. `note` explains why the form opened, e.g. "Buat akun dulu". */
export function AccountForm({
  edit,
  note,
  onClose,
  onSaved,
}: Readonly<{ edit?: AccountView; note?: string; onClose: () => void; onSaved: () => void }>) {
  const [name, setName] = useState(edit?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(edit?.kind ?? "bank");
  const [opening, setOpening] = useState(edit ? formatDigits(edit.openingBalance) : "");
  const { busy, run, toast } = useSave(onSaved);

  function submit(e: FormEvent) {
    e.preventDefault();
    // Empty means zero. A negative opening balance is debt, e.g. on a credit card.
    const openingBalance = opening.trim() === "" ? 0 : parseRupiah(opening);
    if (openingBalance === null) {
      toast("Saldo awal harus angka bulat", "error");
      return;
    }
    void run(() => api.saveAccount({ id: edit?.id, name, kind, openingBalance }));
  }

  const remove = edit ? () => void run(() => api.deleteAccount(edit.id)) : undefined;

  return (
    <Dialog title={edit ? "Ubah akun" : "Akun baru"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {note && <p className="m-0 rounded-[10px] bg-surface-2 px-3 py-2 text-sm text-ink">{note}</p>}
        <Field label="Nama">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="BCA, GoPay, Tunai…" className={FIELD} />
        </Field>
        <Field label="Jenis">
          <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)} className={FIELD}>
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <MoneyField label="Saldo awal" value={opening} onChange={setOpening} />
        <DialogActions busy={busy} onCancel={onClose} onDelete={remove} />
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 4: Tulis `src/finance/BudgetForm.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { api } from "../api";
import { formatDigits, parseRupiah } from "../money";
import { Dialog, DialogActions } from "../shell/Dialog";
import { MoneyField } from "./fields";
import { useSave } from "./useSave";

/** The one monthly spending limit (spec K11). It only warns; transactions are never refused. */
export function BudgetForm({
  current,
  onClose,
  onSaved,
}: Readonly<{ current: number | null; onClose: () => void; onSaved: () => void }>) {
  const [amount, setAmount] = useState(current === null ? "" : formatDigits(current));
  const { busy, run, toast } = useSave(onSaved);

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = parseRupiah(amount);
    if (value === null || value <= 0) {
      toast("Batas harus angka bulat lebih dari 0", "error");
      return;
    }
    void run(() => api.setBudget(value));
  }

  const remove = current === null ? undefined : () => void run(() => api.setBudget(null));

  return (
    <Dialog title="Batas pengeluaran bulanan" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="m-0 text-sm text-muted">Berlaku setiap bulan. Hanya peringatan: transaksi tetap bisa dicatat.</p>
        <MoneyField label="Batas per bulan" value={amount} onChange={setAmount} />
        <DialogActions busy={busy} onCancel={onClose} onDelete={remove} deleteLabel="Hapus batas" />
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/finance/TransactionList.tsx src/finance/TransactionForm.tsx src/finance/AccountForm.tsx src/finance/BudgetForm.tsx
git commit -m "feat: add transaction list and finance forms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 16: Halaman Keuangan dipasang di aplikasi

**Files:**
- Create: `src/finance/FinancePage.tsx`
- Modify: `src/App.tsx`, `src/shell/nav.ts`, `scripts/e2e-smoke.sh` (komentar di `check_nav` dan `check_palette`)

**Interfaces:**
- Consumes: semua komponen dari Task 14 dan 15.
- Produces:
  - `FinancePage({ newTransaction, onChanged })`. `newTransaction` membuka formulir transaksi saat halaman pertama dimuat, atau formulir akun kalau belum ada akun. `onChanged` dipanggil setelah setiap simpan, supaya lonceng dan dashboard dimuat ulang.
  - Tipe `Page` di `App` mendapat `intent?: number`. Nilai baru me-remount halaman Keuangan dengan formulir transaksi terbuka (dipakai Task 18).

- [ ] **Step 1: Tulis `src/finance/FinancePage.tsx`**

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { api, errorMessage, type AccountView, type Categories, type FinanceOverview, type TransactionView } from "../api";
import { addMonths, monthLabel } from "../money";
import { useToast } from "../shell/toast";
import { H1, PRIMARY, SECONDARY } from "../shell/ui";
import { AccountForm } from "./AccountForm";
import { AccountsSection } from "./AccountsSection";
import { BudgetForm } from "./BudgetForm";
import { CashFlowChart } from "./CashFlowChart";
import { SummaryCards } from "./SummaryCards";
import { TransactionForm } from "./TransactionForm";
import { TransactionList } from "./TransactionList";

/** The form open over the page, if any. */
type OpenForm = { form: "transaction"; edit?: TransactionView } | { form: "account"; edit?: AccountView } | { form: "budget" } | null;

const MONTH_NAV =
  "flex h-8 w-8 items-center justify-center rounded-lg text-ink transition-colors hover:bg-surface-2 disabled:text-disabled disabled:hover:bg-transparent";

function Chevron({ d }: Readonly<{ d: string }>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Keuangan page (docs/design/artboards/Keuangan.dc.html, spec Fase 2 §5). */
export function FinancePage({ newTransaction, onChanged }: Readonly<{ newTransaction: boolean; onChanged: () => void }>) {
  const toast = useToast();
  const [month, setMonth] = useState<string | null>(null);
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [accounts, setAccounts] = useState<AccountView[] | null>(null);
  const [categories, setCategories] = useState<Categories | null>(null);
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState<OpenForm>(newTransaction ? { form: "transaction" } : null);

  useEffect(() => {
    api.financeOverview(month).then(setOverview, (e) => toast(errorMessage(e), "error"));
  }, [month, version, toast]);

  useEffect(() => {
    const fail = (e: unknown) => toast(errorMessage(e), "error");
    api.listAccounts().then(setAccounts, fail);
    api.financeCategories().then(setCategories, fail);
  }, [version, toast]);

  if (!overview || !accounts) return <h1 className={H1}>Keuangan</h1>;

  const close = () => setOpen(null);
  const saved = () => {
    setOpen(null);
    setVersion((v) => v + 1);
    onChanged();
  };

  const form = (): ReactNode => {
    if (open === null) return null;
    if (open.form === "account") return <AccountForm edit={open.edit} onClose={close} onSaved={saved} />;
    if (open.form === "budget") return <BudgetForm current={overview.budget?.amount ?? null} onClose={close} onSaved={saved} />;
    if (accounts.length === 0) return <AccountForm note="Buat akun dulu" onClose={close} onSaved={saved} />;
    return <TransactionForm edit={open.edit} accounts={accounts} categories={categories} onClose={close} onSaved={saved} />;
  };

  return (
    <>
      <div className="flex items-center gap-4">
        <h1 className={H1}>Keuangan</h1>
        <div className="flex items-center gap-1">
          <button aria-label="Bulan sebelumnya" onClick={() => setMonth(addMonths(overview.month, -1))} className={MONTH_NAV}>
            <Chevron d="M15 6l-6 6 6 6" />
          </button>
          <span aria-live="polite" className="min-w-[150px] text-center font-display text-base font-semibold">
            {monthLabel(overview.month)}
          </span>
          <button
            aria-label="Bulan berikutnya"
            disabled={overview.month >= overview.currentMonth}
            onClick={() => setMonth(addMonths(overview.month, 1))}
            className={MONTH_NAV}
          >
            <Chevron d="M9 6l6 6-6 6" />
          </button>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            disabled
            title="Hadir di Fase 5"
            className={`${SECONDARY} disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent`}
          >
            Catat lewat suara
          </button>
          <button onClick={() => setOpen({ form: "transaction" })} className={PRIMARY}>
            + Transaksi
          </button>
        </div>
      </div>
      <SummaryCards overview={overview} onBudget={() => setOpen({ form: "budget" })} />
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start gap-3.5">
        <div className="flex min-w-0 flex-col gap-3.5">
          <CashFlowChart chart={overview.chart} month={overview.month} onPick={setMonth} />
          <TransactionList until={overview.month} version={version} onEdit={(t) => setOpen({ form: "transaction", edit: t })} />
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <AccountsSection
            accounts={accounts}
            onAdd={() => setOpen({ form: "account" })}
            onEdit={(a) => setOpen({ form: "account", edit: a })}
          />
        </div>
      </div>
      {form()}
    </>
  );
}
```

- [ ] **Step 2: Keuangan bukan lagi halaman "menyusul"**

Di `src/shell/nav.ts`, ganti entri `keuangan` menjadi:

```ts
  { id: "keuangan", label: "Keuangan" },
```

Tanpa `fase` dan `about`, `ComingSoon` tidak lagi tampil untuk Keuangan, palette tidak menulis "Fase 2", dan asisten mini memakai pesan umum.

- [ ] **Step 3: Pasang di `src/App.tsx`**

Tambahkan import:

```tsx
import { FinancePage } from "./finance/FinancePage";
```

Ganti tipe `Page` menjadi:

```tsx
/** A new `intent` number remounts Keuangan with the transaction form open (palette "Catat transaksi"). */
type Page = { name: PageId; intent?: number } | { name: "item"; id: string };
```

Tambahkan baris ini tepat setelah baris `{page.name === "inbox" && ...}`:

```tsx
        {page.name === "keuangan" && (
          <FinancePage key={page.intent ?? 0} newTransaction={page.intent !== undefined} onChanged={reload} />
        )}
```

- [ ] **Step 4: Perbarui komentar E2E**

Di `check_nav` di `scripts/e2e-smoke.sh`, ganti komentar pada `shot "3-nav-$y"` menjadi:

```bash
    shot "3-nav-$y"     # expect: placeholder page (Email, Jadwal, Proyek … Profil); y=310 is the Keuangan page
```

Di `check_palette`, ganti komentar `shot 4-palette-keuangan` menjadi:

```bash
  shot 4-palette-keuangan   # expect: Keuangan page with "Belum ada akun"
```

- [ ] **Step 5: Pemeriksaan**

Run: `bun run typecheck && bun run test && bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`
Expected: typecheck exit 0, `0 fail`, dan `PASS`. Buka `3-nav-310.png`: halaman Keuangan dengan 4 kartu Rp 0, grafik 6 bulan, dan "Belum ada akun".

- [ ] **Step 6: Commit**

```bash
git add src/finance/FinancePage.tsx src/App.tsx src/shell/nav.ts scripts/e2e-smoke.sh
git commit -m "feat: add the Keuangan page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 17: Kartu Keuangan di dashboard

**Files:**
- Modify: `src/finance/view.ts`, `src/finance/view.test.ts` (`billChip`)
- Create: `src/dashboard/FinanceCard.tsx`
- Modify: `src/dashboard/Dashboard.tsx`

**Interfaces:**
- Consumes: `FinanceSummary`, `BillView` (Task 12).
- Produces:
  - `billChip(dueBills) -> { text, tone: "danger" | "ink" | "accent" }`
  - `FinanceCard({ finance?, onSelect })`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `src/finance/view.test.ts`. `billChip` masuk ke baris import dari `./view`, dan `BillView` masuk ke import tipe dari `../api`:

```ts
const bill = (name: string, status: BillView["status"]): BillView => ({
  id: name,
  name,
  amount: 1000,
  accountId: "a",
  accountName: "BCA",
  repeat: "monthly",
  dueAt: 0,
  status,
  daysLate: status === "overdue" ? 1 : 0,
});

describe("billChip", () => {
  test("late bills first, then today's, else all clear", () => {
    expect(billChip([bill("Listrik", "overdue"), bill("Air", "dueToday")])).toEqual({ text: "1 terlambat", tone: "danger" });
    expect(billChip([bill("Air", "dueToday")])).toEqual({ text: "Air hari ini", tone: "ink" });
    expect(billChip([bill("Air", "dueToday"), bill("Gas", "dueToday")])).toEqual({ text: "2 tagihan hari ini", tone: "ink" });
    expect(billChip([])).toEqual({ text: "Tagihan aman", tone: "accent" });
  });
});
```

Run: `TZ=Asia/Jakarta bun test src/finance/view.test.ts`
Expected: FAIL, dengan `Export named 'billChip' not found`.

- [ ] **Step 2: Implementasi `billChip`**

Tambahkan `BillView` ke import tipe di `src/finance/view.ts`, lalu tambahkan di akhir file:

```ts
/** Chip on the dashboard Keuangan card (spec Fase 2 §5). `dueBills` is overdue or due today. */
export function billChip(dueBills: BillView[]): { text: string; tone: "danger" | "ink" | "accent" } {
  const late = dueBills.filter((b) => b.status === "overdue").length;
  if (late > 0) return { text: `${late} terlambat`, tone: "danger" };
  const today = dueBills.filter((b) => b.status === "dueToday");
  if (today.length === 1) return { text: `${today[0].name} hari ini`, tone: "ink" };
  if (today.length > 1) return { text: `${today.length} tagihan hari ini`, tone: "ink" };
  return { text: "Tagihan aman", tone: "accent" };
}
```

Run: `TZ=Asia/Jakarta bun test src/finance/view.test.ts`
Expected: `6 pass, 0 fail`.

- [ ] **Step 3: Tulis `src/dashboard/FinanceCard.tsx`**

```tsx
import type { BudgetLevel, FinanceSummary } from "../api";
import { billChip } from "../finance/view";
import { formatBalance, formatRupiah } from "../money";
import type { PageId } from "../shell/nav";
import { H2, PANEL } from "../shell/ui";

const CHIP = { danger: "bg-danger-row text-danger", ink: "bg-surface-2 text-ink", accent: "bg-surface-2 text-accent" } as const;
const LEVEL_TEXT: Record<BudgetLevel, string> = { ok: "text-muted", warn: "text-warn", over: "text-danger" };

/** Bento card: balance, spent this month against the limit, and the bill chip. Opens Keuangan. */
export function FinanceCard({ finance, onSelect }: Readonly<{ finance?: FinanceSummary; onSelect: (page: PageId) => void }>) {
  const chip = finance ? billChip(finance.dueBills) : null;
  return (
    <button
      onClick={() => onSelect("keuangan")}
      className={`${PANEL} flex flex-col items-start gap-1.5 text-left transition-colors hover:bg-surface-2`}
    >
      <span className={`${H2} block`}>Keuangan</span>
      {finance && !finance.hasAccounts && <span className="text-xs text-muted">Belum ada akun</span>}
      {finance?.hasAccounts && chip && (
        <>
          <span className={`font-display text-[22px] font-semibold ${finance.balance < 0 ? "text-danger" : ""}`}>
            {formatBalance(finance.balance)}
          </span>
          <span className={`text-xs ${LEVEL_TEXT[finance.budget?.level ?? "ok"]}`}>
            Keluar bulan ini {formatRupiah(finance.expense)}
            {finance.budget && ` dari ${formatRupiah(finance.budget.amount)}`}
          </span>
          <span className={`mt-1 rounded-md px-2 py-0.5 text-xs ${CHIP[chip.tone]}`}>{chip.text}</span>
        </>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Pakai di `src/dashboard/Dashboard.tsx`**

Tambahkan `import { FinanceCard } from "./FinanceCard";`, lalu ganti `{moduleCard("keuangan")}` dengan:

```tsx
        <FinanceCard finance={data?.finance} onSelect={onSelect} />
```

- [ ] **Step 5: Pemeriksaan**

Run: `bun run typecheck && bun run test`
Expected: typecheck exit 0 dan `0 fail`.

- [ ] **Step 6: Commit**

```bash
git add src/finance/view.ts src/finance/view.test.ts src/dashboard/FinanceCard.tsx src/dashboard/Dashboard.tsx
git commit -m "feat: show balance, spending and bills on the dashboard card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 18: Aksi palette "Catat transaksi"

**Files:**
- Modify: `src/palette/results.ts`, `src/palette/results.test.ts`, `src/palette/CommandPalette.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: `Page.intent` (Task 16).
- Produces:
  - `PaletteOption` mendapat varian `{ kind: "action"; id; label; sub; action: "new-transaction" }`.
  - Grup "Aksi cepat" tampil paling atas.
  - `CommandPalette` mendapat prop `onNewTransaction`.

- [ ] **Step 1: Perbarui test di `src/palette/results.test.ts`**

Ubah ekspektasi grup yang sudah ada:
- test "an empty query …": `["Aksi cepat", "Buka halaman", "Terbaru"]`, dan opsi halaman dibaca dari `groups[1]` (bukan `groups[0]`) serta item terbaru dari `groups[2]`;
- test "whitespace alone …": `["Aksi cepat", "Buka halaman", "Terbaru"]`;
- test "no recent items …": `["Aksi cepat", "Buka halaman"]`.

Test "filtering ignores case" (`KEU`) tidak berubah, karena "Catat transaksi" tidak mengandung "keu". E2E `check_palette` bergantung pada hal ini.

Tambahkan test:

```ts
  test("the quick action matches its label", () => {
    const groups = paletteResults("catat", recent);
    expect(groups[0]).toEqual({
      title: "Aksi cepat",
      options: [{ kind: "action", id: "action-new-transaction", label: "Catat transaksi", sub: "", action: "new-transaction" }],
    });
  });
```

Run: `TZ=Asia/Jakarta bun test src/palette/results.test.ts`
Expected: FAIL pada keempat test tersebut.

- [ ] **Step 2: Implementasi di `src/palette/results.ts`**

Tambahkan varian pertama di `PaletteOption`:

```ts
  | { kind: "action"; id: string; label: string; sub: string; action: "new-transaction" }
```

Tambahkan konstanta setelah `RECENT_IN_PALETTE`:

```ts
/** "Aksi cepat". `sub` stays empty so that typing a page name (e.g. "keu") never picks an action first. */
const ACTIONS: PaletteOption[] = [
  { kind: "action", id: "action-new-transaction", label: "Catat transaksi", sub: "", action: "new-transaction" },
];
```

Jadikan grup ini yang pertama di `groups`:

```ts
  const groups: PaletteGroup[] = [
    { title: "Aksi cepat", options: ACTIONS.filter(matches) },
    { title: "Buka halaman", options: pages.filter(matches) },
    { title: "Terbaru", options: items.filter(matches) },
  ];
```

- [ ] **Step 3: Jalankan aksi di `src/palette/CommandPalette.tsx`**

Tambahkan ikon di `OPTION_ICON`:

```tsx
  action: <path d="M4 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4zM4 7l10-3v3M16 13h1" />,
```

Tambahkan prop `onNewTransaction: () => void` di props dan tipe props. Lalu tambahkan cabang pertama di `run`:

```tsx
    if (option.kind === "action") {
      onNewTransaction();
      onClose();
    } else if (option.kind === "page") {
```

- [ ] **Step 4: Sambungkan di `src/App.tsx`**

Tambahkan `useRef` ke import React. Tambahkan di dalam `App`, setelah `const [contributionsVersion, …]`:

```tsx
  const intents = useRef(0);
```

Tambahkan setelah `const back = …`:

```tsx
  const newTransaction = () => setStack([{ name: "keuangan", intent: ++intents.current }]);
```

Teruskan ke palette:

```tsx
          onNewTransaction={newTransaction}
```

- [ ] **Step 5: Pemeriksaan**

Run: `bun run typecheck && bun run test`
Expected: typecheck exit 0 dan `0 fail`.

- [ ] **Step 6: Commit**

```bash
git add src/palette/results.ts src/palette/results.test.ts src/palette/CommandPalette.tsx src/App.tsx
git commit -m "feat: add the Catat transaksi palette action

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 19: E2E keuangan dan penutup PR F2-4

**Files:**
- Modify: `scripts/e2e-smoke.sh`

**Interfaces:**
- Produces: fungsi `add_account [shot]` (dipakai lagi di Task 22) dan `check_finance`.

- [ ] **Step 1: Tulis `add_account` dan `check_finance`**

Tambahkan di `scripts/e2e-smoke.sh`, setelah `check_notifications`:

```bash
# Opens the palette action "Catat transaksi" (the first option for "catat").
palette_new_transaction() {
  xdotool key ctrl+k
  sleep 0.3
  xdotool type --delay 20 'catat'
  xdotool key Return
  sleep 1
}

# With no account yet, the palette action opens the account form ("Buat akun dulu").
# Creates BCA (bank) with an opening balance of 1.000.000. Optional $1: screenshot of the form.
add_account() {
  palette_new_transaction
  if [[ -n "${1:-}" ]]; then shot "$1"; fi
  xdotool type --delay 20 'BCA'
  xdotool key Tab Tab   # Nama -> Jenis -> Saldo awal
  xdotool type --delay 20 '1000000'
  xdotool key Return
  sleep 1
  [[ "$(sql "SELECT i.title || ':' || a.kind || ':' || a.opening_balance FROM accounts a JOIN items i ON i.id = a.item_id")" = "BCA:bank:1000000" ]] \
    || fail "account not saved"
}

check_finance() {
  fresh
  start_app
  click 36 310                 # nav: Keuangan
  shot 10-finance-empty        # expect: four cards at Rp 0, six empty bars, "Belum ada akun"
  add_account 10-account-form  # expect: "Akun baru" with "Buat akun dulu", focus in Nama

  palette_new_transaction
  shot 10-transaction-form     # expect: Pengeluaran pressed, account BCA, today's date
  xdotool type --delay 20 '25.000'
  xdotool key Tab Tab          # Jumlah -> Akun -> Kategori
  xdotool type --delay 20 'Makan & minum'
  xdotool key Tab              # Keterangan
  xdotool type --delay 20 'Makan siang'
  xdotool key Return
  sleep 1
  [[ "$(sql "SELECT t.amount || ':' || t.category || ':' || i.title FROM transactions t JOIN items i ON i.id = t.item_id")" = "-25000:Makan & minum:Makan siang" ]] \
    || fail "expense not saved"

  click 820 200                # the Pengeluaran card opens the limit form
  xdotool type --delay 20 '200000'
  xdotool key Return
  sleep 1
  [[ "$(sql "SELECT b.amount FROM budgets b JOIN items i ON i.id = b.item_id WHERE i.deleted_at IS NULL")" = 200000 ]] \
    || fail "limit not saved"
  shot 10-finance              # expect: saldo Rp 975.000, Pengeluaran Rp 25.000 dari Rp 200.000, one row, BCA 100% saldo
  [[ "$(sql "SELECT COUNT(*) FROM items WHERE type = 'note'")" = 0 ]] || fail "finance forms must not create notes"

  click 36 94                  # nav: Dashboard
  shot 10-dashboard            # expect: Keuangan card Rp 975.000, "Keluar bulan ini Rp 25.000 dari Rp 200.000", "Tagihan aman"
  stop_app
}
```

Tambahkan `check_finance` di daftar pemanggilan di akhir script, setelah `check_notifications`.

- [ ] **Step 2: Ukur koordinat kartu Pengeluaran**

Run: `bun tauri build --debug --no-bundle && E2E_ONLY=check_finance scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`

Koordinat `click 820 200` sudah diukur dari build percobaan. Kalau gagal di "limit not saved", buka `~/.cache/anchoa-e2e/10-finance.png`, cari titik tengah kartu Pengeluaran, ganti koordinatnya, lalu jalankan lagi. Expected akhirnya: `PASS (check_finance)`.

- [ ] **Step 3: Pemeriksaan penuh**

Run: `scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`
Expected: `PASS`. Buka `10-finance.png`, `10-transaction-form.png`, `10-account-form.png`, dan `10-dashboard.png`, lalu cocokkan dengan `Keuangan.dc.html` dan `Main.dc.html`.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-smoke.sh
git commit -m "test: cover accounts, expenses and the spending limit end to end

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Penutup PR**

Jalankan "Prosedur penutup PR" dengan branch `feat/<N4>-f2-4-finance-page`, judul "F2-4: halaman Keuangan", dan `Closes #<N4>`. Screenshot: `10-finance-empty.png`, `10-account-form.png`, `10-transaction-form.png`, `10-finance.png`, `10-dashboard.png`, `3-nav-310.png`.

---

# PR F2-5: Tagihan di UI dan notifikasi

### Task 20: Bagian Tagihan, formulir, dan toast "Ubah"

**Files:**
- Modify: `src/shell/toast.tsx` (aksi di toast)
- Modify: `src/finance/view.ts`, `src/finance/view.test.ts` (`billStatusText`)
- Create: `src/finance/BillsSection.tsx`, `src/finance/BillForm.tsx`
- Modify: `src/finance/FinancePage.tsx`

**Interfaces:**
- Consumes: `api.listBills`, `saveBill`, `payBill`, `deleteBill` (Task 12), komponen formulir (Task 13).
- Produces:
  - `useToast()` menerima argumen ketiga opsional `action: ToastAction { label, run }`. Toast dengan aksi tampil 6 detik, dan tombolnya menutup toast.
  - `billStatusText(bill)`, `BillsSection({ bills, onAdd, onEdit, onPay })`, `BillForm({ edit?, accounts, onClose, onSaved })`.
  - Urutan fokus formulir tagihan (dipakai E2E): Nama → Jumlah → Dibayar dari → Pengulangan → Jatuh tempo → tombol.

- [ ] **Step 1: Buat branch**

```bash
git switch main && git pull && git switch -c feat/<N5>-f2-5-bills-ui
```

Kalau F2-4 belum di-merge, buat branch dari `feat/<N4>-f2-4-finance-page`.

- [ ] **Step 2: Tulis test yang gagal**

Tambahkan di `src/finance/view.test.ts`, dengan `billStatusText` ditambahkan ke import dari `./view`:

```ts
describe("billStatusText", () => {
  test("describes each status", () => {
    const sep28 = new Date(2026, 8, 28).getTime();
    const oct5 = new Date(2026, 9, 5).getTime();
    expect(billStatusText({ ...bill("Listrik", "overdue"), dueAt: sep28 })).toBe("Terlambat 1 hari · sejak 28 Sep");
    expect(billStatusText(bill("Air", "dueToday"))).toBe("Jatuh tempo hari ini");
    expect(billStatusText({ ...bill("Internet", "upcoming"), dueAt: oct5 })).toBe("Jatuh tempo 5 Okt");
    expect(billStatusText(bill("Gas", "paidToday"))).toBe("Lunas hari ini");
  });
});
```

Run: `TZ=Asia/Jakarta bun test src/finance/view.test.ts`
Expected: FAIL, dengan `Export named 'billStatusText' not found`.

- [ ] **Step 3: Implementasi `billStatusText`**

Tambahkan `import { shortDate } from "../format";` di `src/finance/view.ts`, lalu tambahkan di akhir file:

```ts
/** Second line of a bill row, e.g. "Terlambat 1 hari · sejak 28 Sep". */
export function billStatusText(b: BillView): string {
  if (b.status === "overdue") return `Terlambat ${b.daysLate} hari · sejak ${shortDate(b.dueAt)}`;
  if (b.status === "dueToday") return "Jatuh tempo hari ini";
  if (b.status === "paidToday") return "Lunas hari ini";
  return `Jatuh tempo ${shortDate(b.dueAt)}`;
}
```

Run: `TZ=Asia/Jakarta bun test src/finance/view.test.ts`
Expected: `7 pass, 0 fail`.

- [ ] **Step 4: Tulis ulang `src/shell/toast.tsx`**

```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Kind = "info" | "error";

/** A button inside the toast, e.g. "Ubah" after "Tandai lunas". */
export interface ToastAction {
  label: string;
  run: () => void;
}

type Toast = { id: number; text: string; kind: Kind; action?: ToastAction };
type Show = (text: string, kind?: Kind, action?: ToastAction) => void;

const PLAIN_MS = 3000;
/** Longer, so there is time to press the action. */
const ACTION_MS = 6000;

const ToastContext = createContext<Show>(() => {});
let nextId = 0;

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback<Show>(
    (text, kind = "info", action) => {
      const id = ++nextId;
      setToasts((list) => [...list, { id, text, kind, action }]);
      setTimeout(() => dismiss(id), action ? ACTION_MS : PLAIN_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-3 rounded-[10px] border px-4 py-2 text-sm ${
              t.kind === "error" ? "border-danger bg-danger-row text-danger" : "border-line bg-surface-2 text-ink"
            }`}
          >
            {t.text}
            {t.action && (
              <button
                onClick={() => {
                  t.action?.run();
                  dismiss(t.id);
                }}
                className="font-semibold text-accent hover:text-accent-hover"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
```

- [ ] **Step 5: Tulis `src/finance/BillsSection.tsx`**

```tsx
import type { BillView } from "../api";
import { formatRupiah } from "../money";
import { H2, PANEL } from "../shell/ui";
import { FinanceIcon } from "./icons";
import { billStatusText } from "./view";

function BillRow({
  bill: b,
  onEdit,
  onPay,
}: Readonly<{ bill: BillView; onEdit: (bill: BillView) => void; onPay: (bill: BillView) => void }>) {
  const late = b.status === "overdue";
  const payable = late || b.status === "dueToday";
  return (
    <div className={`flex items-center gap-2 rounded-lg px-2 py-2 ${late ? "bg-danger-row" : ""}`}>
      <button onClick={() => onEdit(b)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-warn">
          <FinanceIcon name="bill" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm">{b.name}</span>
          <span className={`text-xs ${late ? "text-danger" : "text-muted"}`}>{billStatusText(b)}</span>
        </span>
      </button>
      {payable && (
        <button
          onClick={() => onPay(b)}
          className="min-h-8 shrink-0 rounded-full bg-accent px-3 text-xs font-semibold text-canvas transition-transform hover:scale-105 active:scale-95"
        >
          Tandai lunas
        </button>
      )}
      {b.status === "upcoming" && <span className="shrink-0 font-mono text-sm">{formatRupiah(b.amount)}</span>}
      {b.status === "paidToday" && <span className="shrink-0 text-xs text-accent">✓ Lunas</span>}
    </div>
  );
}

/** "Tagihan": every unfinished bill, soonest first, with "Tandai lunas" once it is due (spec Fase 2 §5). */
export function BillsSection({
  bills,
  onAdd,
  onEdit,
  onPay,
}: Readonly<{ bills: BillView[]; onAdd: () => void; onEdit: (bill: BillView) => void; onPay: (bill: BillView) => void }>) {
  return (
    <section aria-labelledby="tagihan-judul" className={`${PANEL} flex flex-col gap-2`}>
      <div className="flex items-center justify-between">
        <h2 id="tagihan-judul" className={H2}>
          Tagihan
        </h2>
        <button onClick={onAdd} className="text-xs text-accent hover:text-accent-hover">
          + Tambah
        </button>
      </div>
      {bills.length === 0 && <p className="m-0 text-sm text-muted">Belum ada tagihan</p>}
      {bills.map((b) => (
        <BillRow key={b.id} bill={b} onEdit={onEdit} onPay={onPay} />
      ))}
    </section>
  );
}
```

- [ ] **Step 6: Tulis `src/finance/BillForm.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { api, type AccountView, type BillView, type Repeat } from "../api";
import { dateInputToMs, msToDateInput } from "../format";
import { formatDigits, parseRupiah } from "../money";
import { Dialog, DialogActions, Field } from "../shell/Dialog";
import { FIELD } from "../shell/ui";
import { AccountSelect, MoneyField, Segmented } from "./fields";
import { useSave } from "./useSave";

const REPEATS = [
  { value: "once", label: "Sekali" },
  { value: "monthly", label: "Bulanan" },
] as const;

/** Add or edit a bill. `accounts` must not be empty. */
export function BillForm({
  edit,
  accounts,
  onClose,
  onSaved,
}: Readonly<{ edit?: BillView; accounts: AccountView[]; onClose: () => void; onSaved: () => void }>) {
  const [name, setName] = useState(edit?.name ?? "");
  const [amount, setAmount] = useState(edit ? formatDigits(edit.amount) : "");
  const [account, setAccount] = useState(edit?.accountId ?? accounts[0].id);
  const [repeat, setRepeat] = useState<Repeat>(edit?.repeat ?? "monthly");
  const [due, setDue] = useState(msToDateInput(edit?.dueAt ?? Date.now()));
  const { busy, run, toast } = useSave(onSaved);

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = parseRupiah(amount);
    const dueAt = dateInputToMs(due);
    if (value === null || value <= 0) {
      toast("Jumlah harus angka bulat lebih dari 0", "error");
      return;
    }
    if (dueAt === null) {
      toast("Jatuh tempo wajib diisi", "error");
      return;
    }
    void run(() => api.saveBill({ id: edit?.id, name, amount: value, accountId: account, repeat, dueAt }));
  }

  const remove = edit ? () => void run(() => api.deleteBill(edit.id)) : undefined;

  return (
    <Dialog title={edit ? "Ubah tagihan" : "Tagihan baru"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Nama">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Listrik, Internet, Kos…" className={FIELD} />
        </Field>
        <MoneyField label="Jumlah" value={amount} onChange={setAmount} />
        <AccountSelect label="Dibayar dari" accounts={accounts} value={account} onChange={setAccount} />
        <Segmented label="Pengulangan" options={REPEATS} value={repeat} onChange={setRepeat} />
        <Field label="Jatuh tempo">
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={FIELD} />
        </Field>
        <DialogActions busy={busy} onCancel={onClose} onDelete={remove} />
      </form>
    </Dialog>
  );
}
```

- [ ] **Step 7: Tulis ulang `src/finance/FinancePage.tsx`**

Isinya sama dengan Task 16, ditambah data tagihan, `BillsSection` di kolom kanan, formulir tagihan, dan `pay` dengan toast "Ubah".

```tsx
import { useEffect, useState, type ReactNode } from "react";
import {
  api,
  errorMessage,
  type AccountView,
  type BillView,
  type Categories,
  type FinanceOverview,
  type TransactionView,
} from "../api";
import { addMonths, formatRupiah, monthLabel } from "../money";
import { useToast } from "../shell/toast";
import { H1, PRIMARY, SECONDARY } from "../shell/ui";
import { AccountForm } from "./AccountForm";
import { AccountsSection } from "./AccountsSection";
import { BillForm } from "./BillForm";
import { BillsSection } from "./BillsSection";
import { BudgetForm } from "./BudgetForm";
import { CashFlowChart } from "./CashFlowChart";
import { SummaryCards } from "./SummaryCards";
import { TransactionForm } from "./TransactionForm";
import { TransactionList } from "./TransactionList";

/** The form open over the page, if any. */
type OpenForm =
  | { form: "transaction"; edit?: TransactionView }
  | { form: "account"; edit?: AccountView }
  | { form: "bill"; edit?: BillView }
  | { form: "budget" }
  | null;

const MONTH_NAV =
  "flex h-8 w-8 items-center justify-center rounded-lg text-ink transition-colors hover:bg-surface-2 disabled:text-disabled disabled:hover:bg-transparent";

function Chevron({ d }: Readonly<{ d: string }>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Keuangan page (docs/design/artboards/Keuangan.dc.html, spec Fase 2 §5). */
export function FinancePage({ newTransaction, onChanged }: Readonly<{ newTransaction: boolean; onChanged: () => void }>) {
  const toast = useToast();
  const [month, setMonth] = useState<string | null>(null);
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [accounts, setAccounts] = useState<AccountView[] | null>(null);
  const [bills, setBills] = useState<BillView[] | null>(null);
  const [categories, setCategories] = useState<Categories | null>(null);
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState<OpenForm>(newTransaction ? { form: "transaction" } : null);

  useEffect(() => {
    api.financeOverview(month).then(setOverview, (e) => toast(errorMessage(e), "error"));
  }, [month, version, toast]);

  useEffect(() => {
    const fail = (e: unknown) => toast(errorMessage(e), "error");
    api.listAccounts().then(setAccounts, fail);
    api.listBills().then(setBills, fail);
    api.financeCategories().then(setCategories, fail);
  }, [version, toast]);

  if (!overview || !accounts || !bills) return <h1 className={H1}>Keuangan</h1>;

  const close = () => setOpen(null);
  const refresh = () => {
    setVersion((v) => v + 1);
    onChanged();
  };
  const saved = () => {
    setOpen(null);
    refresh();
  };
  const pay = (bill: BillView) =>
    api.payBill(bill.id).then(
      (paid) => {
        refresh();
        toast(`Tercatat ${formatRupiah(bill.amount)}`, "info", {
          label: "Ubah",
          run: () => setOpen({ form: "transaction", edit: paid }),
        });
      },
      (e) => toast(errorMessage(e), "error"),
    );

  const form = (): ReactNode => {
    if (open === null) return null;
    if (open.form === "account") return <AccountForm edit={open.edit} onClose={close} onSaved={saved} />;
    if (open.form === "budget") return <BudgetForm current={overview.budget?.amount ?? null} onClose={close} onSaved={saved} />;
    if (accounts.length === 0) return <AccountForm note="Buat akun dulu" onClose={close} onSaved={saved} />;
    if (open.form === "bill") return <BillForm edit={open.edit} accounts={accounts} onClose={close} onSaved={saved} />;
    return <TransactionForm edit={open.edit} accounts={accounts} categories={categories} onClose={close} onSaved={saved} />;
  };

  return (
    <>
      <div className="flex items-center gap-4">
        <h1 className={H1}>Keuangan</h1>
        <div className="flex items-center gap-1">
          <button aria-label="Bulan sebelumnya" onClick={() => setMonth(addMonths(overview.month, -1))} className={MONTH_NAV}>
            <Chevron d="M15 6l-6 6 6 6" />
          </button>
          <span aria-live="polite" className="min-w-[150px] text-center font-display text-base font-semibold">
            {monthLabel(overview.month)}
          </span>
          <button
            aria-label="Bulan berikutnya"
            disabled={overview.month >= overview.currentMonth}
            onClick={() => setMonth(addMonths(overview.month, 1))}
            className={MONTH_NAV}
          >
            <Chevron d="M9 6l6 6-6 6" />
          </button>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            disabled
            title="Hadir di Fase 5"
            className={`${SECONDARY} disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent`}
          >
            Catat lewat suara
          </button>
          <button onClick={() => setOpen({ form: "transaction" })} className={PRIMARY}>
            + Transaksi
          </button>
        </div>
      </div>
      <SummaryCards overview={overview} onBudget={() => setOpen({ form: "budget" })} />
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start gap-3.5">
        <div className="flex min-w-0 flex-col gap-3.5">
          <CashFlowChart chart={overview.chart} month={overview.month} onPick={setMonth} />
          <TransactionList until={overview.month} version={version} onEdit={(t) => setOpen({ form: "transaction", edit: t })} />
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <AccountsSection
            accounts={accounts}
            onAdd={() => setOpen({ form: "account" })}
            onEdit={(a) => setOpen({ form: "account", edit: a })}
          />
          <BillsSection
            bills={bills}
            onAdd={() => setOpen({ form: "bill" })}
            onEdit={(b) => setOpen({ form: "bill", edit: b })}
            onPay={(b) => void pay(b)}
          />
        </div>
      </div>
      {form()}
    </>
  );
}
```

- [ ] **Step 8: Pemeriksaan**

Run: `bun run typecheck && bun run test`
Expected: typecheck exit 0 dan `0 fail`.

- [ ] **Step 9: Commit**

```bash
git add src/shell/toast.tsx src/finance/view.ts src/finance/view.test.ts src/finance/BillsSection.tsx src/finance/BillForm.tsx src/finance/FinancePage.tsx
git commit -m "feat: add bills to the Keuangan page with one-click payment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 21: Ringkasan satu baris dan panel notifikasi

**Files:**
- Modify: `src/dashboard/summary.ts`, `src/dashboard/summary.test.ts`, `src/dashboard/Dashboard.tsx`
- Modify: `src/notifications/reminders.ts`, `src/notifications/reminders.test.ts`, `src/notifications/NotifPanel.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `FinanceSummary`, `BillView` (Task 12), `formatRupiah` (Task 11).
- Produces:
  - `summaryLine(today, inboxCount, lateBills)`.
  - `Reminder` = `{ kind: "task", id, task } | { kind: "bill", id, bill } | { kind: "budget", id, percent, over }`, `ReminderGroup { title, items }`.
  - `reminders(today, finance)`, `reminderCount(today, finance)`, `reminderText(reminder) -> { title, detail, tone: "danger" | "warn" | "muted" }`.
  - `NotifPanel` mendapat prop `finance` dan `onOpenFinance`.

- [ ] **Step 1: Tulis test yang gagal**

Di `src/dashboard/summary.test.ts`, tambahkan argumen `0` di kedua pemanggilan `summaryLine` yang sudah ada, lalu tambahkan:

```ts
  test("late bills sit after late tasks", () => {
    expect(summaryLine([task(true), task(false)], 2, 1)).toBe(
      "2 tugas hari ini · 1 terlambat · 1 tagihan terlambat · 2 catatan di Inbox",
    );
  });
```

Tulis ulang `src/notifications/reminders.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { BillView, DayTask, FinanceSummary } from "../api";
import { reminderCount, reminders, reminderText } from "./reminders";

const task = (id: string, overdue: boolean, completedAt: number | null = null): DayTask => ({
  id,
  title: id,
  dueAt: 0,
  completedAt,
  overdue,
});

const bill = (id: string, status: BillView["status"]): BillView => ({
  id,
  name: id,
  amount: 150000,
  accountId: "a",
  accountName: "BCA",
  repeat: "monthly",
  dueAt: 0,
  status,
  daysLate: status === "overdue" ? 2 : 0,
});

const finance = (dueBills: BillView[], budget: FinanceSummary["budget"] = null, expense = 0): FinanceSummary => ({
  hasAccounts: true,
  balance: 0,
  expense,
  budget,
  dueBills,
});

const ids = (groups: ReturnType<typeof reminders>) => groups.map((g) => [g.title, g.items.map((r) => r.id)]);

describe("reminders", () => {
  test("splits open tasks into late and due today, skipping done ones", () => {
    const today = [task("late", true), task("late-done", true, 5), task("today", false), task("today-done", false, 5)];
    expect(ids(reminders(today, null))).toEqual([
      ["Terlambat", ["late"]],
      ["Hari ini", ["today"]],
    ]);
    expect(reminderCount(today, null)).toBe(2);
  });

  test("empty groups are left out", () => {
    expect(reminders([task("today", false)], null).map((g) => g.title)).toEqual(["Hari ini"]);
    expect(reminders([], null)).toEqual([]);
    expect(reminderCount([], finance([]))).toBe(0);
  });

  test("bills join the tasks by status", () => {
    const groups = reminders([task("late", true)], finance([bill("listrik", "overdue"), bill("air", "dueToday")]));
    expect(ids(groups)).toEqual([
      ["Terlambat", ["late", "listrik"]],
      ["Hari ini", ["air"]],
    ]);
  });

  test("the monthly limit shows from 80%", () => {
    expect(ids(reminders([], finance([], { amount: 200000, level: "warn" }, 175000)))).toEqual([["Hari ini", ["budget"]]]);
    expect(reminders([], finance([], { amount: 200000, level: "ok" }, 100000))).toEqual([]);
    const [group] = reminders([], finance([], { amount: 200000, level: "over" }, 250000));
    expect(group.items[0]).toEqual({ kind: "budget", id: "budget", percent: 125, over: true });
  });
});

describe("reminderText", () => {
  test("describes tasks, bills and the limit", () => {
    expect(reminderText({ kind: "task", id: "a", task: task("Bayar kos", false) })).toEqual({
      title: "Bayar kos",
      detail: "Jatuh tempo hari ini",
      tone: "muted",
    });
    expect(reminderText({ kind: "bill", id: "l", bill: bill("Listrik", "overdue") })).toEqual({
      title: "Listrik",
      detail: "Terlambat 2 hari · Rp 150.000",
      tone: "danger",
    });
    expect(reminderText({ kind: "budget", id: "budget", percent: 88, over: false })).toEqual({
      title: "Batas pengeluaran",
      detail: "Pengeluaran 88% dari batas",
      tone: "warn",
    });
  });
});
```

Run: `bun run test`
Expected: FAIL di `summary.test.ts` (baris baru) dan `reminders.test.ts` (fungsi dan bentuk baru).

- [ ] **Step 2: Implementasi `summaryLine`**

Tulis ulang `src/dashboard/summary.ts`:

```ts
import type { DayTask } from "../api";

/** One line under the greeting, e.g. "3 tugas hari ini · 1 terlambat · 1 tagihan terlambat · 2 catatan di Inbox". */
export function summaryLine(today: DayTask[], inboxCount: number, lateBills: number): string {
  const open = today.filter((t) => t.completedAt === null);
  const late = open.filter((t) => t.overdue).length;
  const parts = [open.length === 0 ? "Tidak ada tugas tersisa hari ini" : `${open.length} tugas hari ini`];
  if (late > 0) parts.push(`${late} terlambat`);
  if (lateBills > 0) parts.push(`${lateBills} tagihan terlambat`);
  parts.push(inboxCount === 0 ? "Inbox kosong" : `${inboxCount} catatan di Inbox`);
  return parts.join(" · ");
}
```

Di `src/dashboard/Dashboard.tsx`, ganti pemanggilannya:

```tsx
          <p className="m-0 truncate text-sm text-muted">
            {data
              ? summaryLine(data.today, data.inboxCount, data.finance.dueBills.filter((b) => b.status === "overdue").length)
              : " "}
          </p>
```

- [ ] **Step 3: Tulis ulang `src/notifications/reminders.ts`**

```ts
import type { BillView, DayTask, FinanceSummary } from "../api";
import { shortDate } from "../format";
import { formatRupiah } from "../money";

export type Reminder =
  | { kind: "task"; id: string; task: DayTask }
  | { kind: "bill"; id: string; bill: BillView }
  | { kind: "budget"; id: string; percent: number; over: boolean };

export interface ReminderGroup {
  title: "Terlambat" | "Hari ini";
  items: Reminder[];
}

export type Tone = "danger" | "warn" | "muted";

const fromTask = (task: DayTask): Reminder => ({ kind: "task", id: task.id, task });
const fromBill = (bill: BillView): Reminder => ({ kind: "bill", id: bill.id, bill });

/** The monthly limit, once 80% of it is spent. */
function limitReminder(finance: FinanceSummary | null): Reminder[] {
  const budget = finance?.budget;
  if (!finance || !budget || budget.level === "ok") return [];
  const percent = Math.round((finance.expense * 100) / budget.amount);
  return [{ kind: "budget", id: "budget", percent, over: budget.level === "over" }];
}

/**
 * Notification panel content until modules store their own notifications (spec UI lanjutan U6,
 * Fase 2 §5): open tasks and bills that are late or due today, then the monthly limit.
 */
export function reminders(today: DayTask[], finance: FinanceSummary | null): ReminderGroup[] {
  const open = today.filter((t) => t.completedAt === null);
  const bills = finance?.dueBills ?? [];
  const groups: ReminderGroup[] = [
    {
      title: "Terlambat",
      items: [...open.filter((t) => t.overdue).map(fromTask), ...bills.filter((b) => b.status === "overdue").map(fromBill)],
    },
    {
      title: "Hari ini",
      items: [
        ...open.filter((t) => !t.overdue).map(fromTask),
        ...bills.filter((b) => b.status === "dueToday").map(fromBill),
        ...limitReminder(finance),
      ],
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

export function reminderCount(today: DayTask[], finance: FinanceSummary | null): number {
  return reminders(today, finance).reduce((n, g) => n + g.items.length, 0);
}

/** Title and detail line of one reminder card. */
export function reminderText(r: Reminder): { title: string; detail: string; tone: Tone } {
  if (r.kind === "task") {
    const title = r.task.title || "Tanpa judul";
    return r.task.overdue
      ? { title, detail: `Terlambat · jatuh tempo ${shortDate(r.task.dueAt)}`, tone: "danger" }
      : { title, detail: "Jatuh tempo hari ini", tone: "muted" };
  }
  if (r.kind === "bill") {
    const late = r.bill.status === "overdue";
    const when = late ? `Terlambat ${r.bill.daysLate} hari` : "Jatuh tempo hari ini";
    return { title: r.bill.name, detail: `${when} · ${formatRupiah(r.bill.amount)}`, tone: late ? "danger" : "muted" };
  }
  return { title: "Batas pengeluaran", detail: `Pengeluaran ${r.percent}% dari batas`, tone: r.over ? "danger" : "warn" };
}
```

- [ ] **Step 4: Tulis ulang `src/notifications/NotifPanel.tsx`**

```tsx
import { useEffect, useRef } from "react";
import type { DayTask, FinanceSummary } from "../api";
import { reminders, reminderText, type Reminder, type Tone } from "./reminders";

const TONE: Record<Tone, string> = { danger: "text-danger", warn: "text-warn", muted: "text-muted" };

function ReminderCard({ reminder, onOpen }: Readonly<{ reminder: Reminder; onOpen: () => void }>) {
  const text = reminderText(reminder);
  return (
    <div className="flex flex-col gap-1 rounded-[10px] bg-surface px-2.5 py-2.5">
      <span className="text-[13px] font-semibold">{text.title}</span>
      <span className={`text-xs ${TONE[text.tone]}`}>{text.detail}</span>
      <button onClick={onOpen} aria-label={`Buka ${text.title}`} className="self-end text-xs text-accent hover:text-accent-hover">
        Buka ›
      </button>
    </div>
  );
}

/** Panel beside the nav rail (docs/design/artboards/NotifPanel.dc.html, spec UI lanjutan U6, Fase 2 §5). */
export function NotifPanel({
  today,
  finance,
  onClose,
  onOpenItem,
  onOpenFinance,
}: Readonly<{
  today: DayTask[];
  finance: FinanceSummary | null;
  onClose: () => void;
  onOpenItem: (id: string) => void;
  onOpenFinance: () => void;
}>) {
  const groups = reminders(today, finance);
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  // Focus the panel, then give focus back to the bell when it closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previous?.focus();
  }, []);

  const open = (r: Reminder) => {
    if (r.kind === "task") onOpenItem(r.task.id);
    else onOpenFinance();
    onClose();
  };

  return (
    <div
      className="fixed inset-y-0 right-0 left-[72px] z-40"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if (e.key === "Tab") {
          // aria-modal: keep Tab inside the panel.
          const buttons = panel.current?.querySelectorAll<HTMLButtonElement>("button");
          if (!buttons?.length) return;
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <button aria-label="Tutup panel notifikasi" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-[#05070a]/60" />
      <aside
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notif-title"
        data-anim
        style={{ animation: "anchoa-slide 0.18s ease-out" }}
        className="absolute inset-y-0 left-0 flex w-[400px] outline-none flex-col border-r border-[#2e3440] bg-stage shadow-[16px_0_40px_rgb(0_0_0/0.4)]"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-[18px] pt-5 pb-3">
          <h2 id="notif-title" className="m-0 font-display text-xl font-semibold">
            Notifikasi
          </h2>
          <span className={`rounded-full px-2 py-px font-mono text-[11px] text-canvas ${count > 0 ? "bg-accent" : "bg-disabled"}`}>{count}</span>
          <button
            ref={closeButton}
            onClick={onClose}
            aria-label="Tutup"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-1 pb-3">
          {groups.map((g) => (
            <section key={g.title} aria-label={g.title} className="flex flex-col gap-1">
              <h3 className="m-0 px-2 pt-3 pb-0.5 text-[11px] font-normal tracking-[0.08em] text-muted uppercase">{g.title}</h3>
              {g.items.map((r) => (
                <ReminderCard key={`${r.kind}-${r.id}`} reminder={r} onOpen={() => open(r)} />
              ))}
            </section>
          ))}
          {count === 0 && <p className="m-0 px-4 py-12 text-center text-[13px] text-muted">Tidak ada pengingat.</p>}
        </div>

        <p className="m-0 border-t border-line px-[18px] py-3 text-xs text-muted">
          Pengingat dari tugas, tagihan, dan batas pengeluaran. Notifikasi lain menyusul bersama modulnya.
        </p>
      </aside>
    </div>
  );
}
```

- [ ] **Step 5: Sambungkan di `src/App.tsx`**

Ganti prop `reminders` di `Sidebar`:

```tsx
        reminders={reminderCount(data?.today ?? [], data?.finance ?? null)}
```

Ganti pemakaian `NotifPanel`:

```tsx
      {overlay === "notifications" && (
        <NotifPanel
          today={data?.today ?? []}
          finance={data?.finance ?? null}
          onClose={() => setOverlay(null)}
          onOpenItem={openItem}
          onOpenFinance={() => go("keuangan")}
        />
      )}
```

- [ ] **Step 6: Pemeriksaan**

Run: `bun run typecheck && bun run test`
Expected: typecheck exit 0 dan `0 fail`.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/summary.ts src/dashboard/summary.test.ts src/dashboard/Dashboard.tsx src/notifications src/App.tsx
git commit -m "feat: remind about late bills and the spending limit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 22: E2E tagihan, versi 0.2.0, dan penutup PR F2-5

**Files:**
- Modify: `scripts/e2e-smoke.sh`
- Modify: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `README.md` (versi 0.2.0)
- Modify: `CLAUDE.md` (baris Status)

**Interfaces:**
- Consumes: `add_account` (Task 19).

- [ ] **Step 1: Tulis `check_bills`**

Tambahkan di `scripts/e2e-smoke.sh`, setelah `check_finance`:

```bash
check_bills() {
  fresh
  start_app
  click 36 310                 # nav: Keuangan
  add_account
  shot 11-finance-account      # measure "+ Tambah" of Tagihan and the first bill row from here
  click 1207 461               # Tagihan: + Tambah (no limit set, so the cards are 12px shorter than in check_finance)
  shot 11-bill-form            # expect: "Tagihan baru", Bulanan pressed, due today
  xdotool type --delay 20 'Listrik'
  xdotool key Tab              # Nama -> Jumlah
  xdotool type --delay 20 '150000'
  xdotool key Return
  sleep 1
  [[ "$(sql "SELECT i.title || ':' || b.amount || ':' || b.repeat FROM bills b JOIN items i ON i.id = b.item_id")" = "Listrik:150000:monthly" ]] \
    || fail "bill not saved"
  sql "UPDATE items SET due_at = CAST(strftime('%s', 'now', 'localtime', 'start of day', '-1 day', 'utc') AS INTEGER) * 1000 WHERE type = 'bill'"

  click 36 94                  # nav: Dashboard reloads the data behind the bell
  shot 11-dashboard-late       # expect: "· 1 tagihan terlambat", chip "1 terlambat", coral dot on the bell
  click 36 652                 # bell
  shot 11-notif-bill           # expect: "Listrik" under Terlambat, "Terlambat 1 hari · Rp 150.000"
  xdotool key Escape
  sleep 0.3
  click 36 310                 # nav: Keuangan
  shot 11-bill-late            # expect: Listrik row on coral, "Terlambat 1 hari · sejak <yesterday>", "Tandai lunas"
  before=$(sql "SELECT due_at FROM items WHERE type = 'bill'")
  click 1177 508               # Tandai lunas on the first bill row
  sleep 1
  shot 11-bill-paid            # expect: "Lunas hari ini", toast "Tercatat Rp 150.000" with "Ubah"
  [[ "$(sql "SELECT amount || ':' || category FROM transactions WHERE bill_id IS NOT NULL")" = "-150000:Tagihan" ]] \
    || fail "payment not recorded"
  after=$(sql "SELECT due_at FROM items WHERE type = 'bill'")
  (( after - before >= 28 * 86400000 )) || fail "due date did not move a month ahead"
  stop_app
}
```

Tambahkan `check_bills` di daftar pemanggilan di akhir script, setelah `check_finance`.

- [ ] **Step 2: Ukur koordinat**

Run: `bun tauri build --debug --no-bundle && E2E_ONLY=check_bills scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`

Koordinat di atas sudah diukur dari build percobaan. Kalau gagal di "bill not saved", buka `~/.cache/anchoa-e2e/11-finance-account.png`, cari titik tengah "+ Tambah" di bagian Tagihan, lalu ganti `click 1207 461`. Kalau gagal di "payment not recorded", buka `11-bill-late.png`, cari tombol "Tandai lunas", lalu ganti `click 1177 508`. Expected akhirnya: `PASS (check_bills)`.

- [ ] **Step 3: Naikkan versi ke 0.2.0**

Ganti `"version": "0.1.0"` menjadi `"version": "0.2.0"` di `package.json` dan `src-tauri/tauri.conf.json`, serta `version = "0.1.0"` menjadi `version = "0.2.0"` di bagian `[package]` di `src-tauri/Cargo.toml`. Di `README.md`, ganti `Anchoa-0.1.0-1.x86_64.rpm` menjadi `Anchoa-0.2.0-1.x86_64.rpm`. Lalu jalankan `cd src-tauri && cargo build && cd ..` supaya `Cargo.lock` ikut diperbarui.

- [ ] **Step 4: Perbarui Status di `CLAUDE.md`**

Ganti paragraf yang diawali `Status:` dengan:

```markdown
Status: Fase 1 (v0.1.0) and Fase 2, Keuangan (v0.2.0 once F2-5 merges), are built. Next is Fase 3 (Task & Project + Jadwal): write its spec and plan first.
```

- [ ] **Step 5: Pemeriksaan penuh**

Jalankan semua perintah pemeriksaan di Global Constraints.
Expected: typecheck exit 0, `0 fail`, `0 failed`, `clippy 0`, dan `PASS`.

- [ ] **Step 6: Commit**

```bash
git add scripts/e2e-smoke.sh package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json README.md CLAUDE.md
git commit -m "test: cover bills end to end; bump version to 0.2.0

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Penutup PR**

Jalankan "Prosedur penutup PR" dengan branch `feat/<N5>-f2-5-bills-ui`, judul "F2-5: tagihan di UI dan notifikasi", dan `Closes #<N5>`. Screenshot: `11-bill-form.png`, `11-dashboard-late.png`, `11-notif-bill.png`, `11-bill-late.png`, `11-bill-paid.png`.

### Task 23: Rilis v0.2.0 (setelah user me-merge F2-5)

- [ ] **Step 1: Build dari `main`**

```bash
git switch main && git pull
bun tauri build
scripts/e2e-smoke.sh src-tauri/target/release/anchoa
```

Expected: `Anchoa-0.2.0-1.x86_64.rpm` terbentuk, lalu `PASS`.

- [ ] **Step 2: Cek instalasi (user)**

Minta user menjalankan di terminal biasa (`sudo` butuh password):

```bash
sudo dnf install ./src-tauri/target/release/bundle/rpm/Anchoa-0.2.0-1.x86_64.rpm
```

Lalu minta user memastikan di layar asli:
1. DB lama naik ke versi 4, dan `anchoa.db.bak-v3` ada di `~/.local/share/io.github.syharipf.anchoa/`.
2. Halaman Keuangan tampil normal.
3. Catatan dan tugas lama masih ada.

- [ ] **Step 3: GitHub Release dan milestone**

Setelah user mengonfirmasi:

```bash
gh release create v0.2.0 src-tauri/target/release/bundle/rpm/Anchoa-0.2.0-1.x86_64.rpm \
  --target main --title "Anchoa v0.2.0 — Fase 2: Keuangan" \
  --notes "Halaman Keuangan: beberapa akun, pengeluaran, pemasukan, dan transfer; kartu bulanan dan grafik arus kas 6 bulan; tagihan sekali atau bulanan dengan Tandai lunas; batas pengeluaran bulanan. Kartu Keuangan di dashboard, pengingat tagihan di panel notifikasi, dan aksi Catat transaksi di command palette. Fedora x86_64."
gh api -X PATCH repos/Syharipf/Anchoa/milestones/$(gh api repos/Syharipf/Anchoa/milestones --jq '.[] | select(.title == "Fase 2") | .number') -f state=closed
```

---

## Cakupan spec

| Spec | Task |
|---|---|
| K1, K2: IDR, integer rupiah | 1, 11 |
| K3: beberapa akun, empat jenis | 3, 14, 15 |
| K4: saldo sampai hari ini, label "terjadwal" | 3, 6, 15 |
| K5: transfer dua baris | 6, 15 |
| K6: kategori teks bebas dengan saran | 6, 15 |
| K7: tanggal 00:00 lokal | 6, 9, 15 |
| K8: akun terpakai tidak bisa dihapus | 3, 6, 9 |
| K9: daftar catatan hanya `note` | 2 |
| K10: tagihan sekali/bulanan, "Tandai lunas" satu klik, toast "Ubah" | 9, 20 |
| K11: satu batas total, hanya peringatan | 7, 14, 15, 17, 21 |
| K12: aksi palette "Catat transaksi" | 18 |
| §3 model data dan migrasi 004, `.bak-v3` | 1 |
| §3 aturan hitung (saldo, bulan, grafik, porsi, tingkat batas) | 3, 7, 12 |
| §3 status tagihan dan pelunasan | 9 |
| §4 command dan validasi | 3–10 |
| §4 `finance` di `get_dashboard` | 10 |
| §5 halaman Keuangan (header, kartu, grafik, transaksi, akun, tagihan, kosong) | 14–16, 20 |
| §5 formulir dan format uang | 11, 13, 15, 20 |
| §5 kartu dashboard, ringkasan satu baris, panel notifikasi, palette | 17, 18, 21 |
| §6 error handling (atomik, formulir tetap terbuka) | 6, 9, 13 |
| §7 testing (Rust, frontend, E2E) | semua task, E2E di 19 dan 22 |
| §8 kriteria selesai | 19, 22, 23 |
