# Anchoa Jurnal v2 — J-4 Data: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entri jurnal dapat diekspor ke Markdown ber-frontmatter YAML, dicari secara cepat dan aman melalui FTS5, dan mendukung tautan wiki `[[Judul]]` dua arah ke Catatan dan Tugas. Ditutup dengan rilis v0.19.0.

**Architecture:** Rust backend menambahkan command `journal_export` (format nama `YYYY-MM-DD-<slug>.md`, YAML front-matter, proteksi bentrok nama `-2`, `-3`), beralih ke `items_fts` di `journal_list` memakai token sanitized `fts_query`, dan memanggil `links::refresh` saat entri disimpan. Frontend `EntryEditor` mendukung pengetikan `[[` dengan autocomplete suggest, daftar tautan di bawah editor, dan menu tombol "Ekspor entri ini" serta "Ekspor semua".

**Tech Stack:** Rust + rusqlite + fts5 + jiff, React + TypeScript + Tailwind, bun test, Xvfb E2E.

**Spec:** `docs/superpowers/specs/2026-10-03-anchoa-jurnal-v2-design.md` (V12–V14, §1, §3).

## Global Constraints

- Semua aturan di `CLAUDE.md` berlaku. Frontend hanya memanggil invoke lewat `src/api.ts`.
- Soft delete: setiap query menyaring `deleted_at IS NULL`. Entri terhapus tidak pernah diekspor.
- Ekspor tidak pernah menimpa berkas yang ada di disk pengguna.
- Command mengembalikan `Result<T, AppError>`, tanpa panic pada jalur user.
- SonarCloud: props `Readonly<...>`, elemen non-tombol dengan `onClick` butuh handler keyboard, tanpa `Math.random()`.
- Teks UI Bahasa Indonesia.
- Setelah PR J-4 di-merge, lakukan rilis `v0.19.0` (bump versi di `Cargo.toml`, `package.json`, `tauri.conf.json`, buat tag git `v0.19.0`, dan buka GitHub Release).

