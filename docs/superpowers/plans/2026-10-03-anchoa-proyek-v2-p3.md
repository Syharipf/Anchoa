# Anchoa Proyek v2 — P-3 Terhubung: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementasi utama oleh Codex gpt-6.1-sol xhigh (`codex exec -s workspace-write`, satu task per run). Kalau kuotanya habis, pakai `agy-multi --model gemini-3.8-flash-high`. Review oleh agy dan Sol, lalu dicek sesi Opus.

**Goal:** proyek terhubung ke uang (transaksi + anggaran), ke repo GitHub (commit terakhir, issue, PR), dan ke item lain lewat tautan `[[...]]` di catatan tugas.

**Architecture:** satu migrasi menambah `transactions.project_id`, `projects.budget`, dan tabel cache lokal `repo_status`, sekaligus membuat ulang dua trigger sync yang menyebut kolomnya. `finance.rs` dan `projects.rs` membawa kolom baru; `github.rs` mendapat fungsi status repo REST (pakai `ureq` yang sudah ada, jaringan di `spawn_blocking`, tanpa memegang kunci DB); `links.rs` mendapat `outgoing`. Frontend memakai `linkQuery`/`insertLink` milik Catatan dan `api.searchItems` untuk autocomplete.

**Tech Stack:** Rust + rusqlite + ureq 3, React + TypeScript, bun test, Xvfb E2E.

**Spec:** `docs/superpowers/specs/2026-10-03-anchoa-proyek-v2-design.md` (R11–R13, R18, §3, §4).

> **Baca dulu:** plan ini ditulis terhadap `main` sebelum J-1..J-4, P-1, dan P-2 di-merge. P-1 (prioritas, filter, `restore_task`) dan P-2 (arsip proyek, banyak tag, `recur`) masuk lebih dulu dan menyentuh file yang sama (`projects.rs`, `tasks.rs`, `sync/record.rs`, migrasi, `ProjectHeader.tsx`, `ProjectForm.tsx`, `ItemPage.tsx`, `api.ts`). Sebelum setiap task, baca ulang file yang disebut di task itu di `main` terbaru dan sesuaikan nomor baris, nomor migrasi, daftar kolom, dan definisi trigger. Kalau P-2 sudah menambah `archived_at` ke trigger `sync_projects_update`, pertahankan kolom itu saat membuat ulang trigger.

## Menjalankan task dengan agy

Satu task per run, di branch PR yang sedang dikerjakan, dari root worktree:

```bash
agy-multi --model gemini-3.8-flash-high --dangerously-skip-permissions --print-timeout 2100s -p "Implement Task <N> of docs/superpowers/plans/2026-10-03-anchoa-proyek-v2-p3.md exactly as written, test first, including its tests and its commit. Read the spec docs/superpowers/specs/2026-10-03-anchoa-proyek-v2-design.md. Follow CLAUDE.md, including the SonarCloud conventions. Rules: work only inside this repository; do not push, merge, open PRs, change git remotes or branches; do not open URLs; do not edit docs/. Stage files by explicit path, never git add -A. Before committing run the task's checks and fix every failure. When done, print the tail of each check and the commit hash."
```

Setelah setiap run, sesi Opus menjalankan test task itu dan membaca diff commit-nya. Review PR memakai Codex dan agy (`CLAUDE.md`, "Model per step").

## Global Constraints

- Semua aturan di `CLAUDE.md` berlaku. Frontend hanya lewat `src/api.ts`. Delete = soft delete; setiap query menyaring `deleted_at IS NULL`.
- Uang selalu integer minor units (rupiah utuh), tidak pernah float.
- Command mengembalikan `Result<T, AppError>`, tanpa panic. Pesan error Bahasa Indonesia.
- `Db::conn()` adalah guard `std::sync::Mutex`: jangan memegangnya selama request jaringan atau melewati `.await`.
- Test tidak boleh menyentuh jaringan: fungsi parse dites dengan JSON fixture. E2E juga tidak boleh bergantung pada jaringan.
- SonarCloud: props `Readonly<...>`, elemen non-tombol dengan `onClick` butuh handler keyboard, tanpa `Math.random()`, `[[ ... ]]` di bash.
- Teks UI Bahasa Indonesia, tanpa kata "Fase".
- Tanpa dependency baru (Rust maupun JS). Tanpa bump versi (rilis setelah P-4).
- Sesi ini hanya mengerjakan P-3. P-4 dikerjakan di sesi Claude Code lain.

