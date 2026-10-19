# Anchoa — Rencana Implementasi: Proyek Studio Mission Control

Tanggal: 2026-10-18
Spesifikasi: `docs/superpowers/specs/2026-10-18-anchoa-proyek-studio-design.md`
Desain: `docs/design/artboards/ProyekStudio.dc.html`, `docs/design/artboards/ProyekPrdReview.dc.html`

Pekerjaan dipecah menjadi 5 PR terisolasi dengan prinsip TDD (Test-Driven Development). Setiap PR harus lolos seluruh check suite (`cargo test`, `cargo clippy`, `bun run test`, `bun run typecheck`) sebelum dimerge.

---

## PR 1: Fondasi Backend Rust (.anchoa/, Git Diff, Terminal Launcher)

**Tujuan:** Menyediakan command Rust untuk membaca/menulis berkas konteks produk (`.anchoa/`), status Git repo, dan peluncur terminal sistem.

### Task 1.1: Pembacaan & Penyimpanan Berkas `.anchoa/`
- **Files:** `src-tauri/src/projects.rs`, `src-tauri/src/commands.rs`, `src/api.ts`
- **Langkah:**
  1. Tulis unit test di `projects.rs`: `test_read_write_anchoa_files` (buat folder `.anchoa/`, simpan `prd.md` dan `flow.json`, baca kembali).
  2. Implementasi helper `read_project_file` dan `write_project_file` di bawah `agent_dir`.
  3. Validasi keamanan: path harus berada di bawah `agent_dir` (mencegah path traversal).
  4. Expose Tauri command `project_save_prd`, `project_save_flow`, dan `project_studio_context`.
- **Commit:** `feat(projects): add storage commands for .anchoa prd and flow files`

### Task 1.2: Status Git & Launcher Terminal
- **Files:** `src-tauri/src/projects.rs`, `src-tauri/src/commands.rs`, `src/api.ts`
- **Langkah:**
  1. Tulis unit test: `test_git_status_parser` (simulasi output `git status --porcelain`).
  2. Implementasi `project_git_diff`: eksekusi `git status --porcelain` dan `git diff --stat` di `agent_dir`.
  3. Implementasi `project_open_external_terminal`: deteksi binary terminal yang tersedia di OS (`kitty`, `ghostty`, `gnome-terminal`, `x-terminal-emulator`) dan spawn child process dengan working directory `agent_dir`.
  4. Daftarkan di `src/api.ts`.
- **Commit:** `feat(projects): add git diff status and external terminal launcher`

---

## PR 2: Pipeline Tracker SVG & Studio Header

**Tujuan:** Menampilkan visualisasi animasi siklus pengerjaan 6 tahap (SVG native) dan header proyek bergaya Mission Control.

### Task 2.1: Komponen PipelineTracker SVG
- **Files:** `src/projects/PipelineTracker.tsx`, `src/projects/PipelineTracker.test.tsx`
- **Langkah:**
  1. Tulis unit test: hitung tahap aktif berdasarkan jumlah task (`plan`, `doing`, `test`, `review`, `done`) dan keberadaan PRD.
  2. Implementasi komponen SVG: render node 1–6 dengan token warna lime (`#C6F36B`) dan animasi denyut CSS pada tahap aktif.
  3. Berikan event handler `onSelectStage` untuk melompat ke tab terkait saat node diklik.
- **Commit:** `feat(projects): add animated SVG pipeline tracker component`

### Task 2.2: Studio Header & Tab Switcher
- **Files:** `src/projects/StudioHeader.tsx`, `src/projects/ProjectsPage.tsx`
- **Langkah:**
  1. Buat `StudioHeader`: tampilkan breadcrumb, badge Git repo/branch, status harness `omp`, tombol *Jalankan App* dan *Draft Sasaran AI*.
  2. Perluas tab di `ProjectsPage.tsx`: `kanban` | `prd` | `diff`.
  3. Integrasikan `PipelineTracker` di bawah header proyek agen.
- **Commit:** `feat(projects): integrate studio header and tab switcher in projects page`

---

## PR 3: PRD Editor & Canvas Alur Bisnis

**Tujuan:** Memberikan antarmuka membaca/mengedit PRD Markdown dan canvas interaktif proses bisnis yang digenerate AI.

