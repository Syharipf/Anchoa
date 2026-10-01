# Anchoa Fase 4B (Catatan): Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Kode ditulis Gemini 3.8 Flash High lewat `agy-multi`, direview Codex, lalu dicek sesi Opus.

**Goal:** Halaman Catatan dengan pohon halaman, editor blok Markdown, `[[wikilink]]` dan backlink, pencarian FTS5, Sampah, dan ekspor Markdown.

**Architecture:**
- **Backend:** halaman adalah item `type = 'page'` yang bersarang lewat `parent_id`. Fungsi murninya ada di `notes.rs`, `links.rs`, dan `search.rs`, dan `commands.rs` hanya glue.
- **Frontend:** `src/notes/` memecah isi Markdown menjadi blok lewat fungsi murni (`blocks.ts`), merendernya sebagai elemen React (`markdown.tsx`), dan mengedit satu blok dalam satu waktu (`BlockEditor.tsx`).

**Tech Stack:** Tauri 2, Rust 2024, rusqlite 0.40 (`bundled`, FTS5 tersedia), React 19, TypeScript, Tailwind 4, bun test. Tidak ada dependency baru.

**Spec:** `docs/superpowers/specs/2026-10-01-anchoa-fase4b-catatan-design.md`. Baca seluruhnya, terutama §2 (C1–C18) dan §5.

**Bentuk rencana:** sama seperti rencana Fase 6 dan 7. Rencana ini berisi antarmuka, aturan, dan test wajib. Kerjakan TDD dengan satu commit per task, dan stage path secara eksplisit.

## Menjalankan task dengan agy

Satu task per run, di branch PR yang sedang dikerjakan, dari root worktree:

```bash
agy-multi --model gemini-3.8-flash-high --dangerously-skip-permissions --print-timeout 2100s -p "Implement Task <N> of docs/superpowers/plans/2026-10-01-anchoa-fase4b-catatan.md exactly as written, test first, including its tests and its commit. Read the spec docs/superpowers/specs/2026-10-01-anchoa-fase4b-catatan-design.md. Follow CLAUDE.md, including the SonarCloud conventions. Rules: work only inside this repository; do not push, merge, open PRs, change git remotes or branches; do not open URLs; do not edit docs/. Stage files by explicit path, never git add -A. Before committing run the task's checks and fix every failure. When done, print the tail of each check and the commit hash."
```

Setelah setiap run, sesi Opus menjalankan test task itu dan membaca diff commit-nya. Review PR memakai Codex (`CLAUDE.md`, "Model per step").

## Global Constraints

- Semua Global Constraints rencana sebelumnya berlaku, termasuk aturan SonarCloud: props `Readonly<...>`, tanpa `Math.random()`, dan elemen non-tombol yang punya `onClick` wajib punya handler keyboard.
- Tidak ada dependency baru, baik Rust maupun JS.
- `Db::conn()` adalah guard `std::sync::Mutex`. Jangan memegangnya sambil memanggil fungsi yang mengunci DB lagi.
- Semua query menyaring `deleted_at IS NULL`. ID memakai UUIDv7, dan waktu memakai epoch ms UTC.
- Tidak boleh ada `dangerouslySetInnerHTML`. Markdown dirender menjadi elemen React.
- Tautan luar hanya `http` dan `https`.
- Warna memakai kelas Tailwind dari `src/index.css` (`text-accent`, `bg-surface`, `border-line`, …), bukan hex.
- Nama rilis: "Anchoa v0.9.0 — Catatan".

## Pembagian PR

| PR | Branch | Task |
|---|---|---|
| 4B-1 | `feat/78-f4b-1-notes-backend` | 1–3 |
| 4B-2 | `feat/79-f4b-2-block-editor` | 4–6 |
| 4B-3 | `feat/80-f4b-3-notes-page` | 7–9 |

---

# PR 4B-1

### Task 1: Migrasi 009 dan `links.rs`

**Files:**
- Create: `src-tauri/migrations/009_notes.sql` (isi persis spec §3).
- Create: `src-tauri/src/links.rs`.
- Modify: `src-tauri/src/db.rs` (tambah migrasi), `src-tauri/src/lib.rs` (`mod links;`), `src-tauri/src/items.rs` (`update`), `src-tauri/src/journal.rs` (`create_entry`, `update_entry`), `scripts/e2e-smoke.sh` (`user_version` = 9).

**Antarmuka:**