| PR | Task |
|---|---|
| P-3 (#147, milestone "Proyek v2") | 1–4 |

---

### Task 1: Backend — transaksi per proyek dan anggaran (R11)

**Files:**
- Create: `src-tauri/migrations/016_project_links.sql` (pakai nomor berikutnya kalau `016` sudah dipakai di `main`; nama file boleh tetap `_project_links`)
- Modify: `src-tauri/src/db.rs` (daftar `include_str!` migrasi)
- Modify: `src-tauri/src/finance.rs` (`TransactionView`, `TransactionInput`, `TRANSACTION_SELECT`, `transaction_from_row`, `save_transaction`, tests)
- Modify: `src-tauri/src/tasks.rs:162` (`validate_project` menjadi `pub(crate)`)
- Modify: `src-tauri/src/projects.rs` (`ProjectDetail`, `ProjectInput`, `RawProject`, `PROJECT_SELECT`, `raw_from_row`, `build_detail`, `save_project`, `delete_project`, tests)
- Modify: `src-tauri/src/sync/record.rs:22-52` (kolom `EXTENSIONS`) dan fixture test posisional di sekitar baris 459–476
- Modify: `src-tauri/src/assistant/tools.rs` (schema dan daftar argumen `add_transaction`, tests)

**Interfaces:**
- Produces (Rust): `TransactionView.project_id: Option<String>`; `TransactionInput.project_id: Option<String>`; `ProjectDetail.budget: Option<i64>`, `ProjectDetail.spent: i64`; `ProjectInput.budget: Option<i64>`; `pub(crate) fn tasks::validate_project(conn: &Connection, project_id: &str) -> Result<(), AppError>`.
- Produces (JSON): `TransactionView.projectId`, `TransactionInput.projectId`, `ProjectDetail.budget`, `ProjectDetail.spent`, `ProjectInput.budget`; tool asisten `add_transaction` menerima `projectId`.
- Produces (DB): tabel `repo_status (project_id TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL, json TEXT NOT NULL)`, dipakai Task 2.

- [ ] **Step 1: Migrasi**

```sql
-- 016_project_links.sql (Proyek v2 R11, R12)
ALTER TABLE transactions ADD COLUMN project_id TEXT REFERENCES items(id);
ALTER TABLE projects ADD COLUMN budget INTEGER;   -- rupiah, NULL = tanpa anggaran
CREATE INDEX transactions_project ON transactions(project_id);

-- Local cache of GitHub repo status (R12). No sync trigger: it never leaves the device.
CREATE TABLE repo_status (
  project_id TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  json       TEXT NOT NULL
);

-- The sync update triggers name their columns (spec §3), so drop and recreate them
-- with the new ones. P-2 already added archived_at to sync_projects_update; keep it.
-- Check the newest definition first:
--   grep -n 'CREATE TRIGGER sync_projects_update' src-tauri/migrations/*.sql | tail -1
DROP TRIGGER sync_projects_update;
-- agent, agent_command and agent_dir are per-device and stay local.
CREATE TRIGGER sync_projects_update AFTER UPDATE OF item_id, kind, deadline_at, repo_url, archived_at, budget ON projects
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND (old.item_id IS NOT new.item_id OR old.kind IS NOT new.kind OR old.deadline_at IS NOT new.deadline_at OR old.repo_url IS NOT new.repo_url OR old.archived_at IS NOT new.archived_at OR old.budget IS NOT new.budget)
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

DROP TRIGGER sync_transactions_update;
CREATE TRIGGER sync_transactions_update AFTER UPDATE ON transactions
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND (old.item_id IS NOT new.item_id OR old.account_id IS NOT new.account_id OR old.amount IS NOT new.amount OR old.category IS NOT new.category OR old.occurred_at IS NOT new.occurred_at OR old.transfer_id IS NOT new.transfer_id OR old.bill_id IS NOT new.bill_id OR old.project_id IS NOT new.project_id)
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;
```

Tambahkan `include_str!("../migrations/016_project_links.sql"),` setelah migrasi terakhir di `db.rs`.

Kalau P-2 ternyata belum menambah `archived_at` (cek dengan grep di atas), hapus `archived_at` dari trigger ini; jangan menambah kolom yang tidak ada di tabel.

Di `sync/record.rs`:
- extension `project`: `columns: &["item_id", "kind", "deadline_at", "repo_url", "archived_at", "budget"]` (urutan dan isi mengikuti daftar setelah P-2, ditambah `budget`).
- extension `transaction`: `columns: &["item_id", "account_id", "amount", "category", "occurred_at", "transfer_id", "bill_id", "project_id"]`, `references: &["account_id", "bill_id", "project_id"]`.
- Fixture test `EXTENSIONS` yang memakai `INSERT INTO ... VALUES (...)` posisional untuk `projects` dan `transactions` harus menyebut kolomnya, karena tabelnya kini punya kolom tambahan:

```rust
"INSERT INTO projects (item_id, kind, deadline_at, repo_url, agent, agent_command, agent_dir) VALUES ('project', 'app', 90, 'https://example.test/repo', 1, 'local command', '/local/repo')",
// ...
"INSERT INTO transactions (item_id, account_id, amount, category, occurred_at, transfer_id, bill_id) VALUES ('transaction', 'account', -500, 'Makan', 42, 'transfer', 'bill')",
```

- [ ] **Step 2: Tulis test yang gagal**

Di `mod tests` `projects.rs` (tambahkan `use crate::finance::{self, TransactionInput, TransactionKind, testing::account};`):

```rust
#[test]
fn spent_counts_live_expenses_of_the_project_only() {
    let conn = open_in_memory();
    let tz = jakarta();
    let input = ProjectInput { name: "Proyek".into(), budget: Some(100_000), ..Default::default() };
    let p = save_project(&conn, &input, now(), &tz).unwrap();
    assert_eq!((p.budget, p.spent), (Some(100_000), 0));
    let pid = p.summary.id.clone();
    let kas = account(&conn, "Kas", 1_000_000);
    let bank = account(&conn, "Bank", 0);
    let save = |kind: TransactionKind, amount: i64, project: Option<&str>| {
        let input = TransactionInput {
            kind,
            amount,
            account_id: kas.clone(),
            occurred_at: now(),
            title: "x".into(),
            project_id: project.map(str::to_string),
            ..Default::default()
        };
        finance::save_transaction(&conn, &input, now(), &tz).unwrap()
    };
    let counted = save(TransactionKind::Expense, 60_000, Some(pid.as_str()));
    assert_eq!(counted.project_id.as_deref(), Some(pid.as_str()));
    let deleted = save(TransactionKind::Expense, 5_000, Some(pid.as_str()));
    finance::delete_transaction(&conn, &deleted.id, now(), &tz).unwrap();
    save(TransactionKind::Income, 70_000, Some(pid.as_str())); // income is not spending
    save(TransactionKind::Expense, 9_000, None); // not in the project
    finance::testing::transfer(&conn, &kas, &bank, 4_000, "2026-09-29T09:00:00+07:00");

    let p = get_project(&conn, &pid, now(), &tz).unwrap();
    assert_eq!((p.budget, p.spent), (Some(100_000), 60_000));
}

#[test]
fn budget_must_be_positive_and_transactions_need_a_live_project() {
    let conn = open_in_memory();
    let tz = jakarta();
    for budget in [0, -5] {
        let input = ProjectInput { name: "P".into(), budget: Some(budget), ..Default::default() };
        assert!(matches!(save_project(&conn, &input, now(), &tz), Err(AppError::Invalid(_))));
    }
    let kas = account(&conn, "Kas", 0);
    let input = TransactionInput {
        kind: TransactionKind::Expense,
        amount: 1,
        account_id: kas,
        occurred_at: now(),
        title: "x".into(),
        project_id: Some("missing".into()),
        ..Default::default()
    };
    assert!(matches!(finance::save_transaction(&conn, &input, now(), &tz), Err(AppError::Invalid(_))));
}

#[test]
fn editing_moves_a_transaction_and_deleting_a_project_detaches_it() {
    let conn = open_in_memory();
    let tz = jakarta();
    let a = save_project(&conn, &ProjectInput { name: "A".into(), ..Default::default() }, now(), &tz).unwrap();
    let b = save_project(&conn, &ProjectInput { name: "B".into(), ..Default::default() }, now(), &tz).unwrap();
    let kas = account(&conn, "Kas", 0);
    let mut input = TransactionInput {
        kind: TransactionKind::Expense,
        amount: 1_000,
        account_id: kas,
        occurred_at: now(),
        title: "x".into(),
        project_id: Some(a.summary.id.clone()),
        ..Default::default()
    };
    let saved = finance::save_transaction(&conn, &input, now(), &tz).unwrap();
    input.id = Some(saved.id.clone());
    input.project_id = Some(format!("  {}  ", b.summary.id)); // trimmed
    assert_eq!(finance::save_transaction(&conn, &input, now(), &tz).unwrap().project_id.as_deref(), Some(b.summary.id.as_str()));

    delete_project(&conn, &b.summary.id, now()).unwrap();
    assert_eq!(finance::get_transaction(&conn, &saved.id, now(), &tz).unwrap().project_id, None);
}
```

Di `mod tests` `sync/record.rs` (pakai helper `fixtures`, `clear_outbox`, `only_outbox` yang sudah ada):

```rust
#[test]
fn project_budget_and_transaction_project_changes_enqueue_records() {
    let conn = open_in_memory();
    fixtures(&conn);
    clear_outbox(&conn);
    conn.execute("UPDATE projects SET budget = 100000 WHERE item_id = 'project'", []).unwrap();
    only_outbox(&conn, "project");
    clear_outbox(&conn);
    conn.execute("UPDATE projects SET budget = 100000 WHERE item_id = 'project'", []).unwrap();
    assert!(outbox(&conn).is_empty(), "identical budget must not enqueue");
    conn.execute("UPDATE transactions SET project_id = 'project' WHERE item_id = 'transaction'", []).unwrap();
    only_outbox(&conn, "transaction");
    clear_outbox(&conn);
    conn.execute("UPDATE transactions SET project_id = NULL WHERE item_id = 'transaction'", []).unwrap();
    only_outbox(&conn, "transaction");
    clear_outbox(&conn);
    // archived_at (P-2) must still enqueue after the trigger is recreated.
    conn.execute("UPDATE projects SET archived_at = 5 WHERE item_id = 'project'", []).unwrap();
    only_outbox(&conn, "project");
}
```

Di `mod tests` `assistant/tools.rs`:

```rust
#[test]
fn add_transaction_accepts_a_project() {
    let args = json!({"title":"Server","kind":"expense","amount":1000,"accountId":"account","occurredAt":now(),"projectId":"project"});
    assert_eq!(transaction_args(&args).unwrap().project_id.as_deref(), Some("project"));
}
```

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `cd src-tauri && cargo test projects::tests assistant::tools::tests sync::record::tests`
Expected: gagal kompilasi (`budget`, `spent`, `project_id` belum ada); setelah migrasi saja, test sync gagal karena trigger lama tidak melihat `budget`/`project_id`.

- [ ] **Step 4: Implementasi**

`tasks.rs`: ubah `fn validate_project` menjadi `pub(crate) fn validate_project`.

`finance.rs`:

```rust
// TransactionView: field terakhir
pub project_id: Option<String>,
// TransactionInput: field terakhir
pub project_id: Option<String>,
```

`TRANSACTION_SELECT`: tambahkan `, t.project_id` setelah `t.occurred_at >= ?1` (kolom ke-14), dan `project_id: r.get(14)?,` di `transaction_from_row`.

`save_transaction`, setelah `let category = ...`:

```rust
let project_id = input.project_id.as_deref().map(str::trim).filter(|p| !p.is_empty());
if let Some(pid) = project_id {
    crate::tasks::validate_project(conn, pid)?;
}
```

- Cabang `None`: setelah `insert_transaction(&tx, &row, now)?`, simpan id ke variabel lalu `tx.execute("UPDATE transactions SET project_id = ?2 WHERE item_id = ?1", params![id, project_id])?;` (jangan ubah `NewTransaction`, karena tagihan dan transfer juga memakainya).
- Cabang `Some(id)`: tambahkan `project_id = ?6` ke `UPDATE transactions SET ...` dan `project_id` ke `params!`.

`projects.rs`:

```rust
// ProjectDetail: tambah
pub budget: Option<i64>,
/// Live expenses (not transfers, not income) linked to the project, as a positive amount.
pub spent: i64,
// ProjectInput: tambah
pub budget: Option<i64>,
// RawProject: tambah
budget: Option<i64>,
spent: i64,
```

`PROJECT_SELECT`: setelah `p.agent, p.agent_command, p.agent_dir` tambahkan

```sql
           , p.budget,
           (SELECT COALESCE(-SUM(tr.amount), 0) FROM transactions tr JOIN items tri ON tri.id = tr.item_id
            WHERE tri.deleted_at IS NULL AND tr.project_id = i.id
              AND tr.transfer_id IS NULL AND tr.amount < 0) AS spent
```

`raw_from_row`: `budget: r.get(11)?, spent: r.get(12)?,`. `build_detail`: isi `budget: raw.budget, spent: raw.spent`.

`save_project`, setelah validasi nama:

```rust
if input.budget.is_some_and(|b| b <= 0) {
    return Err(invalid("Anggaran harus lebih dari 0"));
}
```

Tambahkan `budget` ke `INSERT INTO projects (...)` (kolom `?8`) dan ke `UPDATE projects SET ... budget = ?8 ...`, dengan `input.budget` di `params!`.

`delete_project`, setelah `UPDATE tasks SET project_id = NULL ...`:

```rust
tx.execute("UPDATE transactions SET project_id = NULL WHERE project_id = ?1", [id])?;
```

`assistant/tools.rs`:
- schema `add_transaction`: tambahkan `"projectId":{"type":"string","description":"Opsional, ID proyek"}`.
- `transaction_args`: tambahkan `"projectId"` ke `allowed`.

- [ ] **Step 5: Jalankan test**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`
Expected: semua lulus, termasuk `project_budget_and_transaction_project_changes_enqueue_records`, `identical_updates_on_every_synced_table...` (update identik tidak mengantre), round trip export/apply, dan test migrasi di `db.rs`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/migrations/016_project_links.sql src-tauri/src/db.rs src-tauri/src/finance.rs src-tauri/src/tasks.rs src-tauri/src/projects.rs src-tauri/src/sync/record.rs src-tauri/src/assistant/tools.rs
git commit -m "feat(projects): link transactions to projects and track a budget"
```

---

### Task 2: Backend — status repo GitHub dan tautan keluar (R12, R13)

**Files:**
- Modify: `src-tauri/src/github.rs` (struct `RepoStatus`, fungsi repo, tests)
- Modify: `src-tauri/src/links.rs` (struct `OutLink`, fungsi `outgoing`, test)
- Modify: `src-tauri/src/projects.rs` (`save_project` menghapus cache repo saat proyek diubah, test)
- Modify: `src-tauri/src/commands.rs` (command `repo_status`, `item_links`), `src-tauri/src/lib.rs` (daftar `invoke_handler`)

**Interfaces:**
- Consumes: tabel `repo_status` dari Task 1; `projects::repo_url(conn, id) -> Result<String, AppError>` (sudah ada); `github::load_token(dir)` (sudah ada); `links::parse`, `links::resolve` (sudah ada).
- Produces (Rust):

```rust
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoStatus {
    pub fetched_at: i64,
    pub commit_message: Option<String>,
    pub commit_at: Option<i64>,
    pub open_issues: Option<i64>,
    pub open_prs: Option<i64>,
    /// Set when the refresh failed; the chip then falls back to plain "Repo".
    pub error: Option<String>,
}
pub fn repo_path(url: &str) -> Option<(String, String)>;
pub fn parse_repo(repo: &Value, commits: &Value, pulls: &Value, now: i64) -> Result<RepoStatus, AppError>;
pub fn refresh_repo(token: Option<&str>, url: &str, now: i64) -> RepoStatus; // never fails
pub fn cached_repo(conn: &Connection, project_id: &str) -> Result<Option<RepoStatus>, AppError>;
pub fn store_repo(conn: &Connection, project_id: &str, status: &RepoStatus) -> Result<(), AppError>;
pub fn repo_needs_refresh(cached: Option<&RepoStatus>, now: i64, force: bool) -> bool;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OutLink { pub title: String, pub item: Option<ItemSummary> }
pub fn links::outgoing(conn: &Connection, id: &str) -> Result<Vec<OutLink>, AppError>;
```

- Produces (command): `repo_status { projectId, force } -> RepoStatus`, `item_links { id } -> OutLink[]`. Backlink memakai command `page_backlinks { id }` yang sudah ada (berlaku untuk item apa pun).

Catatan R13 (sudah diverifikasi di `main`): `items::update` (`src-tauri/src/items.rs:150-152`) memanggil `links::refresh` untuk isi item apa pun, termasuk tugas, dan `page_backlinks` membaca backlink item apa pun. Jadi bagian simpan tautan dan backlink R13 sudah selesai. Yang tersisa hanya membaca tautan keluar (`outgoing`) dan UI di Task 3; jangan memanggil `refresh` lagi.

- [ ] **Step 1: Tulis test yang gagal**

Di `mod tests` `github.rs`:

```rust
use crate::finance::testing::ms;

fn repo_fixtures() -> (Value, Value, Value) {
    (
        json!({ "default_branch": "main", "open_issues_count": 5 }),
        json!([{ "commit": { "message": "feat: kanban\n\nbadan commit", "committer": { "date": "2026-10-03T08:00:00Z" } } }]),
        json!([{ "number": 1 }, { "number": 2 }]),
    )
}

#[test]
fn parses_repo_status_and_separates_prs_from_issues() {
    let (repo, commits, pulls) = repo_fixtures();
    assert_eq!(
        parse_repo(&repo, &commits, &pulls, 1_000).unwrap(),
        RepoStatus {
            fetched_at: 1_000,
            commit_message: Some("feat: kanban".into()),
            commit_at: Some(ms("2026-10-03T08:00:00Z")),
            open_issues: Some(3),
            open_prs: Some(2),
            error: None,
        }
    );
}

#[test]
fn repo_without_commits_still_parses_and_bad_json_is_an_error() {
    let (repo, _, pulls) = repo_fixtures();
    let status = parse_repo(&repo, &json!([]), &pulls, 1).unwrap();
    assert_eq!((status.commit_message, status.commit_at), (None, None));
    assert!(parse_repo(&json!({}), &json!([]), &json!([]), 1).is_err());
}

#[test]
fn repo_path_takes_owner_and_name() {
    assert_eq!(repo_path("https://github.com/Syharipf/Anchoa/"), Some(("Syharipf".into(), "Anchoa".into())));
    assert_eq!(repo_path("https://gitlab.com/a/b"), None);
    assert_eq!(repo_path("https://github.com/a"), None);
}

#[test]
fn repo_cache_round_trips_and_refreshes_after_fifteen_minutes() {
    let conn = open_in_memory();
    assert_eq!(cached_repo(&conn, "p").unwrap(), None);
    let failed = RepoStatus { fetched_at: 1_000, error: Some("Repo tidak ditemukan atau privat".into()), ..Default::default() };
    store_repo(&conn, "p", &failed).unwrap();
    assert_eq!(cached_repo(&conn, "p").unwrap(), Some(failed.clone()));
    assert!(repo_needs_refresh(None, 0, false));
    assert!(!repo_needs_refresh(Some(&failed), 1_000 + 899_999, false));
    assert!(repo_needs_refresh(Some(&failed), 1_000 + 900_000, false));
    assert!(repo_needs_refresh(Some(&failed), 1_001, true));
}

#[test]
fn repo_errors_read_in_indonesian() {
    assert!(repo_error(&ureq::Error::StatusCode(404)).contains("tidak ditemukan"));
    assert!(repo_error(&ureq::Error::StatusCode(403)).contains("Batas permintaan"));
    assert!(repo_error(&ureq::Error::StatusCode(429)).contains("Batas permintaan"));
    assert!(repo_error(&ureq::Error::StatusCode(401)).contains("token"));
}

#[test]
fn invalid_url_fails_without_network() {
    let status = refresh_repo(None, "https://gitlab.com/a/b", 5);
    assert_eq!((status.fetched_at, status.error.as_deref()), (5, Some("URL repositori tidak valid")));
}
```

Di `mod tests` `links.rs` (sesuaikan `use` dengan yang sudah ada di modul test itu):

```rust
#[test]
fn outgoing_lists_titles_with_their_targets() {
    let conn = crate::db::open_in_memory();
    let page = crate::items::insert(&conn, "page", "Halaman A", "", 1).unwrap();
    let task = crate::items::insert(&conn, "task", "Tugas", "Lihat [[Halaman A]], [[Tidak ada]], dan [[Tugas]].", 2).unwrap();
    let out = outgoing(&conn, &task).unwrap();
    assert_eq!(out.iter().map(|o| o.title.as_str()).collect::<Vec<_>>(), ["Halaman A", "Tidak ada", "Tugas"]);
    assert_eq!(out[0].item.as_ref().map(|i| i.id.as_str()), Some(page.as_str()));
    assert!(out[1].item.is_none());
    assert!(out[2].item.is_none(), "a link to itself stays unresolved");
    assert!(matches!(outgoing(&conn, "missing"), Err(AppError::NotFound)));
}
```

Di `mod tests` `projects.rs`:

```rust
#[test]
fn saving_a_project_drops_its_cached_repo_status() {
    let conn = open_in_memory();
    let tz = jakarta();
    let mut input = ProjectInput { name: "P".into(), repo_url: Some("https://github.com/a/b".into()), ..Default::default() };
    let p = save_project(&conn, &input, now(), &tz).unwrap();
    let cached = crate::github::RepoStatus { fetched_at: 1, ..Default::default() };
    crate::github::store_repo(&conn, &p.summary.id, &cached).unwrap();
    input.id = Some(p.summary.id.clone());
    input.repo_url = Some("https://github.com/a/c".into());
    save_project(&conn, &input, now(), &tz).unwrap();
    assert_eq!(crate::github::cached_repo(&conn, &p.summary.id).unwrap(), None);
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd src-tauri && cargo test github::tests links::tests projects::tests`
Expected: gagal kompilasi (`RepoStatus`, `parse_repo`, `outgoing` belum ada).

- [ ] **Step 3: Implementasi `github.rs`**

Tambahkan `use std::time::Duration;` dan `use serde::Deserialize;` (gabungkan dengan `use serde::Serialize;`). Lalu:

```rust
const REPO_TTL_MS: i64 = 15 * 60 * 1000;

/// `https://github.com/<owner>/<repo>` (already validated by save_project) to (owner, repo).
pub fn repo_path(url: &str) -> Option<(String, String)> {
    let rest = url.strip_prefix("https://github.com/")?;
    let mut parts = rest.trim_end_matches('/').split('/');
    let (owner, name) = (parts.next()?, parts.next()?);
    (parts.next().is_none() && !owner.is_empty() && !name.is_empty()).then(|| (owner.to_string(), name.to_string()))
}

/// Repo, newest commit on the default branch, and open pull requests (REST v3).
pub fn parse_repo(repo: &Value, commits: &Value, pulls: &Value, now: i64) -> Result<RepoStatus, AppError> {
    let unreadable = || AppError::Other("Respons GitHub tidak terbaca".into());
    let open_total = repo["open_issues_count"].as_i64().ok_or_else(unreadable)?;
    // ponytail: one page of 100 pulls; a repo with more open PRs shows 100 and its issues count high.
    let open_prs = pulls.as_array().ok_or_else(unreadable)?.len() as i64;
    let latest = commits.as_array().ok_or_else(unreadable)?.first();
    let commit_message = latest
        .and_then(|c| c["commit"]["message"].as_str())
        .map(|m| m.lines().next().unwrap_or("").to_string());
    let commit_at = latest
        .and_then(|c| c["commit"]["committer"]["date"].as_str())
        .and_then(|d| d.parse::<jiff::Timestamp>().ok())
        .map(|t| t.as_millisecond());
    Ok(RepoStatus {
        fetched_at: now,
        commit_message,
        commit_at,
        open_issues: Some((open_total - open_prs).max(0)),
        open_prs: Some(open_prs),
        error: None,
    })
}

fn repo_error(error: &ureq::Error) -> String {
    match error {
        ureq::Error::StatusCode(401) => "GitHub menolak token (401)".into(),
        ureq::Error::StatusCode(404) => "Repo tidak ditemukan atau privat".into(),
        ureq::Error::StatusCode(403 | 429) => "Batas permintaan GitHub tercapai, coba lagi nanti".into(),
        ureq::Error::StatusCode(409) => "Repo masih kosong".into(),
        ureq::Error::Timeout(_) => "Waktu tunggu GitHub habis".into(),
        other => format!("Tidak bisa menghubungi GitHub: {other}"),
    }
}

/// Fetches the status; every failure comes back as a status with `error` set (spec R12).
/// Blocking: call it from `spawn_blocking`, never while holding the DB lock.
pub fn refresh_repo(token: Option<&str>, url: &str, now: i64) -> RepoStatus {
    let failed = |error: String| RepoStatus { fetched_at: now, error: Some(error), ..Default::default() };
    let Some((owner, name)) = repo_path(url) else { return failed("URL repositori tidak valid".into()) };
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(10))).build().into();
    let get = |path: &str| -> Result<Value, String> {
        let mut request = agent
            .get(&format!("https://api.github.com/repos/{owner}/{name}{path}"))
            .header("User-Agent", "Anchoa")
            .header("Accept", "application/vnd.github+json");
        if let Some(token) = token {
            request = request.header("Authorization", &format!("Bearer {token}"));
        }
        request
            .call()
            .map_err(|e| repo_error(&e))?
            .body_mut()
            .read_json::<Value>()
            .map_err(|_| "Respons GitHub tidak terbaca".to_string())
    };
    let fetched = get("").and_then(|repo| Ok((repo, get("/commits?per_page=1")?, get("/pulls?state=open&per_page=100")?)));
    match fetched {
        Ok((repo, commits, pulls)) => parse_repo(&repo, &commits, &pulls, now).unwrap_or_else(|e| failed(e.to_string())),
        Err(error) => failed(error),
    }
}

