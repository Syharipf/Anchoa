# Anchoa Fase 6 (Berkas): Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Kode ditulis oleh Gemini 3.8 Flash High lewat `agy-multi`, lalu dicek sesi Opus.

**Goal:** Pengelola file lokal: Tempat dan Perangkat, navigasi, tampilan ikon atau daftar, pratinjau, pilih banyak, salin dan pindah lewat papan klip, serta hapus ke Tong Sampah.

**Architecture:**
- Satu modul Rust baru, `files.rs`, dengan fungsi murni yang menerima akar yang diizinkan sebagai parameter, supaya bisa dites di direktori sementara.
- Command di `commands.rs` mengisi akar dari `HOME` dan mount.
- Pratinjau memakai protokol aset Tauri.
- Frontend untuk halaman ini ada di `src/files/`, dengan aturan seleksi dan format di `src/files/view.ts`.

**Spec:** `docs/superpowers/specs/2026-10-01-anchoa-fase6-berkas-design.md`. Bacalah seluruhnya dulu, terutama F3 (keamanan path) dan F15 (E2E dengan `HOME` sementara).

**Bentuk rencana:** sama seperti rencana Fase 3 dan 4. Rencana ini berisi antarmuka, aturan, dan test wajib. Kerjakan TDD dengan satu commit per task. Stage path secara eksplisit.

## Global Constraints

- Semua Global Constraints rencana sebelumnya berlaku, termasuk aturan SonarCloud: tidak ada JSX yang diulang, tidak ada ternary bertingkat, props `Readonly`, `fieldset` dengan `legend`, tidak ada elemen blok di dalam `<button>`, tanpa `autoFocus`, dan `toHaveLength` di test.
- **Keamanan:**
  - setiap path dari frontend lewat `guard(path, roots)` (canonicalize lalu cek prefiks) sebelum dipakai;
  - tidak ada hapus permanen;
  - test Rust hanya menyentuh direktori sementara (`tempfile`, yang sudah ada di dev-dependencies);
  - E2E menjalankan app dengan `HOME` sementara.
- **Tidak ada dependency baru.** `gio` dipanggil lewat `std::process::Command`.
- Nama rilis: "Anchoa v0.7.0 — Berkas".

## Pembagian PR

| PR | Branch | Task |
|---|---|---|
| 6-1 | `feat/70-f6-1-files-backend` | 1–2 |
| 6-2 | `feat/71-f6-2-files-page` | 3–5 |

---

# PR 6-1

### Task 1: `files.rs`

**Antarmuka:**

```rust
#[serde(rename_all = "lowercase")] pub enum FileKind { Folder, Image, Video, Pdf, Text, Other }
#[serde(rename_all = "lowercase")] pub enum PasteMode { Copy, Move }
#[serde(rename_all = "lowercase")] pub enum OnConflict { Replace, Skip, Rename }
pub struct Place { name, path, icon }
pub struct Entry { name, path, kind, size: u64, modified: i64, hidden: bool }
pub struct Listing { path, parent: Option<String>, crumbs: Vec<Crumb>, entries: Vec<Entry> }
pub struct PasteRequest { sources: Vec<String>, dest: String, mode: PasteMode, on_conflict: Option<OnConflict> }
pub struct OpReport { done: Vec<String>, failed: Vec<Failure>, conflicts: Vec<String> }
pub fn xdg_places(home: &Path, user_dirs_text: Option<&str>) -> Vec<Place>
pub fn parse_mounts(proc_mounts: &str, user: &str) -> Vec<Place>
pub fn guard(path: &str, roots: &[PathBuf]) -> Result<PathBuf, AppError>
pub fn list_dir(path, hidden, roots) -> Result<Listing, AppError>
pub fn read_text(path, roots) -> Result<TextPreview, AppError>          // 64 KB
pub fn paste(req, roots) -> Result<OpReport, AppError>
pub fn trash(paths, roots, run: impl Fn(&Path) -> io::Result<()>) -> Result<OpReport, AppError>
pub fn unique_name(dest_dir, name) -> PathBuf                          // "nama (2).ext"
pub fn kind_of(path) -> FileKind
```

