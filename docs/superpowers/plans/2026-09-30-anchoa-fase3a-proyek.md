# Anchoa Fase 3A (Proyek dan tugas): Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementasi oleh task role `Coder` (satu task per run). Review oleh task role `reviewer`.

**Goal:** Model tugas dengan status, proyek, dan sub-tugas; halaman Proyek dengan kanban; catatan bertenggat lama menjadi tugas.

**Architecture:**
- Proyek dan tugas adalah baris `items` (`type` `project` dan `task`) dengan tabel ekstensi `projects` dan `tasks` dari migrasi `005_projects.sql`.
- Logika backend ada di dua modul baru:
  - `tasks.rs`: tugas, status, sub-tugas;
  - `projects.rs`: proyek, overview, kanban.
  Keduanya berisi fungsi murni yang menerima `&Connection`, `now`, dan `&TimeZone`. `commands.rs` hanya glue.
- Frontend untuk halaman ini ada di `src/projects/`. Aturan tampilan yang bisa diuji ada di `src/projects/view.ts`.

**Tech Stack:** sama dengan Fase 2. Tidak ada dependency baru.

**Spec:** `docs/superpowers/specs/2026-09-30-anchoa-fase3a-proyek-design.md`. Bacalah seluruhnya sebelum task pertama. Aturan dan bentuk data di spec adalah sumber kebenaran.

**Bentuk rencana ini:** untuk menghemat token Claude, rencana ini tidak memuat kode implementasi lengkap. Isinya antarmuka yang pasti, aturan, dan test yang harus ada. Tiap task ditulis TDD: tulis test dari daftar, pastikan gagal, implementasi, pastikan lulus, commit. Ikuti pola kode Fase 2 yang sudah ada (`finance.rs`, `bills.rs`, `src/finance/*`) untuk gaya, struktur, dan helper yang bisa dipakai ulang.

## Global Constraints

- Semua aturan di Global Constraints `docs/superpowers/plans/2026-09-30-anchoa-fase2-keuangan.md` berlaku, termasuk:
  - clean code;
  - enum untuk nilai yang punya cabang logika;
  - konvensi SonarCloud;
  - batas hari di Rust;
  - E2E di Xvfb `:99`.
- Pakai ulang, jangan tulis ulang:
  - `items::insert`, `items::soft_delete`, `finance::invalid`, `time::day_bounds`, `time::local_date`;
  - `Dialog`, `Field`, `DialogActions`, `Segmented`, `useSave`;
  - pola `ItemPatch` (field yang dikirim sebagai `null` mengosongkan nilainya).
- Test Rust memakai waktu tetap Selasa 29 Sep 2026 12:00 WIB dan `TimeZone::fixed(+7)`, lewat `finance::testing::{ms, jakarta, now}`.
- Nama rilis tanpa kata "Fase": "Anchoa v0.3.0 — Proyek dan tugas".

## Menjalankan task

Gunakan task role `Coder` untuk implementasi setiap task (test-first, satu commit per task), dan reviewer role untuk review sebelum merge.


## Pembagian PR

| PR | Branch | Task |
|---|---|---|
| 3A-1 | `feat/<N1>-f3a-1-tasks-backend` | 1–4 |
| 3A-2 | `feat/<N2>-f3a-2-projects-page` | 5–8 |
| 3A-3 | `feat/<N3>-f3a-3-task-page` | 9–10 |

---

# PR 3A-1: Backend proyek dan tugas

### Task 1: Migrasi 005

**Files:** Create `src-tauri/migrations/005_projects.sql` (isi persis dari spec §3). Modify `src-tauri/src/db.rs` (`MIGRATIONS` + test), `scripts/e2e-smoke.sh`.

- **Test `db::tests::version_4_database_upgrades_to_projects_schema`**, dengan pola sama seperti `version_3_database_upgrades_to_finance_schema`:
  - buat DB dengan 4 migrasi pertama berisi tiga catatan: tanpa tenggat, bertenggat terbuka, dan bertenggat yang `completed_at` terisi;
  - buka dengan `open`;
  - harapan:
    - `user_version` 5 dan `anchoa.db.bak-v4` ada;
    - catatan tanpa tenggat tetap `note`;
    - dua lainnya menjadi `task` dengan baris `tasks` berstatus `plan` dan `done`;
    - tabel `projects` bisa di-query.