pub fn cached_repo(conn: &Connection, project_id: &str) -> Result<Option<RepoStatus>, AppError> {
    let json: Option<String> = conn
        .query_row("SELECT json FROM repo_status WHERE project_id = ?1", [project_id], |r| r.get(0))
        .optional()?;
    // An unreadable cache row is treated as missing, so the next call refetches it.
    Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
}

pub fn store_repo(conn: &Connection, project_id: &str, status: &RepoStatus) -> Result<(), AppError> {
    let json = serde_json::to_string(status).map_err(|e| AppError::Other(e.to_string()))?;
    conn.execute(
        "INSERT INTO repo_status (project_id, fetched_at, json) VALUES (?1, ?2, ?3)
         ON CONFLICT(project_id) DO UPDATE SET fetched_at = excluded.fetched_at, json = excluded.json",
        params![project_id, status.fetched_at, json],
    )?;
    Ok(())
}

/// Failed fetches are cached too, so an offline machine or a rate limit is not retried on every open.
pub fn repo_needs_refresh(cached: Option<&RepoStatus>, now: i64, force: bool) -> bool {
    force || cached.is_none_or(|c| now - c.fetched_at >= REPO_TTL_MS)
}
```

Kalau `ureq::Error` tidak `Display` untuk varian tertentu atau nama varian berbeda di versi terpasang, cek `src/assistant/llm.rs:99-105` yang sudah memakai `StatusCode` dan `Timeout`.

- [ ] **Step 4: Implementasi `links.rs`, `projects.rs`, command**

`links.rs` (tambahkan `use rusqlite::OptionalExtension;`):

```rust
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OutLink {
    pub title: String,
    /// `None` when no live item has this title (shown dimmed), or when it is the item itself.
    pub item: Option<ItemSummary>,
}

