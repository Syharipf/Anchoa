# Anchoa Proyek × Agen AI: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Implementasi utama oleh Codex gpt-6.1-sol xhigh (`codex exec -s workspace-write`), dibantu Gemini 3.8 Flash High lewat `agy-multi`. Review oleh Gemini dan Sol, lalu dicek sesi Opus.

**Goal:** Proyek menjadi papan kerja agen AI: kanban 5 kolom, utas aktivitas per tugas, permintaan ke agen, dan CLI `anchoa agent` untuk agen melapor.

**Architecture:**
- Aktivitas adalah item `type = 'activity'` dengan tabel ekstensi `activities`. Fungsi murninya ada di `activities.rs`.
- CLI ada di binary yang sama: `main.rs` memeriksa `argv[1] == "agent"` lalu memanggil `cli::run`.
- Runner perintah agen ada di `agent_runner.rs` (`Mutex<HashMap<project_id, Child>>`, seperti `downloader.rs`).
- UI ada di `src/projects/`.

**Spec:** `docs/superpowers/specs/2026-10-01-anchoa-agen-proyek-design.md`. Baca seluruhnya (A1–A10).

## Global Constraints

- Semua Global Constraints rencana sebelumnya berlaku, termasuk aturan SonarCloud dan larangan dependency baru (parser argumen ditulis tangan).
- `Db::conn()` adalah guard `std::sync::Mutex`. Jangan memegangnya sambil memanggil fungsi yang mengunci DB lagi.
- Tidak boleh panic di path user dan CLI. Semua error menjadi `AppError` atau JSON `{"error": …}` dengan exit 2.
- Proyek biasa (bukan agen) tidak berubah tampilan maupun perilakunya.
- Nama rilis: "Anchoa v0.10.0 — Proyek dan agen".

## Pembagian PR

| PR | Task |
|---|---|
| A-1 | 1–2 |
| A-2 | 3 |
| A-3 | 4–5 |

---

### Task 1: Migrasi 010, `activities.rs`, dan status baru

**Antarmuka:**

```rust
pub enum Role { Request, Plan, Implement, Test, Review, Merge, Note }   // lowercase serde/SQL
pub enum Kind { Message, Status, Result, Link }
pub struct Activity { id, task_id: Option<String>, project_id, actor, role: Role, kind: Kind, title, body, created_at }
pub struct NewActivity { task_id: Option<String>, project_id: String, actor: String, role: Role, kind: Kind, title: String, body: String }
pub fn add(conn, a: &NewActivity, now) -> Result<Activity, AppError>   // actor 1..=40 karakter, body <= 200 KB
pub fn for_task(conn, task_id) -> Result<Vec<Activity>, AppError>      // kronologis
pub fn for_project(conn, project_id, limit) -> Result<Vec<Activity>, AppError>  // terbaru dulu
pub fn last_for_tasks(conn, project_id) -> Result<HashMap<String, (String, Role)>, AppError>  // aktor+peran terakhir per tugas
pub fn set_status(conn, task_id, status: TaskStatus, actor, now) -> Result<(), AppError>  // update tasks + aktivitas status (A5)
pub fn inbox(conn, project_id: Option<&str>) -> Result<Vec<TaskCard>, AppError>
pub fn save_plan(conn, task_id, actor, markdown, now) -> Result<Activity, AppError>  // A6: aktivitas plan + halaman Catatan
```

- `TaskStatus` mendapat `Test` dan `Review`.
- `projects`:
  - kolom `agent`, `agent_command`, dan `agent_dir` ada di `ProjectInput` dan `ProjectDetail`;
  - `agent_dir` divalidasi: folder yang ada, di bawah home (canonicalize);
  - `project_board` mengembalikan kolom `test` dan `review` (kosong untuk proyek biasa).
- `update_task` lewat UI yang mengubah status juga menulis aktivitas status dengan `actor = "Kamu"`.
- Untuk A6, halaman induk "Rencana <nama proyek>" dibuat sekali (dicari lewat judul dan `type = 'page'`), lalu rencana menjadi subhalaman berjudul judul tugas.

**Test:**
- `version_9_database_upgrades_to_agent_schema`;
- `add_validates_actor_and_body`;
- `set_status_writes_a_status_activity`;
- `inbox_lists_requests_without_follow_up`;
- `save_plan_writes_activity_and_notes_page`;
- `board_has_test_and_review_columns`;
- `agent_dir_must_be_under_home`.

