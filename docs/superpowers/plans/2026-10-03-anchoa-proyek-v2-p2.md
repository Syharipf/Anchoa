# Anchoa Proyek v2 — P-2 Struktur: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementasi utama oleh Codex gpt-6.1-sol xhigh (`codex exec -s workspace-write`, satu task per run). Kalau kuotanya habis, pakai `agy-multi --model gemini-3.8-flash-high`. Review oleh agy dan Sol, lalu dicek sesi Opus.

> **Baca dulu:** rencana ini ditulis terhadap `main` sebelum P-1 (#145) di-merge. P-1 menambah `tasks.priority`, `BoardFilter` di `project_board`, `restore_task`, drag-and-drop, dan bar filter di atas kanban. Sebelum Task 1, sesi Opus membaca ulang semua file di bawah setelah P-1 ada di `main` dan menyesuaikan nomor baris, indeks kolom `CARD_SELECT`, nama helper prioritas, dan nomor migrasi. Antarmuka P-1 yang dipakai di sini (dari spec): `TaskCard.priority: Option<i64>` (`number | null` di TS), `BoardFilter { query, tag, priority, due }` dengan `Default`, dan bar filter di `ProjectsPage`.

**Goal:** tugas bisa dilihat sebagai Daftar, bisa berulang harian/mingguan/bulanan, proyek bisa diarsipkan, dan tugas bisa punya beberapa tag.

**Architecture:** satu migrasi baru menambah `tasks.recur` dan `projects.archived_at`, sekaligus membuat ulang trigger sync `tasks`/`projects` agar kolom baru tercatat. Tugas berulang dibuat di `activities::set_status_in_transaction`, satu-satunya jalur yang dilewati semua perpindahan status (kanban, halaman item, asisten, dashboard, CLI agen). Arsip memisah `projects_overview` menjadi `projects` dan `archived`. Tampilan Daftar murni presentasi di frontend atas data board yang sudah tersaring.

**Tech Stack:** Rust + rusqlite + jiff, React + TypeScript, bun test, Xvfb E2E.

**Spec:** `docs/superpowers/specs/2026-10-03-anchoa-proyek-v2-design.md` (R7–R10, R18, §3).

## Global Constraints

- Semua aturan di `CLAUDE.md` berlaku. Frontend hanya lewat `src/api.ts`. Delete = soft delete; setiap query menyaring `deleted_at IS NULL`.
- Batas hari dan hitungan tanggal di Rust, waktu lokal. Command mengembalikan `Result<T, AppError>`, tanpa panic.
- SonarCloud: props `Readonly<...>`, elemen non-tombol dengan `onClick` butuh handler keyboard, tanpa `Math.random()`, bash pakai `[[ ... ]]`.
- Teks UI Bahasa Indonesia, tanpa kata "Fase".
- Tanpa dependency baru. Tanpa bump versi (rilis setelah P-4).
- Setiap kolom baru di `tasks`/`projects` masuk `EXTENSIONS` di `src-tauri/src/sync/record.rs`, dan trigger update sync-nya ikut membandingkan kolom itu.
- Sesi ini hanya mengerjakan P-2. P-3 dan P-4 dikerjakan di sesi Claude Code lain.

| PR | Task |
|---|---|
| P-2 (#146, milestone "Proyek v2") | 1–4 |

## Menjalankan task

Satu task per run, di worktree branch `feat/146-proyek-struktur` (di `~/Projects/anchoa-wt/`), dari root worktree:

- **Sol:** `codex exec -m gpt-6.1-sol -c model_reasoning_effort=xhigh -s workspace-write -C <worktree> "Implement Task <N> of docs/superpowers/plans/2026-10-03-anchoa-proyek-v2-p2.md exactly as written, test first. Read the spec docs/superpowers/specs/2026-10-03-anchoa-proyek-v2-design.md and CLAUDE.md. Work only inside this repository; do not push, merge, open PRs, or edit docs/. Print the tail of each check." < /dev/null`. Sandbox Sol tidak bisa commit, jadi sesi Opus yang commit.
- **Gemini (cadangan):** `agy-multi --model gemini-3.8-flash-high --dangerously-skip-permissions --print-timeout 2100s -p "<prompt yang sama, plus: stage files by explicit path, never git add -A; commit with the task's message>" < /dev/null`.

Setelah setiap run, sesi Opus menjalankan test task itu dan membaca diff-nya.

---

### Task 1: Backend — migrasi, tugas berulang, banyak tag

**Files:**
- Create: `src-tauri/migrations/015_project_structure.sql` (pakai nomor berikutnya di `main`; P-1 kemungkinan memakai `014`)
- Modify: `src-tauri/src/db.rs` (daftar `include_str!` migrasi, setelah baris migrasi terakhir)
- Modify: `src-tauri/src/tasks.rs` (enum `Recur`, `TaskCard.recur`, `TaskPatch.recur`, `CARD_SELECT`, `card_query`, `update_task`, fungsi baru `spawn_next_in_transaction`, `next_due`, tests)
- Modify: `src-tauri/src/activities.rs:207-256` (`set_status_in_transaction` dan `set_status` menerima `tz`) dan pemanggilnya di tests modul itu
- Modify: `src-tauri/src/cli.rs:390` (teruskan `&tz`)
- Modify: `src-tauri/src/projects.rs` (hanya test regresi filter tag)
- Modify: `src-tauri/src/sync/record.rs` (`EXTENSIONS` tasks + projects, fixture `INSERT` posisional, test enqueue)

**Interfaces:**
- Consumes (P-1): kolom `tasks.priority`, `TaskCard.priority`, `BoardFilter` + `project_board(conn, id, &filter, now, tz)`.
- Produces (Rust):
  - `pub enum Recur { Daily, Weekly, Monthly }` (serde lowercase, `ToSql`/`FromSql` `"daily"|"weekly"|"monthly"`);
  - `TaskCard.recur: Option<Recur>` (JSON `recur: "daily" | "weekly" | "monthly" | null`);
  - `TaskPatch.recur: Option<Option<Recur>>` (`null` mengosongkan);
  - `pub(crate) fn spawn_next_in_transaction(conn: &Connection, id: &str, now: i64, tz: &TimeZone) -> Result<Option<String>, AppError>`;
  - `pub fn set_status(conn, task_id, status, actor, now, tz: &TimeZone)` dan `pub(crate) fn set_status_in_transaction(conn, task_id, status, actor, now, tz: &TimeZone)`.
- Produces (SQL): `tasks.recur TEXT`, `projects.archived_at INTEGER` (dipakai Task 2).

- [ ] **Step 1: Migrasi**

```sql
-- 015_project_structure.sql (Proyek v2 R8, R9)
ALTER TABLE tasks ADD COLUMN recur TEXT;
ALTER TABLE projects ADD COLUMN archived_at INTEGER;

-- Spec §3: recreate the sync update triggers so the new columns create new record versions.
DROP TRIGGER sync_tasks_update;
CREATE TRIGGER sync_tasks_update AFTER UPDATE ON tasks
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND (old.item_id IS NOT new.item_id OR old.status IS NOT new.status OR old.project_id IS NOT new.project_id
       OR old.start_at IS NOT new.start_at OR old.tag IS NOT new.tag OR old.priority IS NOT new.priority
       OR old.recur IS NOT new.recur)
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

-- agent, agent_command and agent_dir are per-device and stay local.
DROP TRIGGER sync_projects_update;
CREATE TRIGGER sync_projects_update AFTER UPDATE OF item_id, kind, deadline_at, repo_url, archived_at ON projects
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND (old.item_id IS NOT new.item_id OR old.kind IS NOT new.kind OR old.deadline_at IS NOT new.deadline_at
       OR old.repo_url IS NOT new.repo_url OR old.archived_at IS NOT new.archived_at)
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;
```

Spec §3: setiap migrasi membuat ulang trigger update sync yang kolomnya berubah. Migrasi P-1 sudah membuat ulang `sync_tasks_update` dengan `priority`; P-2 membuatnya ulang lagi dengan `priority` dan `recur` (salin isi P-1 dan tambahkan hanya `OR old.recur IS NOT new.recur` kalau bentuknya berbeda dari blok di atas), serta `sync_projects_update` dengan `archived_at` di `AFTER UPDATE OF` dan di `WHEN`. Tambahkan `include_str!("../migrations/015_project_structure.sql"),` di `db.rs`.

Di `sync/record.rs`:
- `EXTENSIONS` tasks: `columns: &["item_id", "status", "project_id", "start_at", "tag", "priority", "recur"]` (urutan kolom P-1 dipertahankan, `recur` di akhir).
- `EXTENSIONS` projects: `columns: &["item_id", "kind", "deadline_at", "repo_url", "archived_at"]`.
- Fixture test `EXTENSIONS` (sekitar baris 460–477) memakai `INSERT ... VALUES` posisional; kolom baru di akhir tabel membuatnya gagal. Ubah dua baris itu menjadi bernama kolom:

```rust
(
    "project",
    "projects",
    "INSERT INTO projects (item_id, kind, deadline_at, repo_url, agent, agent_command, agent_dir, archived_at)
     VALUES ('project', 'app', 90, 'https://example.test/repo', 1, 'local command', '/local/repo', 70)",
    "kind = 'research'",
),
// ...
("task", "tasks", "INSERT INTO tasks (item_id, status, project_id, start_at, tag, priority, recur) VALUES ('task', 'doing', 'project', 90, 'tag', 1, 'weekly')", "status = 'review'"),
```

- [ ] **Step 2: Tulis test yang gagal**

Di `mod tests` `tasks.rs` (helper `make_project`, `jakarta`, `ms`, `now`, `update`, `ItemPatch` sudah di-import di modul itu):

```rust
fn recurring_task(conn: &Connection, project: Option<&str>, due: i64, recur: Recur) -> String {
    let card = create_task(
        conn,
        &NewTask { title: "Laporan".into(), project_id: project.map(Into::into), ..Default::default() },
        now(),
        &jakarta(),
    )
    .unwrap();
    update(conn, &card.id, &ItemPatch { body: Some("isi".into()), due_at: Some(Some(due)), ..Default::default() }, now())
        .unwrap();
    let patch = TaskPatch {
        recur: Some(Some(recur)),
        tag: Some(Some("Kerja #rumah kerja".into())),
        start_at: Some(Some(due - 86_400_000)),
        ..Default::default()
    };
    let detail = update_task(conn, &card.id, &patch, now(), &jakarta()).unwrap();
    assert_eq!(detail.card.recur, Some(recur));
    assert_eq!(detail.card.tag.as_deref(), Some("kerja rumah"));
    card.id
}

fn live_tasks_titled(conn: &Connection, title: &str) -> Vec<(String, Option<i64>, String, Option<String>)> {
    conn.prepare(
        "SELECT i.id, i.due_at, t.status, t.recur FROM items i JOIN tasks t ON t.item_id = i.id
         WHERE i.title = ?1 AND i.deleted_at IS NULL ORDER BY i.due_at",
    )
    .unwrap()
    .query_map([title], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
    .unwrap()
    .collect::<Result<_, _>>()
    .unwrap()
}

#[test]
fn completing_a_recurring_task_creates_the_next_one() {
    let conn = open_in_memory();
    let project = make_project(&conn, "Kantor");
    let due = ms("2026-01-31T00:00:00+07:00");
    let id = recurring_task(&conn, Some(&project), due, Recur::Monthly);

    let done = TaskPatch { status: Some(TaskStatus::Done), ..Default::default() };
    update_task(&conn, &id, &done, now(), &jakarta()).unwrap();

    let rows = live_tasks_titled(&conn, "Laporan");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0], (id.clone(), Some(due), "done".into(), None)); // the rule moved to the new task
    let next = &rows[1];
    assert_eq!(next.1, Some(ms("2026-02-28T00:00:00+07:00")));
    assert_eq!((next.2.as_str(), next.3.as_deref()), ("plan", Some("monthly")));
    let detail = get_task(&conn, &next.0, now(), &jakarta()).unwrap();
    assert_eq!(detail.card.project_id.as_deref(), Some(project.as_str()));
    assert_eq!(detail.card.tag.as_deref(), Some("kerja rumah"));
    assert_eq!(detail.start_at, Some(ms("2026-02-27T00:00:00+07:00")));
    assert_eq!(items::get(&conn, &next.0).unwrap().body, "isi");

    // Reopening and finishing the old task again does not create a third one.
    let reopen = TaskPatch { status: Some(TaskStatus::Plan), ..Default::default() };
    update_task(&conn, &id, &reopen, now(), &jakarta()).unwrap();
    update_task(&conn, &id, &done, now(), &jakarta()).unwrap();
    assert_eq!(live_tasks_titled(&conn, "Laporan").len(), 2);
}

#[test]
fn agent_status_moves_also_spawn_recurring_tasks() {
    let conn = open_in_memory();
    let project = make_project(&conn, "Agen");
    let id = recurring_task(&conn, Some(&project), ms("2026-12-31T00:00:00+07:00"), Recur::Daily);
    crate::activities::set_status(&conn, &id, TaskStatus::Done, "Sol", now(), &jakarta()).unwrap();
    let rows = live_tasks_titled(&conn, "Laporan");
    assert_eq!(rows[1].1, Some(ms("2027-01-01T00:00:00+07:00")));
}

#[test]
fn next_due_clamps_to_the_end_of_the_month() {
    let tz = jakarta();
    let next = |at: &str, recur| next_due(ms(at), recur, &tz).unwrap();
    assert_eq!(next("2026-01-31T00:00:00+07:00", Recur::Monthly), ms("2026-02-28T00:00:00+07:00"));
    assert_eq!(next("2028-01-31T00:00:00+07:00", Recur::Monthly), ms("2028-02-29T00:00:00+07:00"));
    assert_eq!(next("2026-02-28T00:00:00+07:00", Recur::Monthly), ms("2026-03-28T00:00:00+07:00"));
    assert_eq!(next("2026-03-31T00:00:00+07:00", Recur::Monthly), ms("2026-04-30T00:00:00+07:00"));
    assert_eq!(next("2026-12-31T00:00:00+07:00", Recur::Daily), ms("2027-01-01T00:00:00+07:00"));
    assert_eq!(next("2026-12-29T00:00:00+07:00", Recur::Weekly), ms("2027-01-05T00:00:00+07:00"));
}

#[test]
fn recur_needs_a_due_date_and_a_parent_task() {
    let conn = open_in_memory();
    let tz = jakarta();
    let parent = create_task(&conn, &NewTask { title: "Induk".into(), ..Default::default() }, now(), &tz).unwrap();
    let weekly = TaskPatch { recur: Some(Some(Recur::Weekly)), ..Default::default() };
    assert!(matches!(update_task(&conn, &parent.id, &weekly, now(), &tz), Err(AppError::Invalid(_))));

    let child = create_task(
        &conn,
        &NewTask { title: "Anak".into(), parent_id: Some(parent.id.clone()), ..Default::default() },
        now(),
        &tz,
    )
    .unwrap();
    update(&conn, &child.id, &ItemPatch { due_at: Some(Some(now())), ..Default::default() }, now()).unwrap();
    assert!(matches!(update_task(&conn, &child.id, &weekly, now(), &tz), Err(AppError::Invalid(_))));

    // Clearing works without a due date, and a recurring task without a due date spawns nothing.
    let clear = TaskPatch { recur: Some(None), ..Default::default() };
    assert_eq!(update_task(&conn, &parent.id, &clear, now(), &tz).unwrap().card.recur, None);
}

#[test]
fn tags_are_normalized_space_separated() {
    let conn = open_in_memory();
    let tz = jakarta();
    let t = create_task(&conn, &NewTask { title: "Tag".into(), ..Default::default() }, now(), &tz).unwrap();
    let patch = |raw: &str| TaskPatch { tag: Some(Some(raw.into())), ..Default::default() };
    assert_eq!(update_task(&conn, &t.id, &patch("  UI  #ui backend "), now(), &tz).unwrap().card.tag.as_deref(), Some("ui backend"));
    assert_eq!(update_task(&conn, &t.id, &patch("   "), now(), &tz).unwrap().card.tag, None);
    assert!(matches!(update_task(&conn, &t.id, &patch("ui/ux"), now(), &tz), Err(AppError::Invalid(_))));
}
```

Di `mod tests` `projects.rs` (filter tag P-1 mencocokkan satu tag utuh):

```rust
#[test]
fn board_tag_filter_matches_one_whole_tag() {
    let conn = open_in_memory();
    let tz = jakarta();
    let mut ids = Vec::new();
    for (title, tag) in [("A", "kerja rumah"), ("B", "kerjaan"), ("C", "kerja")] {
        let card = create_task(&conn, &NewTask { title: title.into(), ..Default::default() }, now(), &tz).unwrap();
        let patch = tasks::TaskPatch { tag: Some(Some(tag.into())), ..Default::default() };
        update_task(&conn, &card.id, &patch, now(), &tz).unwrap();
        ids.push(card.id);
    }
    let filter = BoardFilter { tag: Some("kerja".into()), ..Default::default() };
    let board = project_board(&conn, None, &filter, now(), &tz).unwrap();
    let mut got: Vec<String> = board.columns.plan.iter().map(|c| c.id.clone()).collect();
    got.sort();
    let mut want = vec![ids[0].clone(), ids[2].clone()];
    want.sort();
    assert_eq!(got, want);
}
```

Di `mod tests` `sync/record.rs`:

```rust
#[test]
fn recur_and_archive_changes_enqueue_their_items() {
    let conn = open_in_memory();
    fixtures(&conn);
    clear_outbox(&conn);
    conn.execute("UPDATE tasks SET recur = 'daily' WHERE item_id = 'task'", []).unwrap();
    only_outbox(&conn, "task");
    clear_outbox(&conn);
    conn.execute("UPDATE projects SET archived_at = 99 WHERE item_id = 'project'", []).unwrap();
    only_outbox(&conn, "project");
}
```

Di `activities.rs` tests, tambahkan argumen `&jakarta()` ke setiap panggilan `set_status(...)` (baris sekitar 531, 546, 548, 549, 565, 600).

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `cd src-tauri && cargo test tasks::tests projects::tests sync::record::tests`
Expected: gagal kompilasi (`Recur`, `recur`, `next_due` belum ada; `set_status` belum menerima `tz`).

- [ ] **Step 4: Implementasi `tasks.rs`**

Import: tambah `use jiff::{Timestamp, ToSpan};`.

```rust
/// Repeat rule of a task (spec Proyek v2 R8).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Recur {
    Daily,
    Weekly,
    Monthly,
}

impl ToSql for Recur {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(match self {
            Recur::Daily => "daily",
            Recur::Weekly => "weekly",
            Recur::Monthly => "monthly",
        }
        .into())
    }
}

impl FromSql for Recur {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "daily" => Ok(Recur::Daily),
            "weekly" => Ok(Recur::Weekly),
            "monthly" => Ok(Recur::Monthly),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}
```

- `TaskCard`: tambah `pub recur: Option<Recur>,` setelah field prioritas P-1.
- `TaskPatch`: tambah

```rust
#[serde(default, deserialize_with = "present_opt")]
pub recur: Option<Option<Recur>>,
```

- `CARD_SELECT`: tambahkan `, t.recur` sebagai kolom terakhir (setelah `project_name` dan kolom prioritas P-1). Di `card_query` isi `recur: r.get(10)?` (indeks = indeks kolom prioritas P-1 + 1; sesuaikan).

- `update_task`: blok baru tepat setelah `let tx = conn.unchecked_transaction()?;`, sebelum blok `unassigning`, agar patch `{ recur, status: done }` sekaligus sudah memakai aturan baru:

```rust
if let Some(recur) = patch.recur {
    if recur.is_some() {
        if parent_id.is_some() {
            return Err(invalid("Sub-tugas tidak bisa berulang"));
        }
        let due: Option<i64> = tx.query_row("SELECT due_at FROM items WHERE id = ?1", [id], |r| r.get(0))?;
        if due.is_none() {
            return Err(invalid("Tugas berulang harus punya tenggat"));
        }
    }
    tx.execute("UPDATE tasks SET recur = ?2 WHERE item_id = ?1", params![id, recur])?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![id, now])?;
}
```

  Kedua panggilan `set_status_in_transaction(&tx, id, status, "Kamu", now)` menjadi `set_status_in_transaction(&tx, id, status, "Kamu", now, tz)`.

- Blok tag di `update_task` diganti (R10, satu pola tag dengan Jurnal):

```rust
if let Some(maybe_tag) = &patch.tag {
    let tag = match maybe_tag {
        Some(raw) => Some(crate::journal::normalize_tags(raw)?).filter(|t| !t.is_empty()),
        None => None,
    };
    tx.execute("UPDATE tasks SET tag = ?2 WHERE item_id = ?1", params![id, tag])?;
    tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![id, now])?;
}
```

- Fungsi baru:

```rust
/// Due date one repeat later, in local time; jiff clamps 31 Jan + 1 month to 28/29 Feb.
fn next_due(due_at: i64, recur: Recur, tz: &TimeZone) -> Result<i64, AppError> {
    let span = match recur {
        Recur::Daily => 1.day(),
        Recur::Weekly => 1.week(),
        Recur::Monthly => 1.month(),
    };
    let due = Timestamp::from_millisecond(due_at)?.to_zoned(tz.clone());
    Ok(due.checked_add(span)?.timestamp().as_millisecond())
}

struct Recurring {
    title: String,
    body: String,
    due_at: Option<i64>,
    project_id: Option<String>,
    start_at: Option<i64>,
    tag: Option<String>,
    priority: Option<i64>,
    recur: Recur,
}

/// Spec R8: a recurring parent task that becomes done gets a successor in the same
/// transaction. The rule moves to the successor, so finishing the old task again
/// never creates a second copy. Subtasks are not copied.
pub(crate) fn spawn_next_in_transaction(
    conn: &Connection,
    id: &str,
    now: i64,
    tz: &TimeZone,
) -> Result<Option<String>, AppError> {
    let row = conn
        .query_row(
            "SELECT i.title, i.body, i.due_at, t.project_id, t.start_at, t.tag, t.priority, t.recur
             FROM items i JOIN tasks t ON t.item_id = i.id
             WHERE i.id = ?1 AND i.deleted_at IS NULL AND i.parent_id IS NULL AND t.recur IS NOT NULL",
            [id],
            |r| {
                Ok(Recurring {
                    title: r.get(0)?,
                    body: r.get(1)?,
                    due_at: r.get(2)?,
                    project_id: r.get(3)?,
                    start_at: r.get(4)?,
                    tag: r.get(5)?,
                    priority: r.get(6)?,
                    recur: r.get(7)?,
                })
            },
        )
        .optional()?;
    let Some(task) = row else { return Ok(None) };
    let Some(due_at) = task.due_at else { return Ok(None) };

    let next_due = next_due(due_at, task.recur, tz)?;
    let next_start = task.start_at.map(|start| start + (next_due - due_at));
    let next = items::insert(conn, "task", &task.title, &task.body, now)?;
    conn.execute("UPDATE items SET due_at = ?2 WHERE id = ?1", params![next, next_due])?;
    conn.execute(
        "INSERT INTO tasks (item_id, status, project_id, start_at, tag, priority, recur)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![next, TaskStatus::Plan, task.project_id, next_start, task.tag, task.priority, task.recur],
    )?;
    conn.execute("UPDATE tasks SET recur = NULL WHERE item_id = ?1", [id])?;
    Ok(Some(next))
}
```

  Kalau `From<jiff::Error> for AppError` tidak ada untuk `Timestamp::from_millisecond`, pola `?` yang sama sudah dipakai di `time.rs::month_bounds`; ikuti itu.

- [ ] **Step 5: Implementasi `activities.rs`, `cli.rs`, `projects.rs`**

`activities.rs` (import `jiff::tz::TimeZone` kalau belum):

```rust
pub(crate) fn set_status_in_transaction(
    conn: &Connection,
    task_id: &str,
    status: TaskStatus,
    actor: &str,
    now: i64,
    tz: &TimeZone,
) -> Result<(), AppError> {
    let actor = validate_actor(actor)?;
    let (project_id, previous) = task_state(conn, task_id)?;
    if previous == status {
        return Ok(());
    }
    tasks::apply_status(conn, task_id, status, now)?;
    if status == TaskStatus::Done {
        tasks::spawn_next_in_transaction(conn, task_id, now, tz)?;
    }
    // ... sisa fungsi (activity status) tidak berubah
}

pub fn set_status(
    conn: &Connection,
    task_id: &str,
    status: TaskStatus,
    actor: &str,
    now: i64,
    tz: &TimeZone,
) -> Result<(), AppError> {
    let tx = conn.unchecked_transaction()?;
    set_status_in_transaction(&tx, task_id, status, actor, now, tz)?;
    tx.commit()?;
    Ok(())
}
```

`cli.rs:390`: `activities::set_status(conn, task, status, actor, now, &tz)?;` (`tz` sudah ada di fungsi itu, baris 335). Cari pemanggil lain dengan `grep -rn "set_status(" src-tauri/src | grep -v downloads` dan teruskan `tz` yang sama.

`projects.rs`: tidak perlu diubah. Plan P-1 sudah mencocokkan satu tag utuh (`(' ' || lower(COALESCE(t.tag, '')) || ' ') LIKE ?`) dan menolak filter dua tag. Test `board_tag_filter_matches_one_whole_tag` di Step 2 menjaga perilaku itu untuk tag ganda; kalau gagal, perbaiki klausa tag di `project_board` dengan pola tersebut.

- [ ] **Step 6: Jalankan test**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`
Expected: semua lulus, termasuk test sync record dan test migrasi di `db.rs`.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/migrations/015_project_structure.sql src-tauri/src/db.rs src-tauri/src/tasks.rs src-tauri/src/activities.rs src-tauri/src/cli.rs src-tauri/src/projects.rs src-tauri/src/sync/record.rs
git commit -m "feat(tasks): recurring tasks and space-separated tags"
```

---

### Task 2: Backend — arsip proyek

**Files:**
- Modify: `src-tauri/src/projects.rs` (`RawProject`, `PROJECT_SELECT`, `raw_from_row`, `ProjectSummary`, `build_summary`, `Overview`, `projects_overview`, fungsi baru, tests)
- Modify: `src-tauri/src/commands.rs` (setelah `delete_project`, baris ~98), `src-tauri/src/lib.rs` (setelah `commands::delete_project`, baris ~165)

**Interfaces:**
- Consumes: kolom `projects.archived_at` dari Task 1.
- Produces (Rust): `ProjectSummary.archived: bool` (ikut ke `ProjectDetail` lewat `flatten`); `Overview.archived: Vec<ProjectSummary>`; `pub fn archive_project(conn, id: &str, now: i64) -> Result<(), AppError>`; `pub fn unarchive_project(conn, id: &str, now: i64) -> Result<(), AppError>`.
- Produces (command): `archive_project { id }`, `unarchive_project { id }`.

- [ ] **Step 1: Tulis test yang gagal** (di `mod tests` `projects.rs`)

```rust
fn plain_project(conn: &Connection, name: &str) -> String {
    let input = ProjectInput { name: name.into(), ..Default::default() };
    save_project(conn, &input, now(), &jakarta()).unwrap().summary.id
}

#[test]
fn archived_projects_leave_the_list_dashboard_and_upcoming() {
    let conn = open_in_memory();
    let tz = jakarta();
    let kept = plain_project(&conn, "Aktif");
    let old = plain_project(&conn, "Lama");
    let task = create_task(&conn, &NewTask { title: "Tugas lama".into(), project_id: Some(old.clone()), ..Default::default() }, now(), &tz).unwrap();
    update(&conn, &task.id, &ItemPatch { due_at: Some(Some(now())), ..Default::default() }, now()).unwrap();

    archive_project(&conn, &old, now() + 1).unwrap();
    archive_project(&conn, &old, now() + 2).unwrap(); // idempotent

    let overview = projects_overview(&conn, now(), &tz).unwrap();
    assert_eq!(overview.projects.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), vec![kept.as_str()]);
    assert_eq!(overview.active_count, 1);
    assert_eq!(overview.archived.len(), 1);
    assert!(overview.archived[0].archived);
    assert!(overview.upcoming.iter().all(|c| c.id != task.id));
    assert!(active_projects(&conn, now(), &tz, 5).unwrap().iter().all(|p| p.id != old));
    assert!(get_project(&conn, &old, now(), &tz).unwrap().summary.archived);
    // Tasks stay real tasks: the board still shows them.
    let board = project_board(&conn, Some(&old), &BoardFilter::default(), now(), &tz).unwrap();
    assert_eq!(board.columns.plan.len(), 1);
    let archived_at: Option<i64> = conn.query_row("SELECT archived_at FROM projects WHERE item_id = ?1", [&old], |r| r.get(0)).unwrap();
    assert_eq!(archived_at, Some(now() + 1));

    unarchive_project(&conn, &old, now() + 3).unwrap();
    let overview = projects_overview(&conn, now(), &tz).unwrap();
    assert_eq!(overview.projects.len(), 2);
    assert!(overview.archived.is_empty());
}

#[test]
fn archive_rejects_missing_and_deleted_projects() {
    let conn = open_in_memory();
    assert!(matches!(archive_project(&conn, "missing", now()), Err(AppError::NotFound)));
    let gone = plain_project(&conn, "Hapus");
    delete_project(&conn, &gone, now()).unwrap();
    assert!(matches!(archive_project(&conn, &gone, now()), Err(AppError::NotFound)));
    assert!(matches!(unarchive_project(&conn, &gone, now()), Err(AppError::NotFound)));
}
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `cd src-tauri && cargo test projects::tests`
Expected: gagal kompilasi (`archive_project`, `archived` belum ada).

- [ ] **Step 3: Implementasi**

- `RawProject`: tambah `archived_at: Option<i64>`. `PROJECT_SELECT`: tambahkan `, p.archived_at` setelah `p.agent_dir`. `raw_from_row`: `archived_at: r.get(11)?`.
- `ProjectSummary`: tambah `pub archived: bool,`; di `build_summary` isi `archived: raw.archived_at.is_some(),`.
- `Overview`: tambah `pub archived: Vec<ProjectSummary>,`.
- `projects_overview`:

```rust
let mut all = Vec::new();
for raw in raws {
    all.push(build_summary(&raw, now, tz)?);
}
let (mut archived, mut projects): (Vec<_>, Vec<_>) = all.into_iter().partition(|p| p.archived);
sort_projects(&mut projects);
sort_projects(&mut archived);
let active_count = projects.iter().filter(|p| p.status != ProjectStatus::Done).count() as i64;
```

  Klausa `upcoming` menjadi:

```rust
"t.status != 'done' AND i.due_at IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM projects ap WHERE ap.item_id = t.project_id AND ap.archived_at IS NOT NULL)
 ORDER BY i.due_at, i.title, i.id LIMIT 5",
```

  Isi `archived` di struct `Overview`. `active_projects` tidak perlu diubah (memakai `overview.projects`).

- Fungsi baru:

```rust
fn live_project(conn: &Connection, id: &str) -> Result<(), AppError> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM items WHERE id = ?1 AND deleted_at IS NULL AND type = 'project')",
        [id],
        |r| r.get(0),
    )?;
    if exists { Ok(()) } else { Err(AppError::NotFound) }
}