```rust
pub fn parse(body: &str) -> Vec<String>
// Judul unik sesuai urutan muncul. "[[A|alias]]" menghasilkan "A". Judul dipangkas,
// dan judul kosong dibuang. Isi ``` fence ``` dan `kode inline` diabaikan.
pub fn rewrite(body: &str, old: &str, new: &str) -> String
// "[[Lama]]" menjadi "[[Baru]]" dan "[[Lama|x]]" menjadi "[[Baru|x]]". Pencocokan judul
// tidak membedakan huruf besar dan kecil. "[[Lama lain]]" dan kode tidak disentuh.
pub fn resolve(conn: &Connection, title: &str) -> Result<Option<ItemSummary>, AppError>
// Halaman dulu, lalu item lain dengan judul sama yang updated_at terbaru (C6).
pub fn refresh(conn: &Connection, from_id: &str, body: &str) -> Result<(), AppError>
// Hapus links milik from_id, lalu isi lagi dari parse(body) + resolve. Tautan ke diri sendiri dibuang.
pub fn backlinks(conn: &Connection, id: &str) -> Result<Vec<ItemSummary>, AppError>
// Item yang menautkan id, tidak terhapus, updated_at terbaru dulu.
```

- `items::update` memanggil `links::refresh` kalau `patch.body` dikirim.
- `journal::create_entry` dan `journal::update_entry` memanggil `links::refresh` setelah isi disimpan.
- `ItemSummary` dan `items::summaries` yang sudah ada dipakai ulang.

**Test:**
- `version_8_database_upgrades_to_notes_schema` (di `db.rs`): item lama bisa dicari lewat `items_fts`, dan backup `anchoa.db.bak-v8` ada;
- `fts_follows_title_and_body_updates`: insert, update judul, update isi, dan delete fisik tercermin di `items_fts`;
- `parse_skips_code_and_aliases`;
- `rewrite_changes_only_exact_titles`;
- `resolve_prefers_pages`;
- `refresh_and_backlinks_follow_saved_bodies`: lewat `items::update` dan `journal::update_entry`, dan item terhapus tidak muncul.

**Commit:** `feat: add the notes schema and wikilinks`.

### Task 2: `notes.rs`

**Files:**
- Create: `src-tauri/src/notes.rs`.
- Modify: `src-tauri/src/lib.rs`.

**Antarmuka:**

```rust
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct PageNode { pub id: String, pub title: String, pub parent_id: Option<String>, pub updated_at: i64 }
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct TrashEntry { pub id: String, pub title: String, pub deleted_at: i64, pub descendants: usize }

pub fn tree(conn) -> Result<Vec<PageNode>, AppError>                          // urut lower(title), lalu id
pub fn create(conn, parent_id: Option<&str>, title: &str, now) -> Result<PageNode, AppError>
pub fn rename(conn, id, title: &str, now) -> Result<PageNode, AppError>       // C8, satu transaksi
pub fn move_page(conn, id, parent_id: Option<&str>, now) -> Result<PageNode, AppError>  // C10
pub fn save_body(conn, id, body: &str, now) -> Result<(), AppError>           // + links::refresh
pub fn delete(conn, id, now) -> Result<(), AppError>                          // C9
pub fn trash(conn) -> Result<Vec<TrashEntry>, AppError>
pub fn restore(conn, id, now) -> Result<PageNode, AppError>
pub fn export(conn, root: &Path) -> Result<PathBuf, AppError>                 // C14, root = folder Dokumen
```

**Aturan:**
- Judul dipangkas, kosong menjadi "Tanpa judul", dan lebih dari 200 karakter berarti `AppError::Invalid`.
- Induk harus halaman yang tidak terhapus. Kalau bukan, kembalikan `Invalid("Induk harus halaman")`.
- `rename` dengan judul yang sama tidak menulis apa pun.
- Tautan ke halaman yang belum ada tidak disimpan di `links` (C7). Karena itu `create`, `rename`, dan `restore` memanggil `links::refresh_mentions(conn, title)`, fungsi baru di `links.rs`. Fungsi ini menjalankan `refresh` ulang untuk setiap item tidak terhapus yang isinya memuat `[[judul` (`LIKE`, tanpa membedakan huruf besar dan kecil). Dengan begitu backlink muncul begitu halaman tujuannya dibuat.
- `updated_at` hanya berubah oleh judul, isi, atau induk.
- Fungsi yang menerima `id` halaman terhapus atau bukan halaman mengembalikan `NotFound`.
- `delete` memakai `WITH RECURSIVE` untuk mengambil subpohon.
- `trash` hanya menampilkan baris halaman terhapus yang induknya tidak terhapus pada `deleted_at` yang sama.
- `restore` memindahkan halaman ke akar kalau induknya masih terhapus.
- `export`:
  - menulis ke `root/Anchoa Catatan/`;
  - nama file dari `downloads::safe_name(title)`, dibuat unik dengan `files::unique_name` per folder;
  - isi file adalah `items.body` apa adanya;
  - mengembalikan path folder `Anchoa Catatan`.

