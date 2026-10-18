# Anchoa — Proyek Studio: Mission Control & Observabilitas AI

Tanggal: 2026-10-18
Status: Disetujui user untuk fase perancangan. Mengikuti artboard `docs/design/artboards/ProyekStudio.dc.html` dan `docs/design/artboards/ProyekPrdReview.dc.html`.

## 1. Ringkasan

Menu Proyek ditingkatkan dari sekadar kanban tugas menjadi **Mission Control & Observabilitas AI**:
- **Bukan IDE:** Anchoa tidak menggantikan VS Code/terminal pengguna, melainkan memantau seluruh siklus pengerjaan AI dari planning sampai rilis.
- **Pipeline Tracker (SVG Animasi):** Visualisasi horizontal 6 tahap siklus: PRD/Spec → Arsitektur/Flow → Rencana (Kanban) → Coding (Harness Aktif) → Tes/Review → Selesai/Release.
- **Konteks Produk (PRD & Canvas Alur Bisnis):**
  - PRD disimpan di file markdown repo: `.anchoa/prd.md`.
  - Diagram proses bisnis disimpan dalam JSON node-edge ringkas: `.anchoa/flow.json`, dirender interaktif dengan auto-layout SVG di Anchoa.
- **Harness & Terminal PTY (Drawer Bawah):**
  - Menampilkan live output stdout/stderr proses harness yang sedang berjalan di direktori repo.
  - Bar prompt cepat untuk menginjeksi instruksi langsung ke proses harness.
  - Tombol aksi: jalankan app lokal (`cargo run`, `npm run dev`, dsb.) dan buka terminal emulator OS eksternal di folder repo.
- **Alur Review Draft AI (Opsi A):**
  - User menginput sasaran umum → Harness (`omp`) menghasilkan draf PRD, flow diagram, dan pemecahan task.
  - User meninjau dan mengedit langsung di Anchoa sebelum menyetujui eksekusi otomatis.

## 2. Keputusan Desain & Arsitektur

| Kode | Keputusan | Alasan |
|---|---|---|
| S1 | PRD dan Alur Bisnis disimpan sebagai berkas lokal di folder proyek: `.anchoa/prd.md` dan `.anchoa/flow.json`. | AI harness (`omp`) dapat membaca dan menulis langsung via filesystem tanpa perlu dependensi atau izin database Anchoa. Berkas ikut terkelola di Git. |
| S2 | Canvas alur proses bisnis memakai format DSL node-edge JSON terstruktur, bukan koordinat pixel bebas. | Hemat token context saat digenerate oleh AI ($\approx 50\text{--}100$ token). Frontend Anchoa yang menghitung posisi $x,y$ dan layout konektor SVG. |
| S3 | Pipeline Tracker dirender dengan elemen SVG native dan CSS animation keyframes (`tokens.css`). | Hemat baterai dan GPU pada laptop dev (NVIDIA/Intel hybrid). Tidak memakai canvas WebGL berat. |
| S4 | Terminal terintegrasi di panel bawah (drawer 165px) memanfaatkan proses PTY di backend Rust (`portable-pty`) atau stream log runner yang ada, dilengkapi tombol *Terminal Luar ↗*. | Pengguna tetap fokus di satu jendela tanpa harus bolak-balik Alt+Tab, namun tetap memiliki opsi terminal penuh di sistem. |
| S5 | Tampilan tab di dalam satu proyek: **Kanban (5 Kolom)**, **PRD & Alur Bisnis**, dan **Perubahan & Diff**. | Memisahkan konteks tugas, domain bisnis, dan inspeksi kode secara rapi tanpa membebani layar. |
| S6 | Git Diff & Status diambil langsung oleh Rust backend lewat perintah `git status --porcelain` dan `git diff --stat`. | Ringan, native, tidak butuh library git eksternal yang besar. |

## 3. Spesifikasi Berkas & Model Data

### Berkas `.anchoa/` di Folder Proyek

```
<project_dir>/
└── .anchoa/
    ├── prd.md         # Dokumen spesifikasi dan aturan bisnis (Markdown)
    └── flow.json      # Definisi graf alur proses bisnis (JSON)
```