/// The `[[links]]` in an item's body, in order, with the item each one resolves to.
pub fn outgoing(conn: &Connection, id: &str) -> Result<Vec<OutLink>, AppError> {
    let body: String = conn
        .query_row("SELECT body FROM items WHERE id = ?1 AND deleted_at IS NULL", [id], |r| r.get(0))
        .optional()?
        .ok_or(AppError::NotFound)?;
    parse(&body)
        .into_iter()
        .map(|title| {
            let item = resolve(conn, &title)?.filter(|item| item.id != id);
            Ok(OutLink { title, item })
        })
        .collect()
}
```

`projects.rs` `save_project`, cabang `Some(id)`, setelah `UPDATE projects ...`:

```rust
// The repo URL may have changed; the next repo_status call refetches.
tx.execute("DELETE FROM repo_status WHERE project_id = ?1", [id])?;
```

`commands.rs` (impor `github::RepoStatus` dan `links::OutLink`):

```rust
/// Cached GitHub status, refreshed when older than 15 minutes or when forced (spec R12).
/// The network call runs without the DB lock; failures come back in `error`.
#[tauri::command]
pub async fn repo_status(app: AppHandle, project_id: String, force: bool) -> Result<RepoStatus, AppError> {
    let now = time::now_ms();
    let (url, cached) = {
        let db = app.state::<Db>();
        let conn = db.conn()?;
        (projects::repo_url(&conn, &project_id)?, github::cached_repo(&conn, &project_id)?)
    };
    if let Some(cached) = cached.as_ref().filter(|c| !github::repo_needs_refresh(Some(c), now, force)) {
        return Ok(cached.clone());
    }
    let token = github::load_token(&app.path().app_config_dir()?);
    let status = tauri::async_runtime::spawn_blocking(move || github::refresh_repo(token.as_deref(), &url, now))
        .await
        .map_err(blocking_error)?;
    github::store_repo(&*app.state::<Db>().conn()?, &project_id, &status)?;
    Ok(status)
}