**Test:**
- `tree_lists_pages_sorted_without_deleted`;
- `create_rejects_non_page_parent`;
- `rename_rewrites_links_in_linking_items`;
- `move_rejects_cycles`;
- `delete_and_restore_whole_subtree`;
- `restore_to_root_when_parent_still_deleted`;
- `trash_lists_only_deletion_roots`;
- `save_body_refreshes_links`;
- `creating_a_page_links_earlier_mentions`: item yang sudah berisi `[[Ide baru]]` muncul di backlink halaman "Ide baru" begitu halaman itu dibuat;
- `export_writes_folder_notes_and_unique_names`: tempdir; judul `../x` dan dua judul "A" menghasilkan `A.md` dan `A (2).md`.

**Commit:** `feat: add the page tree`.

### Task 3: Pencarian, command, dan tipe API

**Files:**
- Create: `src-tauri/src/search.rs`.
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src/api.ts`.

**Antarmuka:**

```rust
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct SearchHit { #[serde(flatten)] pub item: ItemSummary, pub snippet: String }
pub fn fts_query(text: &str) -> Option<String>   // "rencana besok" -> "\"rencana\" \"besok\"*"; kosong -> None; tanda kutip dibuang
pub fn search(conn, text: &str, pages_only: bool, limit: usize) -> Result<Vec<SearchHit>, AppError>
// ORDER BY bm25(items_fts, 0.0, 5.0, 1.0). snippet(items_fts, 2, '\u{2}', '\u{3}', '…', 12).
// Kalau isi tidak cocok, snippet berisi 80 karakter pertama isi.
```

**Command:** pakai nama persis ini, dan `src/api.ts` mendapat pemanggil camelCase yang sama.
- `pages_tree() -> Vec<PageNode>`;
- `create_page(parentId: Option<String>, title: String) -> PageNode`;
- `rename_page(id, title) -> PageNode`;
- `move_page(id, parentId: Option<String>) -> PageNode`;
- `save_page_body(id, body) -> ()`;
- `delete_page(id) -> ()`;
- `pages_trash() -> Vec<TrashEntry>`;
- `restore_page(id) -> PageNode`;
- `page_backlinks(id) -> Vec<ItemSummary>`;
- `resolve_link(title) -> Option<ItemSummary>`;
- `search_items(text, pagesOnly: bool, limit: u32) -> Vec<SearchHit>`;
- `export_pages() -> String`: root = XDG Dokumen lewat `files::xdg_dir(home, user_dirs, "XDG_DOCUMENTS_DIR", "Documents")`;
- `open_link(url) -> ()`: hanya `http://` dan `https://`. Selain itu `Invalid`. Dibuka lewat `app.opener().open_url`.

**Tipe di `src/api.ts`:** `PageNode`, `TrashEntry`, `SearchHit` (`ItemSummary & { snippet: string }`).

**Test:**
- `fts_query_quotes_words_and_prefixes_the_last`;
- `search_ranks_titles_and_skips_deleted`;
- `search_matches_without_diacritics`;
- `search_pages_only`;
- `open_link` menolak `file:///etc/passwd` dan `javascript:` (uji fungsi validasinya, `pub fn check_link(url) -> Result<(), AppError>`).
- Lalu jalankan `cargo test`, clippy, `bun run typecheck`, `bun run test`, dan E2E penuh sampai `PASS`.

**Commit:** `feat: expose notes and search commands`.
**Penutup PR 4B-1.**

---

# PR 4B-2

### Task 4: Model blok (`src/notes/blocks.ts`)

**Antarmuka:**

```ts
export type BlockKind = "paragraph" | "heading1" | "heading2" | "heading3" | "bullet" | "numbered" | "todo" | "quote" | "code";
export interface Block { readonly id: number; readonly text: string }      // id lokal dari counter, bukan Math.random
export function splitBlocks(body: string): Block[]       // baris kosong memisah; ``` fence utuh; body kosong -> [] 
export function joinBlocks(blocks: readonly Block[]): string               // teks dipisah "\n\n", tanpa blok kosong di akhir
export function blockKind(text: string): BlockKind       // dari baris pertama
export function enterAt(text: string, caret: number): { before: string; after: string | null; caret: number }
// Paragraf, judul, kutipan: pecah blok -> after = sisa teks (penanda judul tidak ikut).
// Daftar/tugas/bernomor: after = null, before = teks + "\n" + penanda berikutnya; baris daftar kosong -> hapus baris, after = "".
// Kode: after = null, sisipkan "\n".
export function setKind(text: string, kind: BlockKind): string   // ganti penanda baris pertama (untuk menu "/")
export function toggleTodo(text: string, line: number): string   // "[ ]" <-> "[x]" pada baris ke-line
export function linkQuery(text: string, caret: number): string | null  // teks setelah "[[" yang belum ditutup sebelum caret
export function insertLink(text: string, caret: number, title: string): { text: string; caret: number }
```

**Test (`blocks.test.ts`):**
- `splitBlocks` dan `joinBlocks` bolak-balik untuk contoh campuran, termasuk blok kode dengan baris kosong di dalamnya;
- `blockKind` untuk semua jenis;
- `enterAt` untuk setiap jenis, termasuk nomor bertambah (`2. ` → `3. `) dan baris daftar kosong;
- `setKind` dari dan ke setiap jenis;
- `toggleTodo`;
- `linkQuery` dengan `[[` yang tertutup dan terbuka;
- `insertLink` menutup dengan `]]` dan menaruh caret setelahnya.

**Commit:** `feat: add the Markdown block model`.

### Task 5: Renderer (`src/notes/markdown.tsx`)

**Antarmuka:**

```tsx
export interface LinkTarget { readonly title: string; readonly resolved: boolean }
export function inlineTokens(text: string): InlineToken[]   // pure: text | bold | italic | code | link(href) | wikilink(title, alias)
export function BlockPreview(props: Readonly<{
  text: string;
  isResolved: (title: string) => boolean;
  onOpenLink: (title: string) => void;      // wikilink
  onOpenUrl: (href: string) => void;        // tautan http(s); NotesPage meneruskan ke api.openLink
  onToggleTodo: (line: number) => void;
}>): JSX.Element
```

**Aturan:**
- Tautan Markdown dengan `href` selain `http(s)://` dirender sebagai teks biasa.
- Tautan http dibuka lewat prop `onOpenUrl`, jadi renderer tidak memanggil `api` dan bisa dikerjakan sebelum PR 4B-1 selesai.
- Klik link dan checkbox memanggil `stopPropagation` supaya blok tidak masuk mode edit.
- Judul `#` dirender sebagai `h2` dengan kelas ukuran H2 karena H1 dipakai judul halaman, `##` sebagai `h3`, dan `###` sebagai `h4`.

**Test (`markdown.test.tsx`, `renderToStaticMarkup`):**
- token inline untuk tebal, miring, kode, tautan, wikilink dengan alias, serta teks tanpa penutup;
- `javascript:` tidak menjadi `<a>`;
- daftar tugas merender `input type="checkbox"` dengan `checked`;
- blok kode merender `<pre>` dan menampilkan `[[x]]` di dalamnya sebagai teks;
- wikilink tanpa tujuan mendapat kelas garis putus.

**Commit:** `feat: render Markdown blocks`.

### Task 6: `BlockEditor.tsx`

**Antarmuka:**

```tsx
export function BlockEditor(props: Readonly<{
  pageId: string;
  body: string;
  titles: readonly string[];                       // judul halaman untuk saran [[ dan isResolved
  onChange: (body: string) => void;                // dipanggil setiap edit; debounce simpan di NotesPage
  onOpenLink: (title: string) => void;
  onOpenUrl: (href: string) => void;
  onCreatePage: (title: string) => Promise<void>;  // pilihan "Buat halaman" di saran [[
}>): JSX.Element
```

**Perilaku:** spec §5 "Editor blok", lengkap:
- satu blok aktif berupa textarea dengan tinggi otomatis;
- pratinjau berupa `role="button"` dan `tabIndex={0}`, dan Enter atau Space mengaktifkan blok;
- Enter, Shift+Enter, dan Backspace di awal blok (hapus atau gabung) memakai fungsi di `blocks.ts`;
- panah atas dan bawah di tepi blok pindah blok;
- Esc keluar dari mode edit;
- menu `/` dengan 9 pilihan, disaring sambil mengetik;
- saran `[[` (maksimal 8, plus "Buat halaman \"…\"");
- body kosong menampilkan satu paragraf kosong dengan placeholder "Ketik / untuk jenis blok, [[ untuk menautkan".

**Test (`BlockEditor.test.tsx`, `renderToStaticMarkup`):**
- body kosong menampilkan placeholder;
- body dengan judul, daftar, dan kode merender tiga pratinjau dengan `role="button"`.

Logika tombol sudah diuji di Task 4.
- Jalankan `bun run typecheck` dan `bun run test`.

**Commit:** `feat: add the block editor`.
**Penutup PR 4B-2:** belum ada halaman yang memakai editor. E2E penuh tetap harus `PASS`.

---

# PR 4B-3

### Task 7: Halaman Catatan

**Files:**
- Create: `src/notes/NotesPage.tsx`, `src/notes/PageTree.tsx`, `src/notes/Backlinks.tsx`, `src/notes/TrashDialog.tsx`, `src/notes/MoveDialog.tsx`, `src/notes/view.ts` + `view.test.ts`.
- Modify: `src/shell/nav.ts`, `src/App.tsx`, `src/item/ItemPage.tsx` (kalau perlu).

**`view.ts` (fungsi murni dan test):**
- `buildTree(nodes) -> TreeNode[]` (anak urut judul);
- `breadcrumb(nodes, id) -> PageNode[]`;
- `descendantIds(nodes, id) -> Set<string>`, untuk menyaring tujuan di MoveDialog;
- `snippetParts(snippet) -> { text: string; mark: boolean }[]`, untuk memecah penanda `\u0002…\u0003`.

**Perilaku:** spec §5.
- **Nav:** `{ id: "catatan", label: "Catatan" }` tepat setelah Jurnal, dengan ikon halaman.
- **`App.tsx`:**
  - page `{ name: "catatan", id?: string }`;
  - `openItem(id)` memanggil `api.openItem(id)` lalu, kalau `item.type === "page"`, membuka `{ name: "catatan", id }`; selain itu tetap halaman item (C15);
  - `onReveal` dari ekspor membuka Berkas di folder ekspor (prop `initialPath` sudah ada).
- **NotesPage:**
  - memuat `pagesTree` sekali, lalu memuat ulang setelah setiap aksi pohon;
  - halaman aktif memuat isi lewat `api.openItem(id)`;
  - simpan isi dengan debounce 600 ms, dan langsung saat ganti halaman atau unmount (C16);
  - ganti judul lewat `renamePage` saat blur atau Enter;
  - backlink dimuat ulang setelah simpan;
  - kotak cari memanggil `api.searchItems(text, true, 20)` (C13);
  - klik wikilink memanggil `api.resolveLink(title)`: kalau ada tujuannya, panggil `onOpenItem(id)`; kalau tidak, panggil `api.createPage(null, title)` lalu buka halaman itu.
- **Dialog:** pakai komponen `src/shell/Dialog.tsx` yang sudah ada.
- **Hapus:** wajib konfirmasi "Hapus \"Judul\" dan n subhalaman?".

**Test:** `view.test.ts` untuk keempat fungsi.
**Commit:** `feat: add the Catatan page`.

### Task 8: Pencarian di command palette

**Files:**
- Modify: `src/palette/CommandPalette.tsx`, `src/palette/results.ts` + `results.test.ts`.

**Perilaku:** spec §5 "Command palette".
- Teks yang diketik juga memanggil `api.searchItems(text, false, 8)` dengan debounce 150 ms, dan respons lama dibuang (bandingkan nomor permintaan).
- Hasilnya tampil di grup "Item" setelah perintah.
- Enter atau klik memanggil `onOpenItem(id)`, yang mengikuti C15 lewat `App.openItem`.
- Cuplikan memakai `snippetParts` dari `src/notes/view.ts`.

**Test:** `results.test.ts`: penggabungan grup perintah dan item, serta navigasi panah melewati batas grup.
**Commit:** `feat: search items from the command palette`.

### Task 9: E2E, versi 0.9.0, penutup (dikerjakan sesi Opus)

- **Koordinat nav:** Catatan di `y=202` menggeser semua menu setelah Jurnal sebanyak +54. Sesuaikan semua `click 36 <y>` di `scripts/e2e-smoke.sh`:
  - Email 202→256, Jadwal 256→310, Habit 310→364, Keuangan 364→418;
  - Proyek 418→472, Berkas 472→526, Unduhan 524→580.
  - Bel, Profil, dan Pengaturan di bawah tidak berubah.
  - Sesuaikan juga daftar y di `check_nav`.
- **`check_notes`:** alur spec §6 E2E, memakai HOME sementara untuk ekspor.
- **Versi:** 0.9.0 di `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, dan `Cargo.lock`.
- **`CLAUDE.md`:** status diperbarui.

**Commit:** `test: cover notes end to end; bump version to 0.9.0`.
**Penutup PR 4B-3**, lalu rilis "Anchoa v0.9.0 — Catatan".
