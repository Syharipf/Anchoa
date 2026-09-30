# Anchoa Fase 4 (Jurnal): Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Kode ditulis oleh Gemini 3.8 Flash High lewat `agy-multi`, lalu dicek sesi Opus.

**Goal:** Halaman Jurnal menggantikan Inbox: entri Ide/Curhat/Catatan dengan suasana hati dan tag, tren 30 hari, pemantik, "Jadikan tugas", dan centang otomatis habit.

**Architecture:**
- Satu modul Rust baru, `journal.rs`, dengan migrasi `007_journal.sql`. Entri adalah catatan yang sudah ada, dengan tabel ekstensi opsional (spec N1).
- Frontend untuk halaman ini ada di `src/journal/`, dengan aturan tampilan di `src/journal/view.ts`. `src/inbox/Inbox.tsx` dihapus setelah halaman Jurnal menggantikannya.

**Spec:** `docs/superpowers/specs/2026-10-01-anchoa-fase4-jurnal-design.md`.

**Bentuk rencana:** sama seperti rencana Fase 3. Rencana ini berisi antarmuka, aturan, dan test wajib; kerjakan TDD dengan satu commit per task. Stage path secara eksplisit.

## Global Constraints

- Semua Global Constraints rencana sebelumnya berlaku.
- **Aturan SonarCloud** (quality gate gagal di PR #59 karena hal-hal ini):
  - tidak ada JSX yang diulang (duplikasi kode baru maksimal 3%), jadi ekstrak komponen baris;
  - tidak ada ternary bertingkat;
  - props selalu `Readonly<...>`;
  - pakai `<fieldset>` dengan `<legend>`, bukan `role="group"`;
  - tidak ada elemen blok di dalam `<button>`;
  - di test, pakai `toHaveLength`.
- Nama rilis: "Anchoa v0.6.0 — Jurnal".

## Pembagian PR

| PR | Branch | Task |
|---|---|---|
| 4-1 | `feat/<N1>-f4-1-journal-backend` | 1–2 |
| 4-2 | `feat/<N2>-f4-2-journal-page` | 3–5 |

---

# PR 4-1

### Task 1: Migrasi 007 dan `journal.rs`

**Files:**
- Create `src-tauri/migrations/007_journal.sql` (persis dari spec §3) dan `src-tauri/src/journal.rs`.
- Modify:
  - `db.rs` (migrasi dan test `version_6_database_upgrades_to_journal_schema`);
  - `lib.rs`;
  - `habits.rs` (`auto_journal` di `HabitRow`/`HabitInput`, dan fungsi `auto_check_journal(conn, now, tz)`);
  - `items.rs` (`update` memanggil `journal::after_note_saved` untuk catatan, atau pemanggilan itu dilakukan di command `update_item`; pilih yang lebih bersih dan jelaskan di komentar);
  - `scripts/e2e-smoke.sh` (`user_version` 7).

**Antarmuka:**

```rust
#[serde(rename_all = "lowercase")] pub enum EntryKind { Idea, Vent, Note }   // ToSql/FromSql, default Note
pub struct EntrySummary { id, kind, title, preview, mood: Option<i8>, created_at, time: String }
pub struct Entry { id, kind, title, body, mood: Option<i8>, tags: Vec<String>, created_at, when: String, task_id: Option<String> }
pub struct Group { key: String, label: String, entries: Vec<EntrySummary> }
pub struct ListQuery { query: Option<String>, kind: Option<EntryKind> }
pub struct EntryPatch { kind: Option<EntryKind>, mood: Option<Option<i8>>, tags: Option<String> }   // pola present
pub struct TrendDay { date: String, mood: Option<i8>, wrote: bool }
pub struct Side { trend: Vec<TrendDay>, write_days: i64, ideas: Vec<EntrySummary> }
pub fn journal_list(conn, &ListQuery, now, tz) -> Result<Vec<Group>, AppError>
pub fn journal_entry(conn, id, now, tz) -> Result<Entry, AppError>
pub fn create_entry(conn, kind, title: Option<&str>, now, tz) -> Result<Entry, AppError>
pub fn update_entry(conn, id, &EntryPatch, now, tz) -> Result<Entry, AppError>
pub fn entry_to_task(conn, id, now, tz) -> Result<Entry, AppError>
pub fn journal_side(conn, now, tz) -> Result<Side, AppError>
pub fn after_note_saved(conn, id, now, tz) -> Result<(), AppError>   // centang otomatis habit (N10)
```

- Label waktu: `time` berisi "21.10" untuk hari ini, "Sen 22.05" untuk 6 hari terakhir, atau "29 Sep" untuk yang lebih lama. `when` berisi "Selasa, 29 Sep · 21.10".
- Nama hari dan bulan Indonesia ada di helper Rust kecil di `time.rs`, yang boleh dipakai ulang.

**Test** (`journal::tests`):
- `old_notes_are_journal_notes`
- `groups_follow_local_days`: hari ini, kemarin, 7 hari terakhir, dan bulan sebelumnya.
- `search_and_kind_filter`: tidak membedakan huruf besar-kecil, di judul dan di isi.
- `update_entry_validates_and_normalises_tags`: "#Anchoa  kuliah" menjadi `["anchoa", "kuliah"]`, "a b!" ditolak, dan mood 0 atau 6 ditolak.
- `entry_to_task_once_for_ideas`
- `trend_averages_mood_per_day`
- `ideas_leave_out_those_with_tasks`
- `saving_a_note_checks_journal_habits`: isi kosong tidak mencentang; hari libur tidak mencentang; habit tanpa `auto_journal` tidak tercentang.
- `time_and_when_labels`

**Commit:** `feat: add journal entries with kind, mood, tags and trend`.

### Task 2: Command dan tipe API

**Files:** `commands.rs`, `lib.rs` (6 command dari spec §4), dan `src/api.ts` (tipe, pemanggil, `HabitRow.autoJournal`, `HabitInput.autoJournal`).
**Test:** `cargo test`, clippy, typecheck, `bun run test`, dan E2E `PASS`.
**Commit:** `feat: expose journal commands`.
**Penutup PR 4-1.**

---

# PR 4-2

### Task 3: Aturan tampilan

`src/journal/view.ts` dan `view.test.ts`:
- `KIND_META: Record<EntryKind, { label, icon }>`, dengan path ikon dari artboard;
- `MOODS`: Berat, Kurang, Biasa, Baik, Senang;
- `moodBars(mood)`;
- `PROMPTS` (8 pertanyaan: tiga dari artboard, ditambah lima dengan nada yang sama);
- `nextPrompt(i)`;
- `parseTag(text)`;
- `tagsToText(tags)`.

**Commit:** `feat: add journal display rules`.

### Task 4: Halaman Jurnal menggantikan Inbox

**Files:**
- Create di `src/journal/`: `JournalPage.tsx`, `EntryList.tsx`, `EntryEditor.tsx` (autosave judul dan isi lewat `updateItem`, sisanya lewat `updateEntry`), `TagInput.tsx`, `MoodPicker.tsx`, dan `JournalSide.tsx`.
- Modify:
  - `src/shell/nav.ts`: `inbox` diganti `jurnal`, dengan label "Jurnal" dan ikon buku dari artboard `Main.dc.html`;
  - `src/shell/Sidebar.tsx`: hapus titik Inbox;
  - `src/App.tsx`;
  - `src/palette/results.ts` dan test-nya: "Simpan ke Jurnal";
  - `src/palette/CommandPalette.tsx`: toast "Tersimpan ke Jurnal";
  - `src/habits/HabitForm.tsx`: checkbox `autoJournal`.
- Hapus `src/inbox/Inbox.tsx` kalau tidak dipakai lagi.

**Perilaku:** spec §5.
**Test:** typecheck dan `bun run test`.
**Commit:** `feat: replace Inbox with the Jurnal page`.

### Task 5: E2E, versi 0.6.0, penutup

- **`scripts/e2e-smoke.sh`:**
  - check yang membuka Inbox (`click 36 148`) sekarang membuka Jurnal. Sesuaikan koordinat baris pertama dan halaman item, karena entri Jurnal dibuka di editor tengah, bukan di halaman item;
  - tambah `check_journal` dengan alur spec §6 E2E;
  - screenshot `15-journal`.
- **Versi 0.6.0** dan Status di `CLAUDE.md`.

**Commit:** `test: cover the journal end to end; bump version to 0.6.0`.
**Penutup PR 4-2**, lalu rilis "Anchoa v0.6.0 — Jurnal".