- **E2E:**
  - `check_shell` mengharapkan `user_version` 5;
  - `check_dashboard` dan `check_notifications` sekarang mengubah catatan menjadi tugas lewat SQL, karena setelah Task 4 "Hari ini" hanya membaca tugas. Tambahkan helper bash `make_task <title>` yang menjalankan:
    ```sql
    UPDATE items SET type = 'task' WHERE title = '<title>';
    INSERT INTO tasks (item_id, status) SELECT id, 'plan' FROM items WHERE title = '<title>';
    ```
    Panggil helper ini sebelum `UPDATE ... due_at`, untuk setiap catatan yang dijadikan tugas.
- **Commit:** `feat: add projects and tasks schema, turn dated notes into tasks`.

### Task 2: `tasks.rs`

**Files:** Create `src-tauri/src/tasks.rs`. Modify `src-tauri/src/lib.rs` (`mod tasks;`), `src-tauri/src/finance.rs` (hanya kalau perlu membuat helper test `testing` lebih umum; jangan pindahkan).

**Antarmuka** (semua `pub`, JSON camelCase):

```rust
#[serde(rename_all = "lowercase")]
pub enum TaskStatus { Plan, Doing, Done }          // Serialize + Deserialize + ToSql + FromSql (lihat bills::Repeat)

pub struct TaskCard { id, title, status: TaskStatus, tag: Option<String>, due_at: Option<i64>, overdue: bool,
                      sub_done: i64, sub_total: i64, project_id: Option<String>, project_name: Option<String> }
pub struct TaskDetail { #[serde(flatten)] card: TaskCard, start_at: Option<i64>, parent_id: Option<String>,
                        parent_title: Option<String>, subtasks: Vec<TaskCard> }
pub struct NewTask { title: String, project_id: Option<String>, parent_id: Option<String>, status: TaskStatus }
pub struct TaskPatch { status: Option<TaskStatus>, project_id: Option<Option<String>>,
                       start_at: Option<Option<i64>>, tag: Option<Option<String>> }   // pola `present` dari items.rs

pub fn create_task(conn, &NewTask, now, tz) -> Result<TaskCard, AppError>
pub fn get_task(conn, id, now, tz) -> Result<TaskDetail, AppError>
pub fn update_task(conn, id, &TaskPatch, now, tz) -> Result<TaskDetail, AppError>
pub fn delete_task(conn, id, now) -> Result<(), AppError>
pub fn convert_to_task(conn, id, now, tz) -> Result<TaskDetail, AppError>
pub fn card_query(conn, clause: &str, params, now, tz) -> Result<Vec<TaskCard>, AppError>   // dipakai projects.rs
```

**Aturan:** spec §3–4 (P2, P5, P9, P13). Status dan `completed_at` diubah hanya lewat satu fungsi privat `apply_status`. `overdue` = `due_at` < awal hari ini dan status bukan `done`.

**Test** (`tasks::tests`):
- `create_task_trims_and_validates`: judul kosong ditolak `Invalid`; `project_id` yang tidak ada atau sudah dihapus ditolak `Invalid`.
- `status_and_completed_at_stay_in_sync`: status `done` mengisi `completed_at` = `now`; kembali ke `plan` mengosongkannya; membuat tugas langsung `done` juga mengisinya.
- `subtasks_follow_their_parent`:
  - sub-tugas memakai proyek induknya, walaupun `project_id` yang dikirim berbeda;
  - sub-tugas dari sub-tugas ditolak;
  - `sub_done` dan `sub_total` di kartu induk benar.
- `moving_a_parent_moves_its_subtasks`: `update_task` dengan `project_id` baru ikut memindah anak-anaknya; `project_id: null` membuatnya lepas.
- `patch_leaves_missing_fields_alone`: memakai JSON `{"tag":"UI"}`, lalu `{"startAt":null}`. Hanya field yang dikirim yang berubah.
- `delete_task_takes_its_subtasks`
- `overdue_only_for_open_tasks_due_before_today`
- `convert_to_task_only_takes_notes`: catatan menjadi tugas `plan`, dengan tenggat tetap; tugas atau proyek ditolak `Invalid`.
- `get_task_lists_subtasks_and_parent`

