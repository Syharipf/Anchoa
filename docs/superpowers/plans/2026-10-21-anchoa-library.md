# Rencana Implementasi Modul Library

Tanggal: 2026-10-21
Spec acuan: `docs/superpowers/specs/2026-10-21-anchoa-library-design.md`

## Ringkasan

Implementasi modul Library Anchoa dibagi menjadi dua PR: LIB-1 (backend & fondasi data) dan LIB-2 (frontend, navigasi, dan integrasi UI).

## PR LIB-1: Backend Modul Library

### Ruang Lingkup
- Migrasi DB `019_library.sql`: tabel `media`, index `(status, kind)`, drop & buat ulang trigger `sync_items_*` menyertakan `'media'`, trigger sync outbox `sync_media_*`.
- Registrasi migrasi 019 di `src-tauri/src/db.rs`.
- Modul `src-tauri/src/library.rs`:
  - Enums `MediaKind` (`film`, `series`, `anime`, `book`, `manga`) dan `MediaStatus` (`want`, `active`, `finished`, `dropped`).
  - Structs DTO: `MediaInput`, `MediaRow`, `LibraryCounts`, `LibraryList`, `LibraryOverview`.
  - Fungsi domain: `save_media`, `set_media_status`, `delete_media`, `restore_media`, `library_list`, `library_overview`.
- Wiring Tauri:
  - Command Rust di `commands.rs`: `library_list`, `library_overview`, `save_media`, `set_media_status`, `delete_media`, `restore_media`.
  - Registrasi module dan command di `lib.rs`.
- Sync & Privasi:
  - Tambah `'media'` ke `SYNCED_TYPES` dan `EXTENSIONS` di `sync/record.rs`, sesuaikan test outbox & fixtures.
  - Kecualikan `'media'` dari `search_for_chat` di `search.rs` (L11).
  - Tambah tool baca `list_library` di `assistant/tools.rs` tanpa bocor kolom `body`.
- Unit test Rust di modul `library`, `sync/record`, `search`, `assistant/tools`, dan verifikasi migrasi database baru.

### Acceptance LIB-1
- `cargo test` lulus untuk seluruh test lama dan baru.
- `cargo clippy --all-targets -- -D warnings` bersih tanpa error/warning.
- DB baru berhasil menjalankan seluruh migrasi 001–019 dan lolos test pragmas.
- Transisi status L4 (idempoten, update tanggal/progres otomatis), validasi L8, soft delete + restore teruji.
- Outbox sync mendeteksi insert/update/delete media dan items media.
- Asisten dapat memanggil `list_library` tanpa memuat `body`, dan `search_for_chat` mengabaikan media.

## PR LIB-2: Frontend Modul Library

### Ruang Lingkup
- Tipe data TypeScript dan API caller di `src/api.ts` dan modul `src/library/`.
- Navigasi & Shell:
  - Tambah PageId `library` di `src/shell/nav.ts` (posisi setelah `unduhan`).
  - Tambah SVG path ikon library di `Sidebar.tsx` dan `MobileDock.tsx`.
  - Label pencarian palette `media` → `"Library"` di `src/palette/results.ts`.
  - Routing `openItem` di `App.tsx` agar tipe `media` membuka dialog Library.
  - Tambah hint asisten untuk rute Library di shell.
- Halaman Library (`src/library/`):
  - View model & helper teks status (`Watching` vs `Reading`, chip count).
  - Filter bar (search query, dropdown kind, chip status counts).
  - Card grid responsif per jenis media, mini rating bintang, progres bar.
  - Modal detail & editor media (form validasi, slider/number progress, rating bintang, tags, body/review).
- Integrasi Dashboard: kartu ringkasan Library (active items, finished this month, want count).
- E2E smoke test: skrip `check_library` di `scripts/e2e-smoke.sh` (Xvfb & verifikasi SQLite).

### Acceptance LIB-2
- `bun run typecheck` dan `bun run build` bersih tanpa error.
- Halaman Library dapat diakses lewat sidebar rail, mobile dock, dan command palette.
- Navigasi `openItem` dari palette membuka item media di Library modal.
- Operasi CRUD media, filter status/kind, update progres, dan toast undo delete berfungsi normal.
- Kartu Dashboard Library menampilkan statistik yang sinkron dengan DB.
- E2E smoke test `scripts/e2e-smoke.sh` skenario Library lulus di Xvfb.
