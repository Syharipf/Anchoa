# Anchoa Proyek v2 — P-1 Dasar: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementasi utama oleh Codex gpt-6.1-sol xhigh (`codex exec -s workspace-write`, satu task per run). Kalau kuotanya habis, pakai `agy-multi --model gemini-3.8-flash-high`. Review oleh agy dan Sol, lalu dicek sesi Opus.

**Goal:** kartu kanban bisa diseret antar kolom, tugas punya prioritas, kanban bisa dicari dan disaring, dan tugas yang dihapus bisa diurungkan. Asisten bisa mengubah tugas lewat persetujuan.

**Architecture:** satu kolom baru `tasks.priority`. `project_board` mendapat `BoardFilter` dan field `tags`, dengan urutan kolom prioritas lalu tenggat. Ada command baru `restore_task`, dan `update_task` dipecah menjadi `update_task_in_transaction` supaya tool asisten `update_task` bisa mengubah status, prioritas, tag, dan tenggat secara atomik. Frontend memakai drag-and-drop HTML5 bawaan, bar filter baru, dan toast aksi yang sudah ada (`src/shell/toast.tsx`, 6 detik) untuk Urungkan.

**Tech Stack:** Rust + rusqlite + jiff, React + TypeScript, bun test, Xvfb E2E.

**Spec:** `docs/superpowers/specs/2026-10-03-anchoa-proyek-v2-design.md` (R1–R6, R18, §3, §4).

## Global Constraints

- Semua aturan di `CLAUDE.md` berlaku. Frontend hanya lewat `src/api.ts`. Delete = soft delete; setiap query menyaring `deleted_at IS NULL`.
- Batas hari dihitung di Rust. Command mengembalikan `Result<T, AppError>`, tanpa panic.
- SonarCloud: props `Readonly<...>`, elemen non-tombol dengan `onClick` butuh handler keyboard, tanpa `Math.random()`, bash pakai `[[ ... ]]`.
- Teks UI dalam Bahasa Indonesia, tanpa kata "Fase".
- Tanpa dependency baru (drag-and-drop memakai API HTML5 bawaan). Tanpa bump versi (rilis setelah P-4).
- Jurnal v2 (J-1..J-4) sudah merge sebelum P-1 dan menambah migrasi. Pakai **nomor migrasi berikutnya yang masih bebas** di `src-tauri/migrations/` (`ls src-tauri/migrations | tail -1`, lalu +1). Di plan ini nomornya ditulis `0NN`.
- Sesi ini hanya mengerjakan P-1. P-2..P-4 dikerjakan di sesi Claude Code lain, masing-masing menulis plan-nya sendiri dari spec.