Skema `.anchoa/flow.json`:
```json
{
  "version": 1,
  "nodes": [
    { "id": "input_hp", "label": "Form Input No HP", "type": "start", "desc": "UI Modal Client" },
    { "id": "rate_limit", "label": "Validasi Rate Limit", "type": "process", "desc": "Rust Token Bucket" },
    { "id": "gen_otp", "label": "Generate 6-Digit OTP", "type": "process", "desc": "CSPRNG Argon2" },
    { "id": "send_wa", "label": "Kirim Pesan WhatsApp", "type": "action", "desc": "WA Gateway API" },
    { "id": "fail_limit", "label": "Tolak: Limit Tercapai", "type": "error", "desc": "Toast Error" }
  ],
  "edges": [
    { "from": "input_hp", "to": "rate_limit" },
    { "from": "rate_limit", "to": "gen_otp" },
    { "from": "rate_limit", "to": "fail_limit", "condition": "exceeded" },
    { "from": "gen_otp", "to": "send_wa" }
  ]
}
```

## 4. API & Command Rust Baru

Semua command dipanggil via `src/api.ts` dan mengembalikan `Result<T, AppError>`:

1. `project_studio_context(project_id: String) -> Result<StudioContext, AppError>`
   - Membaca status repo: branch git aktif, commit terakhir, remote repo URL.
   - Membaca konten `.anchoa/prd.md` jika ada (null jika belum dibuat).
   - Membaca konten `.anchoa/flow.json` jika ada (null jika belum dibuat).
   - Mengembalikan ringkasan jumlah status task untuk pipeline tracker (tahap 1–6).

2. `project_save_prd(project_id: String, content: String) -> Result<(), AppError>`
   - Menyimpan string markdown ke `<project.agent_dir>/.anchoa/prd.md`.
   - Membuat direktori `.anchoa/` jika belum ada.

3. `project_save_flow(project_id: String, flow_json: String) -> Result<(), AppError>`
   - Memvalidasi dan menyimpan JSON ke `<project.agent_dir>/.anchoa/flow.json`.

4. `project_git_diff(project_id: String) -> Result<GitChanges, AppError>`
   - Menjalankan `git status --porcelain` dan `git diff --stat` di `project.agent_dir`.
   - Mengembalikan daftar file yang diubah (`path`, `status`: added/modified/deleted, `additions`, `deletions`).

5. `project_run_app(project_id: String) -> Result<(), AppError>`
   - Menjalankan perintah eksekusi aplikasi lokal yang dikonfigurasi di proyek (misal `cargo run` atau `bun dev`).

6. `project_open_external_terminal(project_id: String) -> Result<(), AppError>`
   - Membuka terminal emulator default OS (`x-terminal-emulator`, `kitty`, `ghostty`, `gnome-terminal`) dengan `working_directory = project.agent_dir`.

## 5. Komponen Frontend React

Lokasi di `src/projects/`:
- `StudioHeader.tsx`: Breadcrumb, badge repo/branch, status harness `omp`, tombol *Jalankan App* & *Draft Sasaran AI*.
- `PipelineTracker.tsx`: Visualisasi alur 6 tahap dengan SVG responsive dan CSS status glow.
- `PrdEditor.tsx`: Markdown viewer/editor untuk `.anchoa/prd.md`.
- `FlowCanvas.tsx`: Komponen canvas SVG interaktif untuk merender node-edge alur proses bisnis dari `flow.json`.
- `GitDiffTab.tsx`: File tree perubahan kode dan ringkasan diff line count.
- `TerminalDrawer.tsx`: Panel collapsible terminal output dan input prompt langsung ke harness.
- `PrdReviewModal.tsx`: Tampilan review draft AI (alur Opsi A) sebelum disetujui masuk pipeline.

## 6. Kriteria Verifikasi

1. **Unit Test Rust:**
   - Test pembacaan/penulisan `.anchoa/prd.md` dan `.anchoa/flow.json`.
   - Test parsing `git status --porcelain`.
2. **Unit Test Frontend (`bun test`):**
   - Render `PipelineTracker` menghitung tahap aktif sesuai data task.
   - Render `FlowCanvas` menghasilkan koordinat node dan garis konektor yang valid.
3. **E2E Smoke Test (Xvfb):**
   - Buka halaman proyek studio di display `:99`.
   - Navigasi antar-tab (Kanban, PRD & Bisnis, Perubahan).
   - Pastikan drawer terminal dapat dibuka dan ditutup.