**Commit:** `feat: add agent activities and task statuses`.

### Task 2: CLI `anchoa agent`

**Antarmuka:**

```rust
// src-tauri/src/cli.rs
pub fn run(args: &[String], data_dir: &Path, now: i64) -> (i32, String)   // (exit code, stdout JSON lines)
```

- `main.rs`: kalau `args[1] == "agent"`, cetak hasil `cli::run`, keluar dengan kodenya, dan jangan jalankan Tauri.
  - `data_dir` = `$XDG_DATA_HOME/io.github.syharipf.anchoa`, atau `~/.local/share/...` kalau variabel itu tidak ada.
  - DB dibuka lewat `db::open` hanya kalau file sudah ada (A2), dengan `busy_timeout(5s)`.
- Subperintah dan validasi persis spec §4. Setiap baris output adalah JSON (serde).

**Test (`cli.rs`):**
- parser untuk semua subperintah;
- argumen salah menghasilkan exit 2 dengan `{"error"…}`;
- DB tidak ada menghasilkan exit 2 tanpa membuat file;
- `task status` menulis aktivitas;
- `plan --file` dari tempfile.

**Commit:** `feat: add the anchoa agent CLI`.
**Penutup PR A-1:** `cargo test`, clippy, `bun run typecheck`, `bun run test`, dan E2E penuh `PASS`.

---

### Task 3: Runner perintah agen

**Antarmuka:**

```rust
// src-tauri/src/agent_runner.rs
pub struct AgentRunner { inner: Mutex<HashMap<String, Child>> }
pub fn start(&self, app, project_id, task_id, request) -> Result<(), AppError>
// A7: sh -c <agent_command> di agent_dir, dengan env ANCHOA_*. stdout/stderr ke <data>/agent-runs/<task>.log.
// Thread menunggu child; exit non-0 menulis aktivitas "Agen gagal (kode n)" (actor "Anchoa", role note).
// Satu proses per proyek: kalau masih jalan, Invalid("Agen masih berjalan").
pub fn stop(&self, project_id) -> Result<(), AppError>
pub fn running(&self) -> Vec<String>          // project id yang sedang jalan
```

- **Command:**
  - `agent_request(projectId, text)`: membuat tugas, aktivitas request, lalu menjalankan `start` kalau ada perintah;
  - `agent_stop(projectId)`;
  - `agent_running()`;
  - `task_activities(taskId)`;
  - `add_activity(...)`: balasan user;
  - `agent_log(taskId)`: isi log, 64 KB terakhir.
- Saat app keluar, semua proses agen dihentikan (`RunEvent::Exit`, seperti `Downloader::stop_all`).
- `ANCHOA_CLI` = `std::env::current_exe()`.

**Test:**
- `start_runs_the_command_with_env_and_logs_output` (`sh -c 'echo $ANCHOA_TASK'`);
- `failure_writes_an_activity`;
- `only_one_run_per_project`;
- `stop_kills_the_child`.

**Commit:** `feat: run the project agent command`.
**Penutup PR A-2.**

---

### Task 4: UI proyek agen

**Files:** `src/projects/` (ProjectForm, Kanban, ProjectsPage), `src/projects/AgentThread.tsx`, `src/projects/AgentRequest.tsx`, `view.ts` + test, dan `src/api.ts`.

**Perilaku:** spec §5.
- Kanban 5 kolom hanya untuk `agent = true`.
- Utas memakai `BlockPreview` dari `src/notes/markdown.tsx` per paragraf.
- Polling `projectBoard` dan `taskActivities` tiap 3000 ms hanya selama proyek agen terbuka (A9). Respons lama dibuang memakai nomor permintaan.

**Test:** `view.test.ts` untuk kolom, label peran (Permintaan, Rencana, Implementasi, Tes, Review, Merge, Catatan), dan inisial aktor.
**Commit:** `feat: show agent work on the project board`.

### Task 5: E2E, `CLAUDE.md`, versi 0.10.0 (sesi Opus)

- `check_agent` sesuai spec §7.
- `CLAUDE.md`: bagian "Melapor ke Anchoa" (spec §6) dan status.
- Versi 0.10.0.

**Commit:** `test: cover agent projects end to end; bump version to 0.10.0`.
**Penutup PR A-3**, lalu rilis.