| PR | Task |
|---|---|
| P-1 (#145, milestone "Proyek v2") | 1–4 |

## Menjalankan task

Satu task per run, di branch `feat/145-proyek-dasar`, dari root worktree:

```bash
codex exec -m gpt-6.1-sol -c model_reasoning_effort=xhigh -s workspace-write -C "$PWD" < /dev/null "Implement Task <N> of docs/superpowers/plans/2026-10-03-anchoa-proyek-v2-p1.md exactly as written, step by step, including its tests and its commit. Follow CLAUDE.md. Rules: work only inside this repository; do not push, merge, open PRs, change git remotes or branches, or touch files the task does not list; do not open URLs. When done, print the output of the task's test commands and the commit hash."
```

Kalau Codex gagal (kuota, auth, timeout): `agy-multi --model gemini-3.8-flash-high --dangerously-skip-permissions --print-timeout 1200s -p "<prompt yang sama>"`. `--model` harus sebelum `-p`. Setelah setiap run, sesi Opus menjalankan test task itu dan membaca diff commit-nya. Kalau satu task gagal dua kali, pakai agent `implementer` (Sonnet). Commit dulu sebelum menjalankan agy, karena agy bisa mereset file yang belum di-commit.

---

### Task 1: Backend — prioritas, filter board, pulihkan tugas

**Files:**
- Create: `src-tauri/migrations/0NN_task_priority.sql`
- Modify: `src-tauri/src/db.rs:10-21+` (daftar `include_str!` migrasi; tambah di akhir)
- Modify: `src-tauri/src/tasks.rs` (`TaskCard` :49-62, `TaskPatch` :84-94, `present_opt` :96, `CARD_SELECT` :100-110, `card_query` :112-147, `update_task` :274-345, `delete_task` :347-364, fungsi baru `restore_task`, tests)
- Modify: `src-tauri/src/projects.rs` (`Board` :122-127, `project_board` :405-450, tipe baru `BoardFilter`/`DueFilter`, tests; semua pemanggilan `project_board(` di `mod tests` mendapat argumen filter)
- Modify: `src-tauri/src/sync/record.rs:26` (kolom `priority`) dan `:476` (insert `tasks` posisional)
- Modify: `src-tauri/src/commands.rs:88-91` (`project_board` menerima `filter`), `:202-205` (tambah `restore_task` setelah `delete_task`)
- Modify: `src-tauri/src/lib.rs` (`invoke_handler`: tambah `commands::restore_task` setelah `commands::delete_task`)

**Interfaces:**
- Produces (Rust):
  - `TaskCard.priority: Option<i64>` (1 = Tinggi, 2 = Sedang, 3 = Rendah, `None` = tanpa)
  - `TaskPatch.priority: Option<Option<i64>>` (field tidak ada = tidak berubah, `null` = kosongkan)
  - `pub(crate) fn present_opt` (dipakai Task 2)
  - `pub fn restore_task(conn: &Connection, id: &str, now: i64) -> Result<(), AppError>`
  - `pub struct BoardFilter { pub query: Option<String>, pub tag: Option<String>, pub priority: Option<i64>, pub due: Option<DueFilter> }` (`Default`, `Deserialize`, camelCase)
  - `pub enum DueFilter { Overdue, Week, NoDue }`, serde `"overdue" | "week" | "none"`
  - `pub fn project_board(conn: &Connection, id: Option<&str>, filter: &BoardFilter, now: i64, tz: &TimeZone) -> Result<Board, AppError>`
  - `Board.tags: Vec<String>`: tag huruf kecil, unik, urut abjad, dari semua tugas induk board itu **tanpa** filter
- Produces (command): `project_board { id, filter? }`, `restore_task { id }`

- [ ] **Step 1: Migrasi dan sync**

```sql
-- 0NN_task_priority.sql
-- Task priority (spec Proyek v2 R2): 1 high, 2 medium, 3 low, NULL none.
ALTER TABLE tasks ADD COLUMN priority INTEGER;

-- sync_items_update ignores updated_at, so the tasks trigger must watch priority itself
-- (012_sync.sql:73); otherwise a priority change never reaches sync_outbox.
DROP TRIGGER sync_tasks_update;
CREATE TRIGGER sync_tasks_update AFTER UPDATE ON tasks
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND (old.item_id IS NOT new.item_id OR old.status IS NOT new.status OR old.project_id IS NOT new.project_id OR old.start_at IS NOT new.start_at OR old.tag IS NOT new.tag OR old.priority IS NOT new.priority)
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;
```

Tambah `include_str!("../migrations/0NN_task_priority.sql"),` di akhir daftar di `db.rs`. Kalau migrasi Jurnal v2 sebelumnya sudah membuat ulang `sync_tasks_update`, salin isi `WHEN` dari versi terbaru itu, lalu tambahkan `OR old.priority IS NOT new.priority`. Cari dengan `grep -n "sync_tasks_update" src-tauri/migrations/*.sql`.

Di `sync/record.rs:26`, ubah kolom extension task menjadi:

```rust
columns: &["item_id", "status", "project_id", "start_at", "tag", "priority"],
```

Lalu ubah fixture posisional di sekitar baris 476 supaya menyebut nama kolom dan ikut membawa prioritas:

```rust
("task", "tasks", "INSERT INTO tasks (item_id, status, project_id, start_at, tag, priority) VALUES ('task', 'doing', 'project', 90, 'tag', 2)", "status = 'review'"),
```

Tambah test di `mod tests` `sync/record.rs`, memakai helper `fixtures`, `clear_outbox`, `outbox`, dan `only_outbox` yang sudah ada:

```rust
#[test]
fn changing_task_priority_is_captured() {
    let conn = open_in_memory();
    fixtures(&conn);
    for change in ["priority = 1", "priority = NULL"] {
        clear_outbox(&conn);
        conn.execute(&format!("UPDATE tasks SET {change} WHERE item_id = 'task'"), []).unwrap();
        only_outbox(&conn, "task");
    }
    clear_outbox(&conn);
    conn.execute("UPDATE tasks SET priority = priority WHERE item_id = 'task'", []).unwrap();
    assert!(outbox(&conn).is_empty());
}
```

- [ ] **Step 2: Tulis test yang gagal di `tasks.rs`** (`mod tests`)

```rust
#[test]
fn priority_round_trips_and_rejects_out_of_range() {
    let conn = open_in_memory();
    let tz = jakarta();
    let t = create_task(&conn, &NewTask { title: "P".into(), ..Default::default() }, now(), &tz).unwrap();
    assert_eq!(t.priority, None);

    let set = TaskPatch { priority: Some(Some(1)), ..Default::default() };
    assert_eq!(update_task(&conn, &t.id, &set, now(), &tz).unwrap().card.priority, Some(1));

    let bad = TaskPatch { priority: Some(Some(4)), ..Default::default() };
    assert!(matches!(update_task(&conn, &t.id, &bad, now(), &tz), Err(AppError::Invalid(_))));
    assert_eq!(get_task(&conn, &t.id, now(), &tz).unwrap().card.priority, Some(1));

    let missing: TaskPatch = serde_json::from_value(serde_json::json!({})).unwrap();
    assert_eq!(missing.priority, None);
    let clear: TaskPatch = serde_json::from_value(serde_json::json!({ "priority": null })).unwrap();
    assert_eq!(clear.priority, Some(None));
    assert_eq!(update_task(&conn, &t.id, &clear, now(), &tz).unwrap().card.priority, None);
}

#[test]
fn restore_task_brings_back_parent_and_the_subtasks_deleted_with_it() {
    let conn = open_in_memory();
    let tz = jakarta();
    let parent = create_task(&conn, &NewTask { title: "Induk".into(), ..Default::default() }, now(), &tz).unwrap();
    let earlier = create_task(&conn, &NewTask { title: "Lama".into(), parent_id: Some(parent.id.clone()), ..Default::default() }, now(), &tz).unwrap();
    let sub = create_task(&conn, &NewTask { title: "Sub".into(), parent_id: Some(parent.id.clone()), ..Default::default() }, now(), &tz).unwrap();
    delete_task(&conn, &earlier.id, now()).unwrap(); // deleted on its own, before the parent
    delete_task(&conn, &parent.id, now() + 10).unwrap();
    let updated = |id: &str| -> i64 {
        conn.query_row("SELECT updated_at FROM items WHERE id = ?1", [id], |r| r.get(0)).unwrap()
    };
    assert_eq!(updated(&sub.id), now() + 10);

    restore_task(&conn, &parent.id, now() + 20).unwrap();
    let detail = get_task(&conn, &parent.id, now(), &tz).unwrap();
    assert_eq!(detail.subtasks.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), vec![sub.id.as_str()]);
    assert_eq!(updated(&parent.id), now() + 20);
    assert_eq!(updated(&sub.id), now() + 20);

    restore_task(&conn, &parent.id, now() + 30).unwrap(); // live task: no change
    assert_eq!(updated(&parent.id), now() + 20);
    assert!(matches!(restore_task(&conn, "missing", now()), Err(AppError::NotFound)));
    let note = items::insert(&conn, "note", "Catatan", "", now()).unwrap();
    assert!(matches!(restore_task(&conn, &note, now()), Err(AppError::NotFound)));
}
```

- [ ] **Step 3: Tulis test yang gagal di `projects.rs`** (`mod tests`; tambah `TaskPatch` ke `use crate::tasks::{...}`)

```rust
#[test]
fn board_sorts_by_priority_then_due() {
    let conn = open_in_memory();
    let tz = jakarta();
    let d1 = ms("2026-09-30T00:00:00+07:00");
    let mk = |title: &str, priority: Option<i64>, due: Option<i64>| {
        let t = create_task(&conn, &NewTask { title: title.into(), ..Default::default() }, now(), &tz).unwrap();
        update_task(&conn, &t.id, &TaskPatch { priority: Some(priority), ..Default::default() }, now(), &tz).unwrap();
        update(&conn, &t.id, &ItemPatch { due_at: Some(due), ..Default::default() }, now()).unwrap();
    };
    mk("Tanpa", None, Some(d1));
    mk("Rendah", Some(3), None);
    mk("Tinggi tanpa tenggat", Some(1), None);
    mk("Tinggi", Some(1), Some(d1));
    let board = project_board(&conn, None, &BoardFilter::default(), now(), &tz).unwrap();
    let titles: Vec<&str> = board.columns.plan.iter().map(|t| t.title.as_str()).collect();
    assert_eq!(titles, vec!["Tinggi", "Tinggi tanpa tenggat", "Rendah", "Tanpa"]);
}

#[test]
fn board_filter_matches_query_tag_priority_and_due() {
    let conn = open_in_memory();
    let tz = jakarta();
    // now() is 2026-09-29 12:00 in Jakarta, so "week" is [29 Sep, 6 Oct).
    let yesterday = ms("2026-09-28T00:00:00+07:00");
    let in_six_days = ms("2026-10-05T00:00:00+07:00");
    let in_seven_days = ms("2026-10-06T00:00:00+07:00");
    let mk = |title: &str, body: &str, tag: Option<&str>, priority: Option<i64>, due: Option<i64>| -> String {
        let t = create_task(&conn, &NewTask { title: title.into(), ..Default::default() }, now(), &tz).unwrap();
        let patch = TaskPatch { tag: Some(tag.map(String::from)), priority: Some(priority), ..Default::default() };
        update_task(&conn, &t.id, &patch, now(), &tz).unwrap();
        update(&conn, &t.id, &ItemPatch { body: Some(body.into()), due_at: Some(due), ..Default::default() }, now()).unwrap();
        t.id
    };
    let late = mk("Laporan 100%", "", Some("kerja"), Some(1), Some(yesterday));
    let soon = mk("Belanja", "beli TERI", Some("kerjaan rumah"), None, Some(in_six_days));
    let later = mk("Nanti", "", None, Some(1), Some(in_seven_days));
    let no_due = mk("Ide", "", Some("Kerja"), Some(3), None);

    let ids = |f: BoardFilter| -> Vec<String> {
        let mut v: Vec<String> = project_board(&conn, None, &f, now(), &tz).unwrap()
            .columns.plan.into_iter().map(|c| c.id).collect();
        v.sort();
        v
    };
    let sorted = |mut v: Vec<String>| { v.sort(); v };
    let q = |s: &str| BoardFilter { query: Some(s.into()), ..Default::default() };

    assert_eq!(ids(q("teri")), vec![soon.clone()]); // body, case-insensitive
    assert_eq!(ids(q("%")), vec![late.clone()]); // % is a literal, not a wildcard
    assert_eq!(ids(q("  ")), sorted(vec![late.clone(), soon.clone(), later.clone(), no_due.clone()]));
    assert_eq!(ids(BoardFilter { tag: Some("#Kerja".into()), ..Default::default() }), sorted(vec![late.clone(), no_due.clone()]));
    assert_eq!(ids(BoardFilter { priority: Some(1), ..Default::default() }), sorted(vec![late.clone(), later.clone()]));
    assert_eq!(ids(BoardFilter { due: Some(DueFilter::Overdue), ..Default::default() }), vec![late.clone()]);
    assert_eq!(ids(BoardFilter { due: Some(DueFilter::Week), ..Default::default() }), vec![soon.clone()]);
    assert_eq!(ids(BoardFilter { due: Some(DueFilter::NoDue), ..Default::default() }), vec![no_due.clone()]);
    assert_eq!(ids(BoardFilter { tag: Some("kerja".into()), priority: Some(3), ..Default::default() }), vec![no_due.clone()]);

    let bad_priority = BoardFilter { priority: Some(0), ..Default::default() };
    assert!(matches!(project_board(&conn, None, &bad_priority, now(), &tz), Err(AppError::Invalid(_))));
    let two_tags = BoardFilter { tag: Some("dua kata".into()), ..Default::default() };
    assert!(matches!(project_board(&conn, None, &two_tags, now(), &tz), Err(AppError::Invalid(_))));

    // Tag options come from the whole board, not the filtered cards.
    assert_eq!(project_board(&conn, None, &q("teri"), now(), &tz).unwrap().tags, vec!["kerja", "kerjaan", "rumah"]);

    let parsed: BoardFilter = serde_json::from_value(serde_json::json!({ "due": "none", "priority": 2 })).unwrap();
    assert_eq!((parsed.due, parsed.priority), (Some(DueFilter::NoDue), Some(2)));
}
```

Ubah semua pemanggilan lama `project_board(&conn, X, now(), &jakarta())` di `mod tests` menjadi `project_board(&conn, X, &BoardFilter::default(), now(), &jakarta())`:

```bash
sed -i 's/project_board(&conn, \(.*\), now(), &jakarta())/project_board(\&conn, \1, \&BoardFilter::default(), now(), \&jakarta())/' src-tauri/src/projects.rs
```

Periksa hasilnya dengan `grep -n "project_board(" src-tauri/src/projects.rs`.

- [ ] **Step 4: Jalankan, pastikan gagal**

Run: `cd src-tauri && cargo test`
Expected: gagal kompilasi (`priority`, `restore_task`, `BoardFilter` belum ada). Test `changing_task_priority_is_captured` di `sync::record` gagal kalau trigger belum diganti.

- [ ] **Step 5: Implementasi `tasks.rs`**

Struct:

```rust
// TaskCard, after project_name:
pub priority: Option<i64>,

// TaskPatch, after tag:
#[serde(default, deserialize_with = "present_opt")]
pub priority: Option<Option<i64>>,
```

Ubah `fn present_opt` menjadi `pub(crate) fn present_opt`.

Di `CARD_SELECT`, tambah `t.priority` sebagai kolom terakhir (indeks 9), setelah subquery `project_name`:

```sql
           (SELECT pi.title FROM items pi WHERE pi.id = t.project_id AND pi.deleted_at IS NULL) AS project_name,
           t.priority
```

Di `card_query`, isi `priority: r.get(9)?,`.

Di `update_task`, setelah blok `tag` dan sebelum `tx.commit()`:

```rust
if let Some(priority) = patch.priority {
    if priority.is_some_and(|p| !(1..=3).contains(&p)) {
        return Err(invalid("Prioritas harus 1 (tinggi), 2 (sedang), atau 3 (rendah)"));
    }
    tx.execute("UPDATE tasks SET priority = ?2 WHERE item_id = ?1", params![id, priority])?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![id, now])?;
}
```

`return` sebelum `commit` membatalkan transaksi, jadi perubahan lain di patch yang sama ikut batal.

`delete_task`: ganti `items::soft_delete(&tx, id, now)?;` dan UPDATE sub-tugas sesudahnya dengan satu pernyataan yang juga mengisi `updated_at` (spec R5):

```rust
tx.execute(
    "UPDATE items SET deleted_at = ?2, updated_at = ?2
     WHERE (id = ?1 OR parent_id = ?1) AND deleted_at IS NULL",
    params![id, now],
)?;
```

Fungsi baru setelah `delete_task`:

```rust
/// Undo for `delete_task` (spec Proyek v2 R5): brings back the task and the subtasks deleted
/// in the same call (same `deleted_at`). A live task is left alone.
pub fn restore_task(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    let deleted_at: Option<i64> = conn
        .query_row("SELECT deleted_at FROM items WHERE id = ?1 AND type = 'task'", [id], |r| r.get(0))
        .optional()?
        .ok_or(AppError::NotFound)?;
    let Some(at) = deleted_at else { return Ok(()) };
    conn.execute(
        "UPDATE items SET deleted_at = NULL, updated_at = ?3
         WHERE (id = ?1 OR parent_id = ?1) AND deleted_at = ?2",
        params![id, at, now],
    )?;
    Ok(())
}
```

- [ ] **Step 6: Implementasi `projects.rs`**

Tipe baru di dekat `Board`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DueFilter {
    Overdue,
    Week,
    #[serde(rename = "none")]
    NoDue,
}

/// Kanban filter (spec Proyek v2 R4). Every field narrows the board; all are computed here.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardFilter {
    pub query: Option<String>,
    pub tag: Option<String>,
    pub priority: Option<i64>,
    pub due: Option<DueFilter>,
}