- **Commit:** `feat: add tasks with status, subtasks and conversion from notes`.

### Task 3: `projects.rs`

**Files:** Create `src-tauri/src/projects.rs`. Modify `src-tauri/src/lib.rs` (`mod projects;`).

**Antarmuka:**

```rust
#[serde(rename_all = "lowercase")] pub enum ProjectKind { App, Document, Research, Personal }   // ToSql/FromSql
#[serde(rename_all = "lowercase")] pub enum ProjectStatus { Active, Late, Done }

pub struct ProjectSummary { id, name, kind: ProjectKind, deadline_at: Option<i64>, deadline_days: Option<i64>,
                            status: ProjectStatus, done: i64, total: i64 }
pub struct ProjectDetail { #[serde(flatten)] summary: ProjectSummary, description: String, repo_url: Option<String> }
pub struct ProjectInput { id: Option<String>, name: String, kind: ProjectKind, deadline_at: Option<i64>,
                          repo_url: Option<String>, description: String }
pub struct LooseCount { done: i64, total: i64 }
pub struct Overview { projects: Vec<ProjectSummary>, active_count: i64, loose: LooseCount, upcoming: Vec<TaskCard> }
pub struct Columns { plan: Vec<TaskCard>, doing: Vec<TaskCard>, done: Vec<TaskCard> }
pub struct Board { project: Option<ProjectDetail>, columns: Columns }

pub fn save_project(conn, &ProjectInput, now, tz) -> Result<ProjectDetail, AppError>
pub fn delete_project(conn, id, now) -> Result<(), AppError>
pub fn projects_overview(conn, now, tz) -> Result<Overview, AppError>
pub fn project_board(conn, id: Option<&str>, now, tz) -> Result<Board, AppError>
pub fn repo_url(conn, id) -> Result<String, AppError>      // untuk command open_repo
pub fn active_projects(conn, now, tz, limit: usize) -> Result<Vec<ProjectSummary>, AppError>   // untuk dashboard
```

**Aturan:** spec §3–4 (P3, P6, P9, P10, P11): urutan daftar, progres dari tugas induk, status proyek, `deadline_days`, dan Tenggat terdekat.

**Test** (`projects::tests`):
- `project_input_is_validated`: nama kosong; URL `https://gitlab.com/a/b`, `http://github.com/a/b`, dan `https://github.com/a` ditolak; `https://github.com/syharipf/anchoa` diterima.
- `progress_counts_top_level_tasks_only`
- `status_and_deadline_days`:
  - deadline kemarin, belum selesai → `late`, `-1`;
  - deadline hari ini → `active`, `0`;
  - semua tugas selesai → `done`;
  - tanpa tugas dan tanpa deadline → `active`.
- `overview_orders_projects_and_counts_loose_tasks`: urutan dan `activeCount` sesuai spec, dan `loose` menghitung tugas induk tanpa proyek.
- `upcoming_is_five_open_dated_tasks_including_late`
- `board_columns_hold_top_level_tasks_in_due_order`: `id: None` memberi kanban Tugas lepas dengan `project: None`.
- `deleting_a_project_frees_its_tasks`
- `repo_url_requires_a_repo`

- **Commit:** `feat: add projects with progress, status and kanban board`.

### Task 4: Dashboard, command, dan frontend minimal

**Files:**
- Modify `src-tauri/src/dashboard.rs`:
  - `today_tasks` dan `upcoming` memakai `type = 'task'`;
  - field baru `projects: Vec<ProjectSummary>` dari `active_projects(conn, now, tz, 2)`.