/// Spec R9: hides the project; its tasks stay in Hari ini, 7 hari, and Jadwal.
pub fn archive_project(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    live_project(conn, id)?;
    let tx = conn.unchecked_transaction()?;
    if tx.execute("UPDATE projects SET archived_at = ?2 WHERE item_id = ?1 AND archived_at IS NULL", params![id, now])? > 0 {
        tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![id, now])?;
    }
    tx.commit()?;
    Ok(())
}

pub fn unarchive_project(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    live_project(conn, id)?;
    let tx = conn.unchecked_transaction()?;
    if tx.execute("UPDATE projects SET archived_at = NULL WHERE item_id = ?1 AND archived_at IS NOT NULL", [id])? > 0 {
        tx.execute("UPDATE items SET updated_at = ?2 WHERE id = ?1", params![id, now])?;
    }
    tx.commit()?;
    Ok(())
}
```

  (`rustfmt` akan memecah `if exists { ... }`; biarkan.)

- `commands.rs`:

```rust
#[tauri::command]
pub fn archive_project(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    projects::archive_project(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn unarchive_project(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    projects::unarchive_project(&*db.conn()?, &id, time::now_ms())
}
```

  Daftarkan `commands::archive_project, commands::unarchive_project,` di `lib.rs` setelah `commands::delete_project`. Tidak perlu masuk daftar `is_allowed_while_locked` di `security.rs` (command terkunci saat PIN aktif, sama seperti `delete_project`).

- [ ] **Step 4: Jalankan test**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`
Expected: semua lulus (termasuk `dashboard_lists_two_active_projects`).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/projects.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(projects): archive and restore projects"
```

---

### Task 3: Frontend — Daftar, berulang, arsip, banyak tag

**Files:**
- Modify: `src/api.ts` (tipe dan dua fungsi baru)
- Modify: `src/projects/view.ts`, `src/projects/view.test.ts`
- Create: `src/projects/TaskList.tsx`, `src/projects/TaskList.test.tsx`
- Modify: `src/projects/Kanban.tsx` (chip tag, ikon ↻)
- Modify: `src/projects/ProjectsPage.tsx` (toggle Kanban/Daftar, pilihan proyek arsip, banner)
- Modify: `src/projects/ProjectList.tsx` (lipatan "Arsip (n)")
- Modify: `src/projects/ProjectForm.tsx` (tombol "Arsipkan")
- Modify: `src/item/TaskFields.tsx` (select Ulangi, input tag, proyek arsip di select Proyek)
- Modify: fixture test yang membuat `TaskCard`/`ProjectDetail`/`ProjectSummary`/`ProjectsOverview` literal (temukan lewat `bun run typecheck`, mis. `src/projects/ProjectsPage.test.tsx`): tambah `recur: null`, `archived: false`, `archived: []`.

**Interfaces:**
- Consumes: command dan field dari Task 1–2; `TaskCard.priority` dari P-1.
- Produces (TS):

```ts
export type Recur = "daily" | "weekly" | "monthly";
// TaskCard dan TaskDetail: recur: Recur | null;
// TaskPatch: recur?: Recur | null;
// ProjectSummary dan ProjectDetail: archived: boolean;
// ProjectsOverview: archived: ProjectSummary[];
archiveProject: (id: string) => invoke<void>("archive_project", { id }),
unarchiveProject: (id: string) => invoke<void>("unarchive_project", { id }),
```

- Produces (`view.ts`): `RECUR_LABELS`, `RECUR_OPTIONS`, `tagList`, `cardTags`, `SortKey`, `Sort`, `nextSort`, `sortCards`, `BoardView`, `readBoardView`, `writeBoardView`. `PRIORITY_LABELS` dan tipe `Priority` sudah ada dari P-1.

- [ ] **Step 1: Tulis test yang gagal**

`src/projects/view.test.ts`, tambahkan (import nama baru di blok import atas):

```ts
const card = (over: Partial<TaskCard>): TaskCard => ({
  id: "x", title: "x", status: "plan", tag: null, dueAt: null, overdue: false, subDone: 0, subTotal: 0,
  projectId: null, projectName: null, priority: null, recur: null, ...over,
});

describe("Proyek v2 P-2 helpers", () => {
  test("tags split on spaces and cards show two", () => {
    expect(tagList(null)).toEqual([]);
    expect(tagList("ui  backend")).toEqual(["ui", "backend"]);
    expect(cardTags("a b c d")).toEqual({ shown: ["a", "b"], more: 2 });
    expect(cardTags("a")).toEqual({ shown: ["a"], more: 0 });
  });

  test("recur labels", () => {
    expect(RECUR_LABELS.weekly).toBe("Berulang mingguan");
    expect(RECUR_OPTIONS.map((o) => o.label)).toEqual(["Tidak", "Harian", "Mingguan", "Bulanan"]);
  });

  test("sort cycles asc, desc, off", () => {
    expect(nextSort(null, "due")).toEqual({ key: "due", dir: "asc" });
    expect(nextSort({ key: "due", dir: "asc" }, "due")).toEqual({ key: "due", dir: "desc" });
    expect(nextSort({ key: "due", dir: "desc" }, "due")).toBeNull();
    expect(nextSort({ key: "due", dir: "asc" }, "title")).toEqual({ key: "title", dir: "asc" });
  });

  test("sorting keeps empty values last in both directions", () => {
    const cards = [
      card({ id: "a", title: "Beta", priority: 3, dueAt: 30 }),
      card({ id: "b", title: "alfa", priority: null, dueAt: null }),
      card({ id: "c", title: "Gamma", priority: 1, dueAt: 10 }),
    ];
    const ids = (s: Sort) => sortCards(cards, s).map((c) => c.id);
    expect(ids(null)).toEqual(["a", "b", "c"]);
    expect(ids({ key: "title", dir: "asc" })).toEqual(["b", "a", "c"]);
    expect(ids({ key: "priority", dir: "asc" })).toEqual(["c", "a", "b"]);
    expect(ids({ key: "priority", dir: "desc" })).toEqual(["a", "c", "b"]);
    expect(ids({ key: "due", dir: "desc" })).toEqual(["a", "c", "b"]);
  });

  test("board view falls back to kanban without storage", () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("blocked"); } });
    expect(readBoardView()).toBe("kanban");
    expect(() => writeBoardView("list")).not.toThrow();
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v),
    } });
    writeBoardView("list");
    expect(readBoardView()).toBe("list");
    store.set("anchoa.projects.view", "aneh");
    expect(readBoardView()).toBe("kanban");
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
});
```

`src/projects/TaskList.test.tsx`:

```tsx
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Columns, TaskCard } from "../api";
import { TaskList } from "./TaskList";