/// `%text%` for `LIKE … ESCAPE '\'`, so user `%` and `_` match literally.
fn like_escape(text: &str) -> String {
    text.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}
```

`Board` mendapat `pub tags: Vec<String>,`.

Ganti `project_board` (pembagian kolom di akhir fungsi tidak berubah):

```rust
pub fn project_board(
    conn: &Connection,
    id: Option<&str>,
    filter: &BoardFilter,
    now: i64,
    tz: &TimeZone,
) -> Result<Board, AppError> {
    let project = match id {
        Some(proj_id) => Some(get_project(conn, proj_id, now, tz)?),
        None => None,
    };

    let mut clause = String::from("i.parent_id IS NULL AND t.project_id IS ?");
    let mut params: Vec<rusqlite::types::Value> = vec![id.map(str::to_string).into()];
    if let Some(query) = filter.query.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
        clause.push_str(" AND (i.title LIKE ? ESCAPE '\\' OR i.body LIKE ? ESCAPE '\\')");
        let pattern = format!("%{}%", like_escape(query));
        params.push(pattern.clone().into());
        params.push(pattern.into());
    }
    if let Some(raw) = &filter.tag {
        let tag = raw.trim().trim_start_matches('#').to_lowercase();
        if tag.is_empty() || tag.contains(char::is_whitespace) {
            return Err(invalid("Saring satu tag saja"));
        }
        // Tags are space-separated (spec R10); pad so "kerja" does not match "kerjaan".
        clause.push_str(" AND (' ' || lower(COALESCE(t.tag, '')) || ' ') LIKE ? ESCAPE '\\'");
        params.push(format!("% {} %", like_escape(&tag)).into());
    }
    if let Some(priority) = filter.priority {
        if !(1..=3).contains(&priority) {
            return Err(invalid("Prioritas harus 1, 2, atau 3"));
        }
        clause.push_str(" AND t.priority = ?");
        params.push(priority.into());
    }
    if let Some(due) = filter.due {
        let (today_start, _) = day_bounds(now, tz)?;
        match due {
            DueFilter::Overdue => {
                clause.push_str(" AND i.due_at < ? AND t.status != 'done'");
                params.push(today_start.into());
            }
            DueFilter::Week => {
                let week_end = crate::time::local_date(now, tz)?
                    .checked_add(7.days())?
                    .to_zoned(tz.clone())?
                    .timestamp()
                    .as_millisecond();
                clause.push_str(" AND i.due_at >= ? AND i.due_at < ?");
                params.push(today_start.into());
                params.push(week_end.into());
            }
            DueFilter::NoDue => clause.push_str(" AND i.due_at IS NULL"),
        }
    }
    clause.push_str(
        " ORDER BY t.priority IS NULL, t.priority, i.due_at IS NULL, i.due_at, i.created_at, i.id",
    );

    let cards = tasks::card_query(conn, &clause, rusqlite::params_from_iter(params), now, tz)?;
    // ... existing plan/doing/test/review/done split, unchanged ...

    Ok(Board {
        project,
        columns: Columns { plan, doing, test, review, done },
        tags: board_tags(conn, id)?,
    })
}