#[tauri::command]
pub fn item_links(db: State<'_, Db>, id: String) -> Result<Vec<OutLink>, AppError> {
    links::outgoing(&*db.conn()?, &id)
}
```

Daftarkan `commands::repo_status` dan `commands::item_links` di `lib.rs`.

- [ ] **Step 5: Jalankan test**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`
Expected: semua lulus, tanpa request jaringan dari test.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/github.rs src-tauri/src/links.rs src-tauri/src/projects.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(projects): cached GitHub repo status and outgoing links"
```

---

### Task 3: Frontend — chip repo dan anggaran, field Proyek di transaksi, tautan di tugas

**Files:**
- Modify: `src/api.ts` (tipe dan fungsi baru)
- Modify: `src/projects/view.ts`, `src/projects/view.test.ts` (`repoChip`, `spentChip`)
- Modify: `src/projects/ProjectHeader.tsx` (chip repo dengan status + tombol muat ulang, chip Terpakai)
- Modify: `src/projects/ProjectForm.tsx` (field Anggaran)
- Modify: `src/finance/TransactionForm.tsx` (select Proyek)
- Create: `src/item/LinkedTextarea.tsx` (textarea dengan autocomplete `[[`)
- Create: `src/item/TaskLinks.tsx` (bagian "Tautan" + panel "Disebut di")
- Modify: `src/item/ItemPage.tsx`
- Modify: literal test yang membangun `ProjectDetail` atau `TransactionView` (cari dengan `grep -rln "agentCommand: null\|billId: null" src`)

**Interfaces:**
- Consumes: command dari Task 1 dan 2; `linkQuery`, `insertLink` dari `src/notes/blocks.ts`; `Backlinks` dari `src/notes/Backlinks.tsx`; `relativeTime` dari `src/format.ts`; `formatRupiah`, `formatDigits`, `parseRupiah` dari `src/money.ts`; `MoneyField` dari `src/finance/fields.tsx`.
- Produces (TS):

```ts
export interface RepoStatus {
  fetchedAt: number;
  commitMessage: string | null;
  commitAt: number | null;
  openIssues: number | null;
  openPrs: number | null;
  error: string | null;
}
export interface OutLink { title: string; item: ItemSummary | null }
// ProjectDetail: + budget: number | null; spent: number;
// ProjectInput: + budget?: number | null;
// TransactionInput: + projectId?: string | null;
// TransactionView: + projectId: string | null;
repoStatus: (projectId: string, force = false) => invoke<RepoStatus>("repo_status", { projectId, force }),
itemLinks: (id: string) => invoke<OutLink[]>("item_links", { id }),
// projects/view.ts
export function repoChip(status: RepoStatus | null, now: number): { text: string; title: string };
export function spentChip(spent: number, budget: number | null): { text: string; over: boolean } | null;
```

- [ ] **Step 1: Tulis test yang gagal** (di `src/projects/view.test.ts`, tambahkan `repoChip`, `spentChip` ke import)

```ts
describe("repoChip", () => {
  const status = { fetchedAt: 0, commitMessage: "feat: kanban", commitAt: 0, openIssues: 3, openPrs: 1, error: null };
  test("shows commit age, issues and PRs", () => {
    expect(repoChip(status, 2 * 3_600_000)).toEqual({ text: "Repo · commit 2 jam lalu · 3 issue · 1 PR", title: "feat: kanban" });
  });
  test("falls back to a plain chip that explains why", () => {
    expect(repoChip({ ...status, error: "Repo tidak ditemukan atau privat" }, 0))
      .toEqual({ text: "Repo", title: "Repo tidak ditemukan atau privat" });
    expect(repoChip(null, 0)).toEqual({ text: "Repo", title: "Buka repositori di browser" });
  });
});

describe("spentChip", () => {
  test("is hidden when nothing is spent and there is no budget", () => {
    expect(spentChip(0, null)).toBeNull();
  });
  test("shows spending, with the budget when there is one", () => {
    expect(spentChip(25_000, null)).toEqual({ text: "Terpakai Rp 25.000", over: false });
    expect(spentChip(0, 100_000)).toEqual({ text: "Terpakai Rp 0 dari Rp 100.000", over: false });
    expect(spentChip(150_000, 100_000)).toEqual({ text: "Terpakai Rp 150.000 dari Rp 100.000", over: true });
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `TZ=Asia/Jakarta bun test src/projects/view.test.ts`
Expected: FAIL (`repoChip` dan `spentChip` belum diekspor).

- [ ] **Step 3: Implementasi helper dan tipe**

`src/projects/view.ts` (impor `relativeTime` dari `../format`, `formatRupiah` dari `../money`, tipe `RepoStatus` dari `../api`):

```ts
const REPO_TITLE = "Buka repositori di browser";

/** Header chip for the GitHub repo (spec Proyek v2 R12): plain "Repo" when there is no fresh status. */
export function repoChip(status: RepoStatus | null, now: number): { text: string; title: string } {
  if (!status || status.error) return { text: "Repo", title: status?.error ?? REPO_TITLE };
  const parts = ["Repo"];
  if (status.commitAt !== null) parts.push(`commit ${relativeTime(status.commitAt, now)}`);
  if (status.openIssues !== null) parts.push(`${status.openIssues} issue`);
  if (status.openPrs !== null) parts.push(`${status.openPrs} PR`);
  return { text: parts.join(" · "), title: status.commitMessage ?? REPO_TITLE };
}

/** "Terpakai Rp X" or "Terpakai Rp X dari Rp Y" (R11); hidden when there is nothing to show. */
export function spentChip(spent: number, budget: number | null): { text: string; over: boolean } | null {
  if (budget === null) return spent === 0 ? null : { text: `Terpakai ${formatRupiah(spent)}`, over: false };
  return { text: `Terpakai ${formatRupiah(spent)} dari ${formatRupiah(budget)}`, over: spent > budget };
}
```

`src/api.ts`: tambahkan tipe dan dua fungsi dari blok Interfaces. Lalu `bun run typecheck` dan perbaiki setiap literal `ProjectDetail` (tambah `budget: null, spent: 0`) dan `TransactionView` (tambah `projectId: null`) di file test yang dilaporkan.

- [ ] **Step 4: Komponen**

`ProjectHeader.tsx`:
- State `const [repo, setRepo] = useState<RepoStatus | null>(null);` dan efek yang memuat status saat `project?.id` atau `project?.repoUrl` berubah:

```tsx
useEffect(() => {
  setRepo(null);
  if (!project?.repoUrl) return;
  let active = true;
  // Errors arrive inside the status (R12); a rejected call just keeps the plain chip, no toast.
  api.repoStatus(project.id).then((status) => { if (active) setRepo(status); }, () => {});
  return () => { active = false; };
}, [project?.id, project?.repoUrl]);
```

- Chip Repo yang ada memakai `const chip = repoChip(repo, Date.now());`: teks `{chip.text}`, `title={chip.title}`, klik tetap `api.openRepo`. Di sebelahnya tombol ikon kecil `aria-label="Muat ulang status repo"` yang memanggil `api.repoStatus(project.id, true).then(setRepo, () => {})`.
- Chip Terpakai setelah chip jenis: `const spent = spentChip(project.spent, project.budget);` dirender hanya kalau tidak `null`, dengan kelas chip yang sama dan `text-danger` kalau `spent.over`, selain itu `text-ink`.

`ProjectForm.tsx`:
- State `const [budget, setBudget] = useState(edit?.budget ? formatDigits(edit.budget) : "");` dan `<MoneyField label="Anggaran (opsional)" value={budget} onChange={setBudget} />` setelah field deadline.
- Di `submit`, sebelum `run`:

```tsx
const budgetValue = budget.trim() === "" ? null : parseRupiah(budget);
if (budget.trim() !== "" && (budgetValue === null || budgetValue <= 0)) {
  toast("Anggaran harus angka bulat lebih dari 0", "error");
  return;
}
```

  lalu kirim `budget: budgetValue` ke `api.saveProject`.

`TransactionForm.tsx`:
- State `const [project, setProject] = useState(edit?.projectId ?? "");` dan daftar proyek dari `api.projectsOverview()` di `useEffect` (`.then((o) => setProjects(o.projects), () => setProjects([]))`; `projects` setelah P-2 hanya berisi proyek yang tidak diarsipkan).
- Untuk `kind !== "transfer"`, setelah Kategori: `<Field label="Proyek"><select ...>` dengan opsi `""` = "Tanpa proyek", lalu tiap proyek. Kalau `edit?.projectId` tidak ada di daftar (proyek diarsipkan), tambahkan satu opsi untuk id itu berlabel "Proyek diarsipkan".
- Kirim `projectId: project || null` ke `api.saveTransaction`.

`src/item/LinkedTextarea.tsx` (props `Readonly<{ value; onChange(body); onBlur(); excludeId; className; placeholder; ariaLabel }>`):
- Simpan posisi kursor dari `onChange`, `onSelect`, `onClick`, dan `onKeyUp` (`e.currentTarget.selectionStart`).
- `const query = linkQuery(value, caret);`. Efek: kalau `query` null, kosong setelah trim, atau sama dengan query yang ditutup lewat Esc, `setHits([])`; selain itu `api.searchItems(query, false, 8)` lalu buang hit dengan `id === excludeId`. Abaikan respons usang dengan flag `active` di cleanup efek.
- `onKeyDown` saat ada hit: ArrowDown/ArrowUp memindah indeks terpilih, Enter atau Tab memilih (`preventDefault`), Esc menutup daftar.
- Memilih: `const next = insertLink(value, caret, hit.title); onChange(next.text);` lalu setelah render `ref.current?.setSelectionRange(next.caret, next.caret)` (pakai `requestAnimationFrame`).
- Daftar saran di bawah textarea: `<ul aria-label="Saran tautan">` berisi `<button type="button" aria-pressed={i === index}>` per hit (judul + jenis item), `onMouseDown={(e) => e.preventDefault()}` agar fokus tetap di textarea, `onClick` memilih.

`src/item/TaskLinks.tsx` (props `Readonly<{ links: readonly OutLink[]; backlinks: readonly Backlink[]; onOpenItem: (id: string) => void }>`):
- Bagian "Tautan" (hanya kalau `links.length > 0`): tiap tautan yang punya `item` adalah `<button type="button">` yang membuka item itu; yang `item === null` adalah `<span>` redup (`text-muted opacity-60`) dengan `title="Belum ada item dengan judul ini"`.
- Di bawahnya `<Backlinks items={backlinks} onOpenItem={onOpenItem} />`.

`ItemPage.tsx`:
- State `links: OutLink[]` dan `backlinks: Backlink[]`; fungsi `loadLinks` memanggil `Promise.all([api.itemLinks(id), api.pageBacklinks(id)])`, error ke toast. Panggil setelah tugas dimuat, dan di `flush` setelah `api.updateItem` sukses kalau patch berisi `body`.
- Untuk tugas, ganti `<textarea>` isi dengan `<LinkedTextarea ... excludeId={id} />` (kelas dan placeholder sama), lalu render `<TaskLinks ... />` di bawahnya. Item selain tugas tidak berubah.

- [ ] **Step 5: Jalankan test**

Run: `bun run typecheck && TZ=Asia/Jakarta bun test`
Expected: semua lulus.

- [ ] **Step 6: Commit**

```bash
git add src/api.ts src/projects/view.ts src/projects/view.test.ts src/projects/ProjectHeader.tsx src/projects/ProjectForm.tsx src/finance/TransactionForm.tsx src/item/LinkedTextarea.tsx src/item/TaskLinks.tsx src/item/ItemPage.tsx
# plus each test file whose literals were updated, by explicit path
git commit -m "feat(projects): repo and budget chips, project field on transactions, task links"
```

---

### Task 4: E2E dan PR (sesi Opus)

**Files:**
- Modify: `scripts/e2e-smoke.sh` (fungsi baru `check_projects_links`, dipanggil setelah `check_projects` dan check P-1/P-2)

- [ ] **Step 1: Tambah `check_projects_links`** mengikuti gaya `check_github` dan `check_projects`. Data disemai lewat SQL saat app berhenti. Jaringan diblokir dengan proxy ke port tertutup, jadi status repo selalu jatuh ke chip "Repo" biasa; URL repo juga sengaja tidak ada, jadi hasilnya tetap error walau proxy diabaikan.

```bash
check_projects_links() {
  fresh
  start_app
  stop_app                      # creates the database at the latest schema
  local now
  now=$(date +%s%3N)
  sql "INSERT INTO items (id, type, title, body, created_at, updated_at) VALUES
         ('e2e-page', 'page', 'Halaman e2e', '', $now, $now),
         ('e2e-proj', 'project', 'Proyek e2e', '', $now, $now),
         ('e2e-acc', 'account', 'Kas', '', $now, $now),
         ('e2e-tx', 'transaction', 'Sewa server', '', $now, $now),
         ('e2e-task', 'task', 'Tugas tautan', '', $now, $now);
       INSERT INTO projects (item_id, kind, repo_url, budget) VALUES ('e2e-proj', 'app', 'https://github.com/anchoa-e2e/tidak-ada', 100000);
       INSERT INTO accounts (item_id, kind) VALUES ('e2e-acc', 'cash');
       INSERT INTO transactions (item_id, account_id, amount, category, occurred_at, project_id)
         VALUES ('e2e-tx', 'e2e-acc', -150000, 'Lainnya', $now, 'e2e-proj');
       INSERT INTO tasks (item_id, status, project_id) VALUES ('e2e-task', 'plan', 'e2e-proj');"
  HTTPS_PROXY=http://127.0.0.1:9 https_proxy=http://127.0.0.1:9 start_app
  click 36 472                  # nav: Proyek (Proyek e2e is the only project, so it is selected)
  sql_becomes "SELECT json_extract(json, '$.error') IS NOT NULL FROM repo_status WHERE project_id = 'e2e-proj'" 1 \
    || fail "repo status failure not cached"
  shot 12-projects-links-header # expect: plain "Repo" chip, coral "Terpakai Rp 150.000 dari Rp 100.000"
  # Open the task, type a link, pick the suggestion with Enter. Measure coordinates from the screenshot.
  click <x> <y>                 # Tugas tautan card
  click <x> <y>                 # body textarea
  xdotool type --delay 20 'Lihat [[Halaman'
  sleep 1
  shot 12-projects-links-suggest # expect: "Halaman e2e" in "Saran tautan"
  xdotool key Return
  sleep 1
  sql_becomes "SELECT body FROM items WHERE id = 'e2e-task'" 'Lihat [[Halaman e2e]]' || fail "link not inserted"
  sql_becomes "SELECT COUNT(*) FROM links WHERE from_id = 'e2e-task' AND to_id = 'e2e-page'" 1 || fail "link not stored"
  shot 12-projects-links-task   # expect: "Tautan" with Halaman e2e
  stop_app
}
```

Ganti setiap `<x> <y>` dengan koordinat dari screenshot sebelumnya (pola yang sama dengan check lain); jangan biarkan placeholder di commit. Pakai `[[ ... ]]`, bukan `[ ... ]`. Kalau seed gagal karena kolom berubah setelah P-1/P-2, sesuaikan daftar kolom `INSERT`.

- [ ] **Step 2:** Cek manual yang tidak bisa diotomatisasi tanpa jaringan: jalankan `bun tauri dev` dengan proyek ber-repo publik (misalnya `https://github.com/Syharipf/Anchoa`) dan pastikan chip menampilkan "Repo · commit … · n issue · n PR". Ini satu-satunya langkah yang memakai jaringan; catat hasilnya di PR.
- [ ] **Step 3:** `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`. Cek screenshot di `~/.cache/anchoa-e2e/`.
- [ ] **Step 4:** Commit, push branch `feat/147-proyek-terhubung`, buka PR dengan bukti test dan `Closes #147`. Review Sol + agy paralel, verifikasi temuan, perbaiki, merge saat semua hijau (`gh pr merge --squash --delete-branch`). Tanpa rilis.
- [ ] **Step 5:** Tulis handoff ke `.remember/now.md`: P-3 selesai, P-4 berikutnya di sesi baru (sesi itu membaca `docs/superpowers/plans/2026-10-03-anchoa-proyek-v2-p4.md` kalau sudah ada, atau menulisnya dari spec R14–R17 sebelum kode).