const base: TaskCard = { id: "t1", title: "Desain logo", status: "plan", tag: "ui brand desain", dueAt: null,
  overdue: false, subDone: 1, subTotal: 3, projectId: null, projectName: null, priority: 1, recur: "weekly" };
const columns: Columns = { plan: [base], doing: [], test: [], review: [], done: [{ ...base, id: "t2", title: "Selesai", status: "done" }] };

describe("TaskList", () => {
  it("groups by status with sortable headers", () => {
    const html = renderToStaticMarkup(<TaskList columns={columns} agent={false} onOpenItem={() => {}} />);
    expect(html).toContain("Rencana");
    expect(html).toContain("Dikerjakan");
    expect(html).toContain("Selesai");
    expect(html).toContain("Desain logo");
    expect(html).toContain("Tinggi");
    expect(html).toContain("1/3");
    expect(html).toContain("Berulang mingguan");
    expect(html).toContain("+1");
    expect(html).toContain("Urutkan menurut judul");
    expect(html).not.toContain("Tes"); // test/review groups only for agent projects
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `TZ=Asia/Jakarta bun test src/projects/view.test.ts src/projects/TaskList.test.tsx`
Expected: FAIL (helper dan komponen belum ada).

- [ ] **Step 3: Implementasi `api.ts` dan `view.ts`**

`api.ts`: tambahkan tipe di §Interfaces ke interface yang ada (`TaskCard`, `TaskDetail`, `TaskPatch`, `ProjectSummary`, `ProjectDetail`, `ProjectsOverview`) dan dua fungsi di objek `api` setelah `deleteProject`.

`view.ts`:

```ts
import type { Recur } from "../api";

export const RECUR_LABELS: Readonly<Record<Recur, string>> = {
  daily: "Berulang harian",
  weekly: "Berulang mingguan",
  monthly: "Berulang bulanan",
};

export const RECUR_OPTIONS: readonly { value: Recur | ""; label: string }[] = [
  { value: "", label: "Tidak" },
  { value: "daily", label: "Harian" },
  { value: "weekly", label: "Mingguan" },
  { value: "monthly", label: "Bulanan" },
];

// PRIORITY_LABELS (Record<Priority, { label, className }>) sudah ada dari P-1; jangan definisikan ulang.

export function tagList(tag: string | null): string[] {
  return tag ? tag.split(" ").filter(Boolean) : [];
}

export function cardTags(tag: string | null): { shown: string[]; more: number } {
  const all = tagList(tag);
  return { shown: all.slice(0, 2), more: Math.max(0, all.length - 2) };
}

export type SortKey = "title" | "priority" | "due";
export type Sort = Readonly<{ key: SortKey; dir: "asc" | "desc" }> | null;

/** Header clicks cycle ascending, descending, then back to the board order. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current?.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}

/** Presentation-only sort of already filtered board cards (spec R7); empty values stay last. */
export function sortCards(cards: readonly TaskCard[], sort: Sort): TaskCard[] {
  if (!sort) return [...cards];
  const sign = sort.dir === "asc" ? 1 : -1;
  const value = (c: TaskCard): string | number | null =>
    sort.key === "title" ? c.title : sort.key === "priority" ? c.priority : c.dueAt;
  return [...cards].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const order = typeof x === "string" ? x.localeCompare(String(y), "id-ID", { sensitivity: "base" }) : x - Number(y);
    return sign * order;
  });
}

export type BoardView = "kanban" | "list";
const VIEW_KEY = "anchoa.projects.view";

/** Per-device convenience only; storage may be blocked. */
export function readBoardView(): BoardView {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "kanban";
  } catch {
    return "kanban";
  }
}

export function writeBoardView(view: BoardView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Keep the in-memory choice only.
  }
}
```

  (Sonar bisa menandai ternary bersarang di `value`/`sortCards`; kalau begitu, pecah jadi `switch` atau `if` biasa.)

- [ ] **Step 4: Implementasi `TaskList.tsx`**

```tsx
import { useState } from "react";
import type { Columns, TaskCard } from "../api";
import { shortDate } from "../format";
import { PRIORITY_LABELS, RECUR_LABELS, boardColumns, cardTags, nextSort, sortCards, subLabel, type Sort, type SortKey } from "./view";

function ariaSort(sort: Sort, key: SortKey): "ascending" | "descending" | "none" {
  if (sort?.key !== key) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}

function SortHeader({
  sortKey,
  label,
  sort,
  onSort,
}: Readonly<{ sortKey: SortKey; label: string; sort: Sort; onSort: (update: (s: Sort) => Sort) => void }>) {
  return (
    <th aria-sort={ariaSort(sort, sortKey)} className="py-1 pr-2 font-medium">
      <button type="button" onClick={() => onSort((s) => nextSort(s, sortKey))}
        aria-label={`Urutkan menurut ${label}`} className="hover:text-ink">
        {label}
      </button>
    </th>
  );
}

function Row({ card, onOpenItem }: Readonly<{ card: TaskCard; onOpenItem: (id: string) => void }>) {
  const { shown, more } = cardTags(card.tag);
  return (
    <tr className="border-t border-line">
      <td className="py-1.5 pr-2">
        <button type="button" onClick={() => onOpenItem(card.id)}
          className={`text-left text-[13px] hover:text-accent ${card.status === "done" ? "text-done line-through" : "text-ink"}`}>
          {card.title || "Tanpa judul"}
        </button>
        {card.recur && <span className="ml-1.5 text-muted" title={RECUR_LABELS[card.recur]} aria-label={RECUR_LABELS[card.recur]}>↻</span>}
      </td>
      <td className="py-1.5 pr-2 text-xs text-muted">{card.priority ? PRIORITY_LABELS[card.priority].label : ""}</td>
      <td className="py-1.5 pr-2 text-xs text-muted">
        {shown.join(" ")}{more > 0 && ` +${more}`}
      </td>
      <td className={`py-1.5 pr-2 font-mono text-[11px] ${card.overdue ? "text-danger" : "text-muted"}`}>
        {card.dueAt === null ? "" : shortDate(card.dueAt)}
      </td>
      <td className="py-1.5 font-mono text-[11px] text-muted">{subLabel(card) ?? ""}</td>
    </tr>
  );
}

/** Spec R7: the same filtered board as a table, grouped by status. */
export function TaskList({
  columns,
  agent,
  onOpenItem,
}: Readonly<{ columns: Columns; agent: boolean; onOpenItem: (id: string) => void }>) {
  const [sort, setSort] = useState<Sort>(null);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-[14px] border border-line bg-stage p-3">
      {boardColumns(agent).map((col) => (
        <section key={col.status} aria-label={col.title}>
          <div className="flex items-center gap-2 px-1 py-0.5">
            <span className={`h-2 w-2 rounded-full ${col.dot}`} />
            <h3 className="m-0 text-[13px] font-semibold text-ink">{col.title}</h3>
            <span className="font-mono text-xs text-muted">{columns[col.status].length}</span>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                <SortHeader sortKey="title" label="judul" sort={sort} onSort={setSort} />
                <SortHeader sortKey="priority" label="prioritas" sort={sort} onSort={setSort} />
                <th className="py-1 pr-2 font-medium">tag</th>
                <SortHeader sortKey="due" label="tenggat" sort={sort} onSort={setSort} />
                <th className="py-1 font-medium">sub-tugas</th>
              </tr>
            </thead>
            <tbody>
              {sortCards(columns[col.status], sort).map((card) => <Row key={card.id} card={card} onOpenItem={onOpenItem} />)}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
```

  Urutan header sama dengan sel di `Row`: judul, prioritas, tag, tenggat, sub-tugas. Header tag dan sub-tugas tidak bisa diklik.

- [ ] **Step 5: Implementasi halaman dan komponen lain**

- `Kanban.tsx` (import `cardTags`, `RECUR_LABELS` dari `./view`): ganti chip `c.tag` tunggal dengan

```tsx
{cardTags(c.tag).shown.map((t) => (
  <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">{t}</span>
))}
{cardTags(c.tag).more > 0 && <span className="text-[11px] text-muted">+{cardTags(c.tag).more}</span>}
{c.recur && <span className="text-[12px] text-muted" title={RECUR_LABELS[c.recur]} aria-label={RECUR_LABELS[c.recur]}>↻</span>}
```

  (simpan `cardTags(c.tag)` dalam satu variabel `const tags = cardTags(c.tag);` di awal render kartu).

- `ProjectsPage.tsx`:
  - state `const [view, setView] = useState<BoardView>(readBoardView);`
  - di baris bar filter P-1 (atau satu baris toolbar di atas board kalau bar P-1 ada di komponen lain), di ujung kanan, hanya saat `activeTab === "kanban"`:

```tsx
<Segmented
  label="Tampilan tugas"
  options={[{ value: "kanban", label: "Kanban" }, { value: "list", label: "Daftar" }] as const}
  value={view}
  onChange={(v: BoardView) => { setView(v); writeBoardView(v); }}
/>
```

    (`Segmented` dari `../finance/fields`).
  - saat `view === "list"`, render `<TaskList columns={board.columns} agent={agentProject !== null} onOpenItem={handleOpenCard} />` di tempat `<Kanban ... />`; `AgentThread` tetap di sampingnya.
  - efek `projectsOverview`: id terpilih dianggap valid kalau ada di `data.projects` atau `data.archived`:

```ts
const known = (id: string) => data.projects.some((p) => p.id === id) || data.archived.some((p) => p.id === id);
// ganti `!data.projects.some((p) => p.id === prev)` dengan `!known(prev)`
```

  - banner di atas board saat `board?.project?.archived`:

```tsx
{board?.project?.archived && (
  <div className="flex items-center gap-3 rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px]">
    <span className="text-muted">Proyek diarsipkan</span>
    <button type="button" className={`${SECONDARY} ml-auto`} onClick={() => void handleUnarchive(board.project!.id)}>
      Pulihkan
    </button>
  </div>
)}
```

    dengan

```ts
async function handleUnarchive(id: string) {
  try {
    await api.unarchiveProject(id);
    setVersion((v) => v + 1);
    onChanged();
  } catch (e) {
    toast(errorMessage(e), "error");
  }
}
```

  - teruskan `archived={overview.archived}` ke `ProjectList`.

- `ProjectList.tsx`: pindahkan isi `projects.map(...)` ke komponen dalam `ProjectButton({ project, selected, onSelect })` (props `Readonly`) tanpa mengubah markup, lalu setelah tombol "Tugas lepas":

```tsx
{archived.length > 0 && (
  <details className="rounded-xl border border-line bg-surface px-3 py-2">
    <summary className="cursor-pointer text-xs text-muted">Arsip ({archived.length})</summary>
    <div className="mt-2 flex flex-col gap-2">
      {archived.map((p) => (
        <ProjectButton key={p.id} project={p} selected={selectedId === p.id} onSelect={onSelect} />
      ))}
    </div>
  </details>
)}
```

  Props baru `archived: ProjectSummary[]`. `<details>`/`<summary>` sudah bisa diakses keyboard tanpa handler tambahan.

- `ProjectForm.tsx`: saat `edit && !edit.archived`, di atas `<DialogActions>`:

```tsx
<button
  type="button"
  disabled={busy}
  onClick={() => void run(async () => { await api.archiveProject(edit.id); onSaved(edit.id); })}
  className={SECONDARY}
>
  Arsipkan
</button>
<p className="m-0 text-xs text-muted">Proyek arsip tidak tampil di daftar; tugasnya tetap ada di Hari ini dan Jadwal.</p>
```

  (import `SECONDARY` dari `../shell/ui`).

- `TaskFields.tsx` (import `type Recur` dari `../api` dan `RECUR_OPTIONS` dari `../projects/view`):
  - opsi select Proyek: `setProjects([...res.projects, ...res.archived])`.
  - input tag: `placeholder="tag dipisah spasi"`. Nilai tersimpan kembali ter-normalisasi lewat efek `task.tag` yang sudah ada.
  - select Ulangi setelah Tag:

```tsx
<div className="flex items-center gap-2">
  <label htmlFor="task-recur" className="text-muted">Ulangi</label>
  <select
    id="task-recur"
    value={task.recur ?? ""}
    disabled={isSubtask || dueAt === null}
    title={dueAt === null ? "Isi tenggat dulu" : undefined}
    onChange={(e) => void saveTaskPatch({ recur: e.target.value === "" ? null : (e.target.value as Recur) })}
    className={`${FIELD} py-1 px-2.5 text-xs disabled:opacity-50`}
  >
    {RECUR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
</div>
```

  - `handleDueAtChange(null)` pada tugas berulang ikut mengosongkan aturan: setelah `api.updateItem` sukses, `if (ms === null && task.recur) await saveTaskPatch({ recur: null });`.

- [ ] **Step 6: Jalankan test**

Run: `bun run typecheck && TZ=Asia/Jakarta bun test`
Expected: semua lulus.

- [ ] **Step 7: Commit**

```bash
git add src/api.ts src/projects/ src/item/TaskFields.tsx
git commit -m "feat(projects): list view, recurring tasks, archive, and multiple tags"
```

---

### Task 4: E2E dan PR (sesi Opus)

**Files:**
- Modify: `scripts/e2e-smoke.sh` (fungsi baru `check_projects_structure`, dipanggil setelah `check_projects` di daftar bawah)

- [ ] **Step 1: Tambah `check_projects_structure`** mengikuti gaya `check_projects` (`fresh`, `start_app`, `click`, `sql_becomes`, `sql_value`, `shot`, `[[ ... ]]`). Ukur koordinat dari screenshot pertama build ini.
  1. Buat proyek "Struktur e2e" dan tugas "Tugas berulang" di Rencana (seperti `check_projects`).
  2. Buka tugas, isi Tenggat, pilih Ulangi = Mingguan, isi tag `ui backend`. `sql_becomes "SELECT recur || ':' || tag FROM tasks t JOIN items i ON i.id=t.item_id WHERE i.title='Tugas berulang' AND i.deleted_at IS NULL AND recur IS NOT NULL" "weekly:ui backend"`.
  3. Status Selesai. `sql_becomes "SELECT count(*) FROM items WHERE title='Tugas berulang' AND deleted_at IS NULL" 2` dan `sql_becomes "SELECT count(*) FROM tasks t JOIN items i ON i.id=t.item_id WHERE i.title='Tugas berulang' AND t.status='plan' AND t.recur='weekly'" 1`.
  4. Kembali ke Proyek, pilih "Daftar". `shot 13-projects-list` (grup Rencana dan Selesai, ikon ↻, tag `ui backend`). Klik header "tenggat" sekali, `shot 13-projects-list-sorted`.
  5. Ubah proyek → "Arsipkan". `sql_becomes "SELECT archived_at IS NOT NULL FROM projects p JOIN items i ON i.id=p.item_id WHERE i.title='Struktur e2e'" 1`. `shot 13-projects-archived` (banner "Proyek diarsipkan", lipatan "Arsip (1)").
  6. Klik "Pulihkan". `sql_becomes ... 0`.
  7. Restart app (`stop_app`, `start_app`), buka Proyek: tampilan Daftar masih terpilih (`shot 13-projects-view-kept`).
- [ ] **Step 2:** `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`. Cek screenshot di `~/.cache/anchoa-e2e/`.
- [ ] **Step 3:** Jalankan suite penuh: `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`, lalu `bun run typecheck && bun run test`. Commit `scripts/e2e-smoke.sh` (`test(e2e): project list view, recurrence and archive`), push branch `feat/146-proyek-struktur`, buka PR dengan bukti test, screenshot (tanpa data pribadi), dan `Closes #146`. Review Sol + agy paralel (perintah di CLAUDE.md, spec `docs/superpowers/specs/2026-10-03-anchoa-proyek-v2-design.md`), verifikasi tiap temuan, perbaiki yang nyata, merge saat semua hijau (`gh pr merge --squash --delete-branch`). Tanpa rilis.
- [ ] **Step 4:** Tulis handoff ke `.remember/now.md`: P-2 selesai, P-3 berikutnya di sesi baru (sesi itu memakai `docs/superpowers/plans/2026-10-03-anchoa-proyek-v2-p3.md` kalau ada, atau menulisnya dari spec R11–R13 sebelum kode).