/// Distinct lower-case tags of the board's top-level tasks, ignoring the filter.
fn board_tags(conn: &Connection, id: Option<&str>) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT t.tag FROM tasks t JOIN items i ON i.id = t.item_id
         WHERE i.deleted_at IS NULL AND i.parent_id IS NULL AND t.tag IS NOT NULL AND t.project_id IS ?1",
    )?;
    let raw = stmt.query_map([id], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
    let tags: std::collections::BTreeSet<String> =
        raw.iter().flat_map(|t| t.split_whitespace()).map(str::to_lowercase).collect();
    Ok(tags.into_iter().collect())
}
```

`t.project_id IS ?` cocok untuk dua kasus sekaligus: `IS 'id'` untuk proyek dan `IS NULL` untuk Tugas lepas. Tambahkan import yang dibutuhkan, yaitu `use jiff::ToSpan;`, `crate::time::day_bounds`, dan `crate::finance::invalid`, kalau belum ada di `projects.rs`.

- [ ] **Step 7: Command**

```rust
#[tauri::command]
pub fn project_board(db: State<'_, Db>, id: Option<String>, filter: Option<BoardFilter>) -> Result<Board, AppError> {
    projects::project_board(&*db.conn()?, id.as_deref(), &filter.unwrap_or_default(), time::now_ms(), &TimeZone::system())
}