**Test** (`files::tests`, semuanya di `tempfile::tempdir()`):
- `xdg_dirs_come_from_user_dirs_or_defaults`
- `mounts_under_run_media_only`
- `guard_rejects_paths_outside_the_roots`: `../`, symlink keluar akar, dan `/etc`.
- `listing_sorts_folders_first_and_hides_dotfiles`
- `crumbs_walk_up_to_the_root`
- `kind_by_extension`
- `copy_and_move_files_and_folders`
- `conflicts_are_reported_before_anything_is_written`
- `replace_skip_and_rename_resolve_conflicts`
- `a_folder_cannot_go_inside_itself`
- `read_text_truncates_at_64_kb`
- `trash_uses_the_injected_runner`

**Commit:** `feat: add the local file manager backend`.

### Task 2: Command, konfigurasi, dan tipe API

- `commands.rs`:
  - `file_places`, `list_dir`, `read_text`, `paste_items` (async `spawn_blocking`), `trash_items` (async, `gio trash <path>`), dan `open_file` (opener);
  - akar = `HOME` ditambah mount dari `/proc/mounts`.
- `lib.rs`.
- `tauri.conf.json`: `assetProtocol` dan CSP sesuai spec §3. `Cargo.toml`: fitur `protocol-asset` pada `tauri` (wajib kalau `assetProtocol.enable` aktif; ini fitur, bukan dependency baru).
- `src/api.ts`: tipe dan pemanggil, plus helper `assetUrl(path)` yang memakai `convertFileSrc` dari `@tauri-apps/api/core`. Ini satu-satunya pemakaian langsung API Tauri selain `invoke`, dan diletakkan di `api.ts`.

**Test:** `cargo test`, clippy, typecheck, `bun run test`, dan E2E penuh `PASS`.
**Commit:** `feat: expose file commands and the asset protocol`.
**Penutup PR 6-1.**

---

# PR 6-2

### Task 3: Aturan tampilan

`src/files/view.ts` dan `view.test.ts`:
- `select(state, index, { ctrl, shift })`: klik biasa, Ctrl toggle, dan Shift rentang dari jangkar.
- `formatSize(bytes)`: "512 B", "4 KB", "12,4 MB", "1,2 GB".
- `KIND_LABELS` dan ikon per jenis, dengan path dari artboard.
- `totalSize(entries, selection)`.

**Commit:** `feat: add file manager selection and format rules`.

### Task 4: Halaman Berkas

**Files:**
- `src/files/` berisi `FilesPage.tsx`, `PlacesSidebar.tsx`, `FilesToolbar.tsx`, `FileGrid.tsx`, `FileList.tsx`, `PreviewPanel.tsx`, `ActionBar.tsx`, dan `ConflictDialog.tsx` (memakai `Dialog`).
- `nav.ts`: Berkas tanpa `fase` dan `about`.
- `App.tsx`.

**Perilaku:** spec §4. Riwayat kembali dan maju disimpan di state halaman. Papan klip disimpan di state `App`, supaya tetap ada saat pindah halaman.

**Test:** typecheck dan `bun run test`.
**Commit:** `feat: add the Berkas page`.

### Task 5: E2E dengan `HOME` sementara, versi 0.7.0, penutup

**`scripts/e2e-smoke.sh`:** fungsi `check_files` yang menjalankan app dengan `HOME="$WORK/home"`. Isi `HOME` itu sebelum `start_app`:
- `Dokumen/catatan.txt`;
- `Gambar/contoh.png`: PNG 1×1, dibuat dengan `magick -size 64x64 xc:#C6F36B`;
- `Dokumen/kecil.pdf`, dibuat dengan `magick xc:white kecil.pdf`;
- `Unduhan/`.

Alur sesuai spec §5. Koordinat diukur dari screenshot. Setelah selesai, `HOME` kembali seperti semula untuk check berikutnya. Gunakan subshell atau variabel lokal, dan jangan `export HOME` secara global di script.

**Versi 0.7.0.** Status di `CLAUDE.md`.

**Commit:** `test: cover the file manager end to end; bump version to 0.7.0`.
**Penutup PR 6-2**, lalu rilis "Anchoa v0.7.0 — Berkas".