- Modify `src-tauri/src/items.rs`: hapus `complete` kalau tidak dipakai lagi.
- Modify `src-tauri/src/commands.rs` dan `src-tauri/src/lib.rs`:
  - command baru: `projects_overview`, `project_board`, `save_project`, `delete_project`, `open_repo`, `create_task`, `get_task`, `update_task`, `delete_task`, `convert_to_task`;
  - hapus `complete_item`.
  - `open_repo` memakai `repo_url` lalu `app.opener().open_url(url, None::<&str>)`, dengan pola error yang sama seperti `open_folder`.
- Modify `src/api.ts`:
  - tipe untuk semua bentuk data di spec §4;
  - `Dashboard.projects`;
  - pemanggil untuk semua command baru;
  - hapus `completeItem`.
- Modify `src/dashboard/useDashboard.ts`: `toggle` memanggil `api.updateTask(id, { status: done ? "done" : "plan" })`.

**Test:**
- `dashboard::tests` diperbarui:
  - helper `note_due` diganti helper yang membuat tugas lewat `tasks::create_task` lalu `items::update` untuk tenggat;
  - `complete` diganti `update_task` status;
  - `finance_items_stay_out_of_note_lists` tetap lulus;
  - test baru `dashboard_lists_two_active_projects`.
- `bun run test` dan typecheck lulus.
- E2E penuh `PASS`. `check_dashboard` tetap mencentang tugas, dan kolom `completed_at` harus terisi.

- **Commit:** `feat: expose project and task commands; dashboard reads tasks`.
- **Penutup PR 3A-1.**

---

# PR 3A-2: Halaman Proyek

### Task 5: Aturan tampilan

**Files:** Create `src/projects/view.ts`, `src/projects/view.test.ts`.

**Antarmuka:**
- `KIND_LABELS: Record<ProjectKind, string>`: Aplikasi, Dokumen, Riset, Pribadi.
- `STATUS_LABELS: Record<ProjectStatus, { label: string; tone: "accent" | "danger" | "muted" }>`: Aktif, Terlambat, Selesai.
- `deadlineLabel(deadlineAt, deadlineDays)` → `"31 Okt"`, `"hari ini"`, `"terlambat 3 hari"`, atau `""` tanpa deadline.
- `nextStatus(status)`: plan→doing→done→plan.
- `moveLabel(status)`: "Pindah ke Dikerjakan", "Pindah ke Selesai", "Kembalikan ke Rencana".
- `subLabel(card)` → `"3/5"`, atau `null` tanpa sub-tugas.

**Test:** semua cabang di atas.
**Commit:** `feat: add project display rules`.

### Task 6: Halaman Proyek

**Files:**
- Create di `src/projects/`:
  - `ProjectsPage.tsx`: state dan pemuatan data;
  - `ProjectList.tsx`: daftar dan entri Tugas lepas;
  - `UpcomingList.tsx`;
  - `ProjectHeader.tsx`;
  - `Kanban.tsx`: kolom, kartu, dan input "+ Tugas";
  - `ProjectForm.tsx`: memakai `Dialog`.
- Modify `src/App.tsx`: render `ProjectsPage` untuk `page.name === "proyek"`, dengan prop `onOpenItem` dan `onChanged={reload}`.
- Modify `src/shell/nav.ts`: entri `proyek` tanpa `fase` dan `about`.

**Perilaku:** spec §5 "Halaman Proyek" dan "Formulir proyek". Layout mengikuti `Proyek.dc.html`, dengan warna dari token `src/index.css`:
- kolom kiri 300px;
- kanban `grid-cols-3`;
- kartu memakai `PANEL`/`ROW` dari `src/shell/ui.ts`.

Setelah setiap perubahan, muat ulang overview dan kanban, lalu panggil `onChanged`.

**Test:** `bun run typecheck` dan `bun run test`.
**Commit:** `feat: add the Proyek page with kanban`.

### Task 7: Kartu dashboard dan palette "Buat tugas"