### Task 3.1: PrdEditor Component
- **Files:** `src/projects/PrdEditor.tsx`, `src/projects/PrdEditor.test.tsx`
- **Langkah:**
  1. Buat komponen editor markdown untuk `.anchoa/prd.md`.
  2. Gunakan komponen renderer Markdown yang sudah ada di Anchoa (`src/notes/markdown.tsx`).
  3. Tambahkan tombol edit cepat dan autosave ke backend via `api.projectSavePrd`.
- **Commit:** `feat(projects): add markdown PRD viewer and editor`

### Task 3.2: FlowCanvas Component (Auto-Layout Node-Edge)
- **Files:** `src/projects/FlowCanvas.tsx`, `src/projects/FlowCanvas.test.tsx`
- **Langkah:**
  1. Tulis algoritma auto-layout sederhana di TypeScript: ubah array node-edge menjadi koordinat horizontal $x,y$ dan path kurva SVG.
  2. Render node interaktif: warna berbeda untuk start, process, error, action.
  3. Tambahkan handler klik untuk mengubah label node secara lokal dan simpan ke `.anchoa/flow.json`.
- **Commit:** `feat(projects): add interactive SVG business process flow canvas`

---

## PR 4: Git Changes & Drawer Terminal PTY

**Tujuan:** Menyediakan panel inspeksi perubahan file dan drawer terminal bawah untuk memantau harness dan mengirim prompt langsung.

### Task 4.1: Komponen GitDiffTab
- **Files:** `src/projects/GitDiffTab.tsx`, `src/projects/GitDiffTab.test.tsx`
- **Langkah:**
  1. Tampilkan daftar file yang berubah (+/- jumlah baris, status hijau/kuning/merah).
  2. Klik file untuk melihat ringkasan patch diff.
- **Commit:** `feat(projects): add git changes and diff viewer tab`

### Task 4.2: Komponen TerminalDrawer
- **Files:** `src/projects/TerminalDrawer.tsx`, `src/projects/TerminalDrawer.test.tsx`
- **Langkah:**
  1. Buat panel drawer bawah collapsible (165px default, toggle ukuran ▲/▼).
  2. Stream output log runner yang sedang aktif atau log task terbaru via `api.agentLog`.
  3. Tambahkan prompt input bar: submit prompt langsung memicu `api.agentRequest` atau injeksi ke proses aktif.
  4. Tombol *Terminal Luar ↗* memanggil `api.projectOpenExternalTerminal`.
- **Commit:** `feat(projects): add collapsible terminal drawer with prompt injection`

---

## PR 5: Alur Review Draft AI (Opsi A) & E2E Smoke Test

**Tujuan:** Menyelesaikan alur input sasaran → AI buat draft → User review & edit → Setujui & eksekusi, serta verifikasi menyeluruh via Xvfb.

### Task 5.1: Modal Review & Approval Draft AI
- **Files:** `src/projects/PrdReviewModal.tsx`, `src/projects/PrdReviewModal.test.tsx`
- **Langkah:**
  1. Buat dialog layar penuh review sesuai `ProyekPrdReview.dc.html`.
  2. Tampilkan split-screen: PRD editor di kiri, Flow Canvas + preview daftar kartu tugas di kanan.
  3. Tombol aksi: *Batal*, *Revisi Draft AI*, dan *Setujui & Eksekusi Pipeline ▶* (memindahkan task ke Rencana dan memulai harness).
- **Commit:** `feat(projects): add AI draft PRD and task approval modal`

### Task 5.2: E2E Smoke Test di Xvfb
- **Files:** `scripts/e2e-smoke.sh`
- **Langkah:**
  1. Tambahkan fungsi `check_project_studio` di `scripts/e2e-smoke.sh`.
  2. Simulasikan pembuatan berkas `.anchoa/prd.md` dan `.anchoa/flow.json`.
  3. Buka halaman proyek studio di Xvfb `:99`, klik tab PRD, dan pastikan node canvas serta pipeline tracker ter-render di layar.
  4. Jalankan full build & smoke: `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`.
- **Commit:** `test(projects): add e2e smoke test for project studio mission control`