#[tauri::command]
pub fn restore_task(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    tasks::restore_task(&*db.conn()?, &id, time::now_ms())
}
```

Import `BoardFilter` dari `crate::projects` di `commands.rs`. Daftarkan `commands::restore_task` di `lib.rs`. Kalau command lain dibungkus guard PIN, ikuti pola itu.

- [ ] **Step 8: Jalankan test**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`
Expected: semua lulus, termasuk test lama di `tasks.rs`, `projects.rs`, dan `sync::record`.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/migrations/0NN_task_priority.sql src-tauri/src/db.rs src-tauri/src/tasks.rs src-tauri/src/projects.rs src-tauri/src/sync/record.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(projects): task priority, board filter and restore_task"
```

---

### Task 2: Tool asisten `update_task`

**Files:**
- Modify: `src-tauri/src/tasks.rs` (pisahkan `update_task_in_transaction` dari `update_task`)
- Modify: `src-tauri/src/assistant/tools.rs` (`definitions` :23-79, struct args, `propose` :190-235, `apply` :241-320, tests)
- Modify: `src/api.ts:766` (`AssistantWriteTool` + `"update_task"`)

**Interfaces:**
- Consumes: `TaskPatch.priority`, `tasks::present_opt` (Task 1).
- Produces (Rust): `pub(crate) fn update_task_in_transaction(tx: &Connection, id: &str, patch: &TaskPatch, now: i64) -> Result<(), AppError>`; tool `update_task { id, status?, priority?, dueAt?, tag? }` yang butuh persetujuan dan mengembalikan `TaskCard`.

- [ ] **Step 1: Tulis test yang gagal** (`assistant/tools.rs`, `mod tests`)

Tambah `("update_task", json!({"id":"task","priority":2})),` ke daftar di `write_tool_becomes_a_proposal_without_db_change`, lalu:

```rust
#[test]
fn apply_update_task_changes_fields_atomically() {
    let conn = open_in_memory();
    let tz = jakarta();
    let task = tasks::create_task(&conn, &tasks::NewTask { title: "Teri".into(), ..Default::default() }, now(), &tz).unwrap();

    let proposal = propose(
        "update_task",
        &json!({"id": task.id, "priority": 1, "dueAt": now(), "status": "doing", "tag": "dapur"}),
    )
    .unwrap();
    assert!(proposal.summary.contains("prioritas"), "{}", proposal.summary);
    let result = apply(&conn, &proposal, now(), &tz).unwrap();
    assert_eq!(result["priority"], 1);
    assert_eq!(result["status"], "doing");
    assert_eq!(result["dueAt"], now());
    assert_eq!(result["tag"], "dapur");

    let clear = propose("update_task", &json!({"id": task.id, "priority": null, "dueAt": null})).unwrap();
    let result = apply(&conn, &clear, now(), &tz).unwrap();
    assert_eq!(result["priority"], Value::Null);
    assert_eq!(result["dueAt"], Value::Null);
    assert_eq!(result["status"], "doing");

    assert!(propose("update_task", &json!({"id": task.id})).is_err()); // nothing to change
    assert!(propose("update_task", &json!({"id": task.id, "delete": true})).is_err());

    // A bad priority leaves the due date untouched.
    let bad = Proposal { id: "p".into(), summary: "".into(), name: "update_task".into(),
        args: json!({"id": task.id, "priority": 9, "dueAt": now() + 1}) };
    assert!(matches!(apply(&conn, &bad, now(), &tz), Err(AppError::Invalid(_))));
    assert_eq!(items::get(&conn, &task.id).unwrap().due_at, None);

    let missing = Proposal { id: "p".into(), summary: "".into(), name: "update_task".into(),
        args: json!({"id": "missing", "priority": 2}) };
    assert!(matches!(apply(&conn, &missing, now(), &tz), Err(AppError::NotFound)));
    assert!(!definitions().iter().any(|d| d["function"]["name"] == "delete_task"));
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd src-tauri && cargo test assistant::tools`
Expected: FAIL (`Tool tidak dikenal: update_task`).

- [ ] **Step 3: Pisahkan `update_task_in_transaction`** (`tasks.rs`)

Pindahkan seluruh isi `update_task` saat ini (cek `task_row`, blok proyek, status, `start_at`, `tag`, dan `priority` dari Task 1) ke fungsi baru. Fungsi baru memakai `tx` yang diterimanya, tanpa membuat dan tanpa meng-commit transaksi sendiri:

```rust
/// Shared update rules for compound operations that own their transaction.
pub(crate) fn update_task_in_transaction(
    tx: &Connection,
    id: &str,
    patch: &TaskPatch,
    now: i64,
) -> Result<(), AppError> {
    let task_row: Option<(Option<String>, Option<String>)> = tx
        .query_row(
            "SELECT i.parent_id, t.project_id FROM items i JOIN tasks t ON t.item_id = i.id WHERE i.id = ?1 AND i.deleted_at IS NULL",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (parent_id, _) = task_row.ok_or(AppError::NotFound)?;
    // ... the rest of the old body, with `&tx` replaced by `tx` ...
    Ok(())
}

pub fn update_task(conn: &Connection, id: &str, patch: &TaskPatch, now: i64, tz: &TimeZone) -> Result<TaskDetail, AppError> {
    let tx = conn.unchecked_transaction()?;
    update_task_in_transaction(&tx, id, patch, now)?;
    tx.commit()?;
    get_task(conn, id, now, tz)
}
```

Perilaku tidak berubah. Test lama `ui_status_and_other_fields_roll_back_if_activity_fails` harus tetap lulus.

- [ ] **Step 4: Tool `update_task`** (`assistant/tools.rs`)

Di `definitions()`, setelah `complete_task`:

```rust
schema(
    "update_task",
    "Usulkan perubahan tugas: status, prioritas (1 tinggi, 2 sedang, 3 rendah, null kosong), tenggat, atau tag. Menunggu persetujuan pengguna.",
    json!({"id":{"type":"string"},
        "status":{"type":"string","enum":["plan","doing","test","review","done"]},
        "priority":{"type":["integer","null"],"minimum":1,"maximum":3},
        "dueAt":{"type":["integer","null"],"description":"Tenggat, epoch milidetik UTC; null mengosongkan"},
        "tag":{"type":["string","null"]}}),
    &["id"],
),
```

Struct args:

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateTaskArgs {
    id: String,
    status: Option<tasks::TaskStatus>,
    #[serde(default, deserialize_with = "tasks::present_opt")]
    priority: Option<Option<i64>>,
    #[serde(default, deserialize_with = "tasks::present_opt")]
    due_at: Option<Option<i64>>,
    #[serde(default, deserialize_with = "tasks::present_opt")]
    tag: Option<Option<String>>,
}
```

Di `propose`, sebelum `"complete_task"`:

```rust
"update_task" => {
    let a: UpdateTaskArgs = decode(name, args)?;
    let fields: Vec<&str> = [
        a.status.map(|_| "status"),
        a.priority.map(|_| "prioritas"),
        a.due_at.map(|_| "tenggat"),
        a.tag.as_ref().map(|_| "tag"),
    ]
    .into_iter()
    .flatten()
    .collect();
    if fields.is_empty() {
        return Err(AppError::Invalid("Tidak ada perubahan tugas".into()));
    }
    format!("Ubah {} tugas {}", fields.join(", "), a.id)
}
```

Di `apply`, sebelum `"add_transaction"`:

```rust
"update_task" => {
    let a: UpdateTaskArgs = decode(name, args)?;
    if let Some(Some(ms)) = a.due_at {
        jiff::Timestamp::from_millisecond(ms)?;
    }
    let tx = conn.unchecked_transaction()?;
    let patch = tasks::TaskPatch { status: a.status, priority: a.priority, tag: a.tag, ..Default::default() };
    // Validates the task first, so the due date below never lands on a missing item.
    tasks::update_task_in_transaction(&tx, &a.id, &patch, now)?;
    if let Some(due) = a.due_at {
        items::update(&tx, &a.id, &items::ItemPatch { due_at: Some(due), ..Default::default() }, now)?;
    }
    let value = encode(tasks::get_task(&tx, &a.id, now, tz)?.card)?;
    tx.commit()?;
    Ok(value)
}
```

`is_read` tidak berubah, karena `update_task` adalah tool tulis. `list_tasks` otomatis membawa `priority` lewat `TaskCard` (R6).

Di `src/api.ts:766`:

```ts
export type AssistantWriteTool = "create_task" | "complete_task" | "update_task" | "add_transaction" | "add_journal_entry" | "check_habit";
```

- [ ] **Step 5: Jalankan test**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings && cd .. && bun run typecheck`
Expected: semua lulus.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/tasks.rs src-tauri/src/assistant/tools.rs src/api.ts
git commit -m "feat(assistant): approval-gated update_task tool"
```

---

### Task 3: Frontend — drag-and-drop, prioritas, filter, hapus + Urungkan

**Files:**
- Modify: `src/api.ts` (tipe di :256-267 dan :301-343, `projectBoard` :929, `restoreTask` setelah `deleteTask` :945)
- Modify: `src/api.test.ts:48,71-72` (bentuk argumen `project_board`, entri `restoreTask`)
- Modify: `src/projects/view.ts` (helper baru), `src/projects/view.test.ts`
- Create: `src/projects/BoardFilterBar.tsx`
- Modify: `src/projects/Kanban.tsx` (props, drag-and-drop, chip prioritas, tombol hapus)
- Create: `src/projects/Kanban.test.tsx`
- Modify: `src/projects/useProjectBoard.ts:20-24,35,94` (argumen `filter`)
- Modify: `src/projects/ProjectsPage.tsx` (state filter, handler drop/hapus, bar filter), `src/projects/ProjectsPage.test.tsx`
- Modify: `src/item/TaskFields.tsx:112-135` (select Prioritas), `src/item/ItemPage.tsx:96-110` (Urungkan setelah hapus tugas)
- Modify: setiap literal `TaskCard`/`TaskDetail`/`Board` di test yang ditandai `bun run typecheck`. Isi `priority: null` dan `tags: []`. Calonnya: `src/projects/useProjectBoard.test.ts`, `src/projects/agent.test.tsx`, `src/projects/view.test.ts`, `src/assistant/AssistantFeedback.test.tsx`, `src/assistant/AssistantStage.test.tsx`.

**Interfaces:**
- Consumes: command `project_board { id, filter }` dan `restore_task { id }` (Task 1).
- Produces (TS):

```ts
export type Priority = 1 | 2 | 3;
export type DueFilter = "overdue" | "week" | "none";
export interface BoardFilter { query?: string; tag?: string; priority?: Priority; due?: DueFilter }
// TaskCard and TaskDetail: priority: Priority | null;
// TaskPatch: priority?: Priority | null;
// Board: tags: string[];
projectBoard: (id: string | null, filter: BoardFilter = {}) => invoke<Board>("project_board", { id, filter }),
restoreTask: (id: string) => invoke<void>("restore_task", { id }),
```

- Kanban props baru: `onDropCard: (card: TaskCard, status: TaskStatus) => void`, `onDeleteCard: (card: TaskCard) => void`, `filtered?: boolean`.
- `view.ts`: `PRIORITY_LABELS`, `dropTarget(columns, id, status)`, `hasFilter(filter)`.

- [ ] **Step 1: Tulis test yang gagal**

`src/projects/view.test.ts`. Tambah `PRIORITY_LABELS, dropTarget, hasFilter` ke import, lalu:

```ts
test("dropTarget only returns cards that change column", () => {
  const card: TaskCard = { id: "a", title: "A", status: "plan", tag: null, dueAt: null, overdue: false,
    subDone: 0, subTotal: 0, projectId: null, projectName: null, priority: null };
  const columns: Columns = { plan: [card], doing: [], test: [], review: [], done: [] };
  expect(dropTarget(columns, "a", "doing")).toBe(card);
  expect(dropTarget(columns, "a", "plan")).toBeNull();
  expect(dropTarget(columns, "missing", "doing")).toBeNull();
});

test("hasFilter ignores a blank search and priority labels follow the spec", () => {
  expect(hasFilter({})).toBe(false);
  expect(hasFilter({ query: "  " })).toBe(false);
  expect(hasFilter({ due: "none" })).toBe(true);
  expect([1, 2, 3].map((p) => PRIORITY_LABELS[p as Priority].label)).toEqual(["Tinggi", "Sedang", "Rendah"]);
});
```

(Import `Columns`, `Priority`, `TaskCard` sebagai type dari `../api`.)

`src/projects/Kanban.test.tsx`:

```tsx
import { describe, expect, it, mock } from "bun:test";
import type { ComponentProps } from "react";
import type { Columns, TaskCard } from "../api";
import { elements, hookHarness } from "../test/hookHarness";
import { Kanban } from "./Kanban";

const card: TaskCard = { id: "a", title: "Tugas", status: "plan", tag: "kerja", dueAt: null, overdue: false,
  subDone: 0, subTotal: 0, projectId: null, projectName: null, priority: 1 };
const columns: Columns = { plan: [card], doing: [], test: [], review: [], done: [] };

function setup(overrides: Partial<ComponentProps<typeof Kanban>> = {}) {
  const props: ComponentProps<typeof Kanban> = {
    columns, onOpenItem: () => {}, onMoveCard: () => {}, onDropCard: mock(() => {}),
    onDeleteCard: mock(() => {}), onCreateTask: async () => {}, ...overrides,
  };
  const harness = hookHarness(() => Kanban(props));
  return { props, harness, tree: () => elements(harness.render()) };
}

describe("Kanban", () => {
  it("moves a dropped card to the column it lands on", () => {
    const { props, harness, tree } = setup();
    const drop = (title: string) => {
      const section = tree().find((e) => e.type === "section" && e.props["aria-label"] === title)!;
      (section.props.onDrop as (e: unknown) => void)({ preventDefault() {}, dataTransfer: { getData: () => "a" } });
    };
    drop("Rencana");
    expect(props.onDropCard).not.toHaveBeenCalled();
    drop("Dikerjakan");
    expect(props.onDropCard).toHaveBeenCalledWith(card, "doing");
    harness.dispose();
  });

  it("marks cards draggable, shows the priority chip and deletes from the card", () => {
    const { props, harness, tree } = setup();
    const article = tree().find((e) => e.type === "article")!;
    expect(article.props.draggable).toBe(true);
    expect(tree().some((e) => e.type === "span" && e.props.children === "Tinggi")).toBe(true);
    const remove = tree().find((e) => e.type === "button" && e.props["aria-label"] === "Hapus tugas")!;
    (remove.props.onClick as () => void)();
    expect(props.onDeleteCard).toHaveBeenCalledWith(card);
    harness.dispose();
  });

  it("says nothing matches when a filtered column is empty", () => {
    const { harness, tree } = setup({ filtered: true });
    expect(tree().some((e) => e.props.children === "Tidak ada yang cocok")).toBe(true);
    harness.dispose();
  });
});
```

`src/projects/ProjectsPage.test.tsx`: tambah `tags: []` ke literal `Board` yang ada, lalu tambah describe baru di akhir file. Import tambahan: `import * as toastModule from "../shell/toast";`, `import type { ToastAction } from "../shell/toast";`, `import { BoardFilterBar } from "./BoardFilterBar";`.

```tsx
describe("project page task actions", () => {
  it("passes the filter to the board and deletes a card with undo", async () => {
    const toast = mock((_text: string, _kind?: string, _action?: ToastAction) => {});
    const card = { ...task, projectId: ordinary.id, status: "plan" as const };
    const spies = [
      spyOn(toastModule, "useToast").mockReturnValue(toast),
      spyOn(api, "projectsOverview").mockResolvedValue({ projects: [ordinary], activeCount: 1, loose: { done: 0, total: 0 }, upcoming: [] }),
      spyOn(api, "projectBoard").mockResolvedValue({ project: ordinary, columns: { plan: [card], doing: [], test: [], review: [], done: [] }, tags: ["kerja"] }),
      spyOn(api, "deleteTask").mockResolvedValue(undefined),
      spyOn(api, "restoreTask").mockResolvedValue(undefined),
      spyOn(api, "updateTask").mockResolvedValue({ ...card, parentId: null, parentTitle: null, startAt: null, subtasks: [] }),
    ];
    const harness = hookHarness(() => ProjectsPage({ onOpenItem: () => {}, onChanged: () => {}, onOpenAssistant: () => {} }));
    harness.render();
    await harness.settle();
    const find = <T,>(type: unknown) => elements(harness.render()).find((e) => e.type === type)!.props as T;
    const kanban = () => find<ComponentProps<typeof Kanban>>(Kanban);
    const bar = () => find<ComponentProps<typeof BoardFilterBar>>(BoardFilterBar);

    expect(bar().tags).toEqual(["kerja"]);
    bar().onChange({ tag: "kerja" });
    await harness.settle();
    expect(api.projectBoard).toHaveBeenLastCalledWith(ordinary.id, { tag: "kerja" });
    expect(kanban().filtered).toBe(true);

    kanban().onDropCard(card, "doing");
    await harness.settle();
    expect(api.updateTask).toHaveBeenCalledWith(card.id, { status: "doing" });

    kanban().onDeleteCard(card);
    await harness.settle();
    expect(api.deleteTask).toHaveBeenCalledWith(card.id);
    const [text, kind, action] = toast.mock.calls.at(-1)!;
    expect([text, kind, action?.label]).toEqual(["Tugas dihapus", "info", "Urungkan"]);
    action!.run();
    await harness.settle();
    expect(api.restoreTask).toHaveBeenCalledWith(card.id);
    harness.dispose();
    spies.forEach((spy) => spy.mockRestore());
  });
});
```

`src/api.test.ts`: ubah dua baris `projectBoard` dan tambah satu entri:

```ts
["projectBoard", () => api.projectBoard(null), "project_board", { id: null, filter: {} }],
["projectBoard", () => api.projectBoard("project", { due: "week" }), "project_board", { id: "project", filter: { due: "week" } }],
["restoreTask", () => api.restoreTask("task"), "restore_task", { id: "task" }],
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `TZ=Asia/Jakarta bun test src/projects src/api.test.ts`
Expected: FAIL (`dropTarget`, `BoardFilterBar`, `restoreTask` belum ada).

- [ ] **Step 3: `api.ts` dan `view.ts`**

Tambahkan tipe dan fungsi dari blok Interfaces di atas ke `api.ts`. `priority` ditambahkan ke `TaskCard` dan `TaskDetail` setelah `projectName`, ke `TaskPatch`, dan `tags` ditambahkan ke `Board`. Lalu `view.ts`:

```ts
export const PRIORITY_LABELS: Readonly<Record<Priority, { label: string; className: string }>> = {
  1: { label: "Tinggi", className: "text-danger" },
  2: { label: "Sedang", className: "text-warn" },
  3: { label: "Rendah", className: "text-muted" },
};

/** The card being dropped, or null when it stays in its own column. */
export function dropTarget(columns: Columns, id: string, status: TaskStatus): TaskCard | null {
  const card = Object.values(columns).flat().find((c) => c.id === id);
  return card && card.status !== status ? card : null;
}

export function hasFilter(filter: BoardFilter): boolean {
  return Boolean(filter.query?.trim() || filter.tag || filter.priority || filter.due);
}
```

(Tambah `BoardFilter`, `Columns`, `Priority` ke import type dari `../api`.)

- [ ] **Step 4: `BoardFilterBar.tsx`**

```tsx
import type { BoardFilter, DueFilter, Priority } from "../api";
import { FIELD } from "../shell/ui";
import { hasFilter } from "./view";

const SELECT = `${FIELD} py-1.5 px-2.5 text-xs`;

export function BoardFilterBar({
  filter,
  tags,
  onChange,
}: Readonly<{ filter: BoardFilter; tags: readonly string[]; onChange: (filter: BoardFilter) => void }>) {
  return (
    <div role="search" aria-label="Saring tugas" className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        aria-label="Cari tugas"
        placeholder="Cari tugas…"
        value={filter.query ?? ""}
        onChange={(e) => onChange({ ...filter, query: e.target.value || undefined })}
        className={`${FIELD} w-56 py-1.5 text-xs`}
      />
      <select aria-label="Saring tag" value={filter.tag ?? ""} className={SELECT}
        onChange={(e) => onChange({ ...filter, tag: e.target.value || undefined })}>
        <option value="">Semua tag</option>
        {tags.map((tag) => <option key={tag} value={tag}>#{tag}</option>)}
      </select>
      <select aria-label="Saring prioritas" value={filter.priority ?? ""} className={SELECT}
        onChange={(e) => onChange({ ...filter, priority: e.target.value ? (Number(e.target.value) as Priority) : undefined })}>
        <option value="">Semua prioritas</option>
        <option value="1">Tinggi</option>
        <option value="2">Sedang</option>
        <option value="3">Rendah</option>
      </select>
      <select aria-label="Saring tenggat" value={filter.due ?? ""} className={SELECT}
        onChange={(e) => onChange({ ...filter, due: (e.target.value || undefined) as DueFilter | undefined })}>
        <option value="">Semua tenggat</option>
        <option value="overdue">Terlambat</option>
        <option value="week">7 hari ke depan</option>
        <option value="none">Tanpa tenggat</option>
      </select>
      {hasFilter(filter) && (
        <button type="button" onClick={() => onChange({})} className="text-xs text-muted hover:text-ink">
          Reset
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `Kanban.tsx`**

Props baru (tambah ke destructuring dan tipe `Readonly<{...}>`):

```tsx
onDropCard: (card: TaskCard, status: TaskStatus) => void;
onDeleteCard: (card: TaskCard) => void;
filtered?: boolean;
```

State baru, ditaruh **setelah** dua `useState` yang ada supaya urutan slot test lama tidak bergeser: `const [overCol, setOverCol] = useState<TaskStatus | null>(null);`. Import `dropTarget` dan `PRIORITY_LABELS` dari `./view`.

`<section>` kolom mendapat handler drop. Tambahkan `ring-1 ring-accent` saat `overCol === col.status`:

```tsx
onDragOver={(e) => { e.preventDefault(); setOverCol(col.status); }}
onDragLeave={() => setOverCol((current) => (current === col.status ? null : current))}
onDrop={(e) => {
  e.preventDefault();
  setOverCol(null);
  const card = dropTarget(columns, e.dataTransfer.getData("text/plain"), col.status);
  if (card) onDropCard(card, col.status);
}}
```

Kedua jenis `<article>` (ringkas dan biasa) mendapat:

```tsx
draggable
onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; }}
```

Di kartu biasa, chip prioritas ditaruh sebelum chip tag:

```tsx
{c.priority !== null && (
  <span className={`rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold ${PRIORITY_LABELS[c.priority].className}`}>
    {PRIORITY_LABELS[c.priority].label}
  </span>
)}
```

Tombol hapus ditaruh di kedua jenis kartu, tepat sebelum tombol →/↺:

```tsx
<button
  type="button"
  onClick={() => onDeleteCard(c)}
  aria-label="Hapus tugas"
  title="Hapus tugas"
  className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-danger"
>
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
  </svg>
</button>
```

Di kartu biasa, `ml-auto` pindah dari tombol → ke tombol hapus supaya keduanya tetap di kanan. Teks kolom kosong menjadi `{filtered ? "Tidak ada yang cocok" : "Kosong"}`. Tombol → dan ↺ tetap ada untuk keyboard (R1).

- [ ] **Step 6: `useProjectBoard.ts` dan `ProjectsPage.tsx`**

`useProjectBoard(selectedId, version, openTaskId = null, filter: BoardFilter = {})`. Di `refresh`, panggil `api.projectBoard(selectedId ?? null, filter)`. Tambahkan `const filterKey = JSON.stringify(filter);` di awal hook, lalu masukkan `filterKey` ke dependency effect pertama (`[selectedId, version, toast, filterKey]`) supaya objek baru dengan isi sama tidak memicu fetch ulang.

`ProjectsPage.tsx`:

```tsx
const [filter, setFilter] = useState<BoardFilter>({});
// ...
const { board, lastActors, activities, running } = useProjectBoard(selectedId, version, openTaskId, filter);

function reload() {
  setVersion((v) => v + 1);
  onChanged();
}

async function moveTo(card: TaskCard, status: TaskStatus) {
  try {
    await api.updateTask(card.id, { status });
    reload();
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}

async function handleDeleteCard(card: TaskCard) {
  try {
    await api.deleteTask(card.id);
    reload();
    toast("Tugas dihapus", "info", {
      label: "Urungkan",
      run: () => void api.restoreTask(card.id).then(reload, (e) => toast(errorMessage(e), "error")),
    });
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}
```

`handleMoveCard(card)` menjadi `void moveTo(card, nextStatus(card.status, agentProject !== null))`. Handler `onSelect` di `ProjectList` menjadi `(id) => { setSelectedId(id); setFilter({}); }`, karena berganti proyek mengosongkan filter (R4). Saat `activeTab === "kanban"` dan `board` ada, render `BoardFilterBar` di atas `<div className="flex min-h-0 flex-1 gap-3.5">` yang membungkus `Kanban`:

```tsx
<BoardFilterBar filter={filter} tags={board.tags} onChange={setFilter} />
```

Lalu teruskan ke `Kanban`: `onDropCard={(card, status) => void moveTo(card, status)}`, `onDeleteCard={(card) => void handleDeleteCard(card)}`, `filtered={hasFilter(filter)}`.

- [ ] **Step 7: Halaman item**

`TaskFields.tsx`: select Prioritas ditaruh di baris pertama, setelah select Proyek:

```tsx
<div className="flex items-center gap-2 text-xs text-muted">
  <label htmlFor="task-priority">Prioritas</label>
  <select
    id="task-priority"
    value={task.priority ?? ""}
    onChange={(e) => void saveTaskPatch({ priority: e.target.value ? (Number(e.target.value) as Priority) : null })}
    className={`${FIELD} py-1 px-2.5 text-xs`}
  >
    <option value="">Tanpa</option>
    <option value="1">Tinggi</option>
    <option value="2">Sedang</option>
    <option value="3">Rendah</option>
  </select>
</div>
```

`ItemPage.tsx` `remove()`: cabang tugas mendapat Urungkan. Konfirmasi "Hapus item ini?" yang sudah ada tetap dipakai.

```tsx
if (item?.type === "task") {
  await api.deleteTask(id);
  toast("Tugas dihapus", "info", {
    label: "Urungkan",
    run: () => void api.restoreTask(id).then(() => onOpenItem(id), (e) => toast(errorMessage(e), "error")),
  });
} else {
  await api.deleteItem(id);
}
```

- [ ] **Step 8: Jalankan test**

Run: `bun run typecheck && TZ=Asia/Jakarta bun test`
Expected: semua lulus. Kalau typecheck menandai literal `TaskCard`/`TaskDetail`/`Board` di test lain, tambahkan `priority: null` / `tags: []`.

- [ ] **Step 9: Commit**

```bash
git add src/api.ts src/api.test.ts src/projects/ src/item/TaskFields.tsx src/item/ItemPage.tsx src/assistant/AssistantFeedback.test.tsx src/assistant/AssistantStage.test.tsx
git commit -m "feat(projects): drag and drop, priority chips, board filter, delete with undo"
```

(`git add` hanya file yang benar-benar berubah; cek `git status` dulu.)

---

### Task 4: E2E dan PR (sesi Opus)

**Files:**
- Modify: `scripts/e2e-smoke.sh` (fungsi baru `check_projects_v2`, dipanggil tepat setelah `check_projects` di daftar akhir; perbarui koordinat `check_projects` kalau bar filter menggeser kanban)

- [ ] **Step 1: Ukur ulang koordinat.** Bar filter menambah satu baris di atas kanban, jadi koordinat `+ Tugas` (450,355) dan tombol → (646,445) di `check_projects` kemungkinan bergeser. Jalankan E2E sekali, buka `~/.cache/anchoa-e2e/12-projects-empty.png` dan `12-projects.png`, lalu perbarui koordinatnya.

- [ ] **Step 2: Tambah `check_projects_v2`.** Ikuti gaya `check_projects` (`fresh`, `start_app`, `click`, `sql_becomes`, `shot`, `[[ ... ]]`). Ambil koordinat dari screenshot.
  1. Nav Proyek (`click 36 472`), buat proyek "Proyek v2" (`+ Proyek`, ketik, Enter), lalu dua tugas di Rencana: "Tugas hapus" dan "Tugas tinggi".
  2. `sql "UPDATE tasks SET priority = 1 WHERE item_id = (SELECT id FROM items WHERE title = 'Tugas tinggi')"`. Pindah ke Dashboard (`click 36 94`) lalu kembali ke Proyek supaya board dimuat ulang. `shot 12-projects-priority`: chip "Tinggi" tampil dan "Tugas tinggi" berada paling atas di Rencana.
  3. Klik kotak "Cari tugas…", ketik `hapus`. `shot 12-projects-filter`: hanya "Tugas hapus" yang tampil. Klik "Reset".
  4. Klik tombol hapus di kartu "Tugas hapus". `sql_becomes "SELECT deleted_at IS NOT NULL FROM items WHERE title = 'Tugas hapus'" 1 || fail "task not deleted"`. Klik "Urungkan" di toast (dalam 6 detik). `sql_becomes "SELECT deleted_at IS NULL FROM items WHERE title = 'Tugas hapus'" 1 || fail "undo did not restore the task"`.
  5. Drag-and-drop: coba `xdotool mousemove <kartu> mousedown 1 mousemove <kolom Dikerjakan> mouseup 1`, lalu `sql_becomes "SELECT status FROM tasks WHERE item_id = (SELECT id FROM items WHERE title = 'Tugas hapus')" doing`. Kalau WebKitGTK tidak memicu drag HTML5 dari input sintetis, ganti dengan tombol → di kartu yang sama dan tulis di PR bahwa logika drop dites di `Kanban.test.tsx` (R18).
  6. `shot 12-projects-v2`, lalu `stop_app`.

- [ ] **Step 3: Jalankan suite penuh.**

```bash
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings && cd ..
bun run typecheck && bun run test
bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa
```

Cek screenshot di `~/.cache/anchoa-e2e/`. Cek juga drag-and-drop di layar sungguhan kalau E2E memakai fallback tombol →. Itu masuk daftar cek manual untuk user.

- [ ] **Step 4: Commit, push, PR.** Commit `test(e2e): projects priority, filter, delete undo`. Push branch `feat/145-proyek-dasar`, lalu buka PR berisi bukti test, nama screenshot, dan `Closes #145`. Jalankan review Sol dan agy secara paralel (perintah di `CLAUDE.md`, spec `docs/superpowers/specs/2026-10-03-anchoa-proyek-v2-design.md`). Verifikasi setiap temuan, perbaiki yang nyata, lalu merge saat semua hijau (`gh pr merge --squash --delete-branch`). Tanpa rilis.

- [ ] **Step 5: Handoff.** Tulis ke `.remember/now.md`: P-1 selesai, dan P-2 dikerjakan berikutnya di sesi baru. Sesi P-2 menulis `docs/superpowers/plans/<tanggal>-anchoa-proyek-v2-p2.md` dari spec R7–R10 sebelum menulis kode.