**Files:**
- Create `src/dashboard/ProjectsCard.tsx`: dua proyek dengan bar progres, "Belum ada proyek", dan klik membuka Proyek.
- Modify `src/dashboard/Dashboard.tsx`: ganti `moduleCard("proyek")`.
- Modify `src/palette/results.ts`, `results.test.ts`, `CommandPalette.tsx`:
  - varian opsi `{ kind: "task"; id: "task"; label: "Buat tugas: “…”"; sub: ""; text }` setelah opsi `capture`, di grup yang sama (judul grup "Simpan");
  - `run` memanggil `api.createTask({ title: text, status: "plan" })`, lalu menampilkan toast "Tugas dibuat" dengan aksi "Buka" → `onOpenItem(id)`;
  - kegagalan menampilkan toast error, dan palette tetap terbuka.

**Test:**
- Test palette yang sudah ada disesuaikan: grup terakhir sekarang bernama "Simpan" dan berisi 2 opsi.
- Test baru: opsi "Buat tugas" membawa teks yang sudah di-trim.

**Commit:** `feat: add the projects dashboard card and the palette task option`.

### Task 8: E2E halaman Proyek

**Files:** Modify `scripts/e2e-smoke.sh`: fungsi `check_projects`, yang ditambahkan ke daftar pemanggilan.

Alur:
1. nav Proyek (y=364), lalu screenshot `12-projects-empty`;
2. "+ Proyek" → isi nama "Anchoa v1" → Enter;
3. "+ Tugas" di kolom Rencana → ketik "Tugas A" Enter, lalu "Tugas B" Enter;
4. tombol → pada kartu pertama;
5. screenshot `12-projects`.

Cek DB:
- ada 1 baris `projects`;
- ada 2 `tasks` dengan `project_id` proyek itu;
- satu berstatus `doing` dan satu `plan`.

Lalu nav Dashboard, screenshot `12-dashboard`, dengan harapan kartu Proyek menampilkan "Anchoa v1 · 0%". Koordinat diukur dari screenshot build ini.

**Commit:** `test: cover projects and the kanban end to end`.
**Penutup PR 3A-2.**

---

# PR 3A-3: Halaman item untuk tugas

### Task 9: Halaman item

**Files:**
- Create `src/item/TaskFields.tsx`: status (`Segmented`), proyek (select), mulai, tenggat, tag. Semuanya autosave; tenggat lewat `updateItem`, sisanya lewat `updateTask`.
- Create `src/item/Subtasks.tsx`: daftar dengan checkbox dan judul (klik membuka), plus input tambah (Enter → `createTask({ title, parentId, status: "plan" })`).
- Modify `src/item/ItemPage.tsx`:
  - untuk catatan: hapus field tenggat, tambah tombol "Jadikan tugas" (`convertToTask`, lalu muat ulang);
  - untuk tugas: `TaskFields`, tautan "↑ induk" untuk sub-tugas, dan `Subtasks` untuk tugas induk.
  - `ItemPage` butuh `onOpenItem` untuk membuka sub-tugas dan induk, jadi `App.tsx` meneruskannya.

**Test:** `bun run typecheck` dan `bun run test`. Tambahkan pure helper di `src/projects/view.ts` kalau ada logika yang bisa diuji.
**Commit:** `feat: edit task fields and subtasks on the item page`.

### Task 10: E2E tugas, versi 0.3.0, dan penutup

**Files:** `scripts/e2e-smoke.sh`, `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `README.md`, dan `CLAUDE.md` (Status).

Perluas `check_projects` setelah langkah Task 8:
1. klik kartu "Tugas B" → halaman item → ketik sub-tugas "Sub 1" Enter → cek DB `parent_id`;
2. kembali, lalu kartu menampilkan "0/1" (screenshot `12-subtasks`);
3. palette: ketik "tugas dari palette", pilih "Buat tugas", lalu cek DB (tugas `plan` tanpa proyek);
4. Ctrl+N "catatan jadi tugas" → buka dari Inbox → "Jadikan tugas" → cek DB `type = 'task'`.

Naikkan versi ke 0.3.0 di semua tempat itu, seperti Task 22 Fase 2. Status di CLAUDE.md: "Fase 3A (Proyek dan tugas) is built; next is Fase 3B (Jadwal)".

**Commit:** `test: cover tasks end to end; bump version to 0.3.0`.
**Penutup PR 3A-3**, lalu rilis "Anchoa v0.3.0 — Proyek dan tugas".