| PR | Task |
|---|---|
| J-4 (#143, milestone "Jurnal v2") | 1–5 |

---

### Task 1: Backend — Ekspor Markdown Ber-frontmatter YAML (V12)

**Files:**
- Modify: `src-tauri/src/journal.rs` (tambah struct `ExportResult`, fungsi `journal_export`, fungsi pembantu pembuatan slug, sanitasi nama berkas unik, dan unit tests)
- Modify: `src-tauri/src/commands.rs` (tambah command `journal_export`)
- Modify: `src-tauri/src/lib.rs` (daftarkan `commands::journal_export`)

**Interfaces:**
- Produces (Rust):
  ```rust
  #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
  #[serde(rename_all = "camelCase")]
  pub struct ExportResult {
      pub count: usize,
      pub dir: String,
  }

  pub fn journal_export(
      conn: &Connection,
      dir: &Path,
      ids: Option<Vec<String>>,
      now: i64,
      tz: &TimeZone,
  ) -> Result<ExportResult, AppError>;
  ```
  - Format nama berkas: `<YYYY-MM-DD>-<slug>.md` (contoh: `2026-10-04-refleksi-harian.md`, jika tanpa judul `2026-10-04-entri.md`).
  - Jika berkas sudah ada: `<YYYY-MM-DD>-<slug>-2.md`, `-3.md`, dst.
  - Front-matter YAML:
    ```yaml
    ---
    jenis: idea | vent | note
    suasana: 1..5 | null
    tag: [tag1, tag2]
    dibuat: 2026-10-04T10:45:00+07:00
    ---
    <isi berkas>
    ```

- [ ] **Step 1: Tulis unit test failing di `journal.rs` untuk `journal_export`**
- [ ] **Step 2: Implementasi `journal_export` dan penamaan berkas anti-bentrok**
- [ ] **Step 3: Tambah command `journal_export` di `commands.rs` & `lib.rs`**
- [ ] **Step 4: Jalankan `cargo test journal::tests` dan pastikan lulus**

---

### Task 2: Backend — Pencarian FTS5 & Tautan `[[...]]` Wikilinks (V13, V14)

**Files:**
- Modify: `src-tauri/src/journal.rs` (update `journal_list` memakai `items_fts MATCH` dengan query dari `search::fts_query`, panggil `links::refresh` di `after_note_saved` dan `create_entry`)
- Modify: `src-tauri/src/links.rs` (pastikan pencarian backlink mengikutsertakan entri jurnal)
- Modify: `src-tauri/src/commands.rs` (pastikan `link_suggest` tersedia untuk editor jurnal)

**Interfaces:**
- Produces:
  - `journal_list` menggunakan FTS5 untuk mencocokkan judul dan isi entri secara cepat dan aman dari injeksi sintaks FTS.
  - Tautan `[[Judul Halaman]]` atau `[[Judul Tugas]]` dalam isi jurnal terhubung ke sistem referensi silang app.

- [ ] **Step 1: Tulis unit test di `journal.rs` untuk pencarian FTS5 dan refresh wikilinks**
- [ ] **Step 2: Implementasi integrasi `items_fts` di `journal_list` dan `links::refresh` pada simpan entri**
- [ ] **Step 3: Jalankan `cargo test journal::tests` dan pastikan lulus**

---

### Task 3: Frontend API & Ekspor Dialog (V12)

**Files:**
- Modify: `src/api.ts` (tambah method `journalExport: (dir: string, ids?: string[]) => invoke<ExportResult>("journal_export", { dir, ids })`)
- Modify: `src/api.test.ts` (test invoke `journal_export`)
- Modify: `src/journal/JournalPage.tsx` (tambah tombol "Ekspor semua" dengan dialog pemilih folder `@tauri-apps/plugin-dialog`)
- Modify: `src/journal/EntryEditor.tsx` (tambah tombol/opsi "Ekspor entri ini" di menu entri)

- [ ] **Step 1: Update `src/api.ts` dan test `src/api.test.ts`**
- [ ] **Step 2: Implementasi tombol dan alur dialog ekspor di `JournalPage.tsx` dan `EntryEditor.tsx`**
- [ ] **Step 3: Tulis unit test frontend untuk aksi ekspor**
- [ ] **Step 4: Jalankan `bun run typecheck` dan `bun run test`**

---

### Task 4: Frontend — Autocomplete `[[...]]` dan Panel Tautan di Editor (V14)

**Files:**
- Modify: `src/journal/EntryEditor.tsx` (deteksi pengetikan `[[`, popup autocomplete suggest dari `api.linkSuggest()`, panel daftar tautan di bawah editor)
- Modify: `src/journal/EntryEditor.test.tsx` (unit test autocomplete dan navigasi klik tautan)

- [ ] **Step 1: Tulis unit test untuk autocomplete `[[` dan klik tautan di `EntryEditor.test.tsx`**
- [ ] **Step 2: Implementasi popup autocomplete `[[` dan daftar tautan aktif di `EntryEditor.tsx`**
- [ ] **Step 3: Jalankan `bun run typecheck` dan `bun run test`**

---

### Task 5: Smoke Test E2E, Review, Finalisasi PR, dan Rilis v0.19.0

**Files:**
- Modify: `scripts/e2e-smoke.sh` (tambah pengujian ekspor entri dan pencarian FTS di `check_journal_v2`)
- Modify: `Cargo.toml`, `package.json`, `src-tauri/tauri.conf.json` (bump versi ke `0.19.0`)

- [ ] **Step 1: Jalankan full suite: typecheck, bun test, cargo test, cargo clippy**
- [ ] **Step 2: Update dan jalankan E2E smoke test `check_journal_v2`**
- [ ] **Step 3: Review diff per branch (role `reviewer`)**
- [ ] **Step 4: Buka PR dengan `Closes #143`, tunggu CI hijau, dan merge ke `main`**
- [ ] **Step 5: Buat tag `v0.19.0` dan rilis GitHub**
- [ ] **Step 6: Update status task di Kanban Anchoa ke `done`**
