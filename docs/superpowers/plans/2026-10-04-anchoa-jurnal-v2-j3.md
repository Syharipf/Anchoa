# Anchoa Jurnal v2 — J-3 Refleksi: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kalender bulanan jurnal dengan streak dan titik suasana hati, kartu kenangan "Hari ini di masa lalu" (sebulan dan setahun lalu), filter daftar per tanggal, dan tombol ringkasan mingguan oleh asisten lokal.

**Architecture:** Rust backend menghitung `journal_calendar(month)` (hari, count, average mood, streak), `journal_side` diperluas dengan field `memories`, `journal_list` mendukung filter `date: Option<String>`, dan `journal_weekly_summary` memanfaatkan model Ollama lokal peran `recap`. Frontend kolom kanan menambahkan kalender interaktif di atas Suasana 30 hari, kartu kenangan, chip filter tanggal di atas daftar entri, dan tombol "Ringkas minggu ini".

**Tech Stack:** Rust + rusqlite + jiff, React + TypeScript + Tailwind, bun test, Xvfb E2E.

**Spec:** `docs/superpowers/specs/2026-10-03-anchoa-jurnal-v2-design.md` (V8–V11, §3, §4).

## Global Constraints

- Semua aturan di `CLAUDE.md` berlaku. Frontend hanya memanggil invoke lewat `src/api.ts`.
- Soft delete: setiap query menyaring `deleted_at IS NULL`.
- Batas hari dan perhitungan tanggal dilakukan di Rust menggunakan zona waktu lokal pengguna (`jiff`).
- Command mengembalikan `Result<T, AppError>`, tanpa panic pada jalur user.
- SonarCloud: props `Readonly<...>`, elemen non-tombol dengan `onClick` butuh handler keyboard, tanpa `Math.random()`.
- Teks UI Bahasa Indonesia.
- Tanpa dependency crate/npm baru. Tanpa bump versi (rilis setelah J-4).

| PR | Task |
|---|---|
| J-3 (#142, milestone "Jurnal v2") | 1–5 |

---

### Task 1: Backend — `journal_calendar`, streak, dan filter `date` di `journal_list` (V8, V9)

**Files:**
- Modify: `src-tauri/src/journal.rs` (tambah `CalendarDay`, `CalendarView`, `journal_calendar`, field `date` di `ListQuery` dan filter tanggal di `journal_list`, fungsi hitung streak)
- Modify: `src-tauri/src/commands.rs` (tambah command `journal_calendar`)
- Modify: `src-tauri/src/lib.rs` (daftarkan `commands::journal_calendar`)

**Interfaces:**
- Produces (Rust):
  ```rust
  #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
  #[serde(rename_all = "camelCase")]
  pub struct CalendarDay {
      pub date: String,
      pub count: i64,
      pub mood: Option<i8>,
  }

  #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
  #[serde(rename_all = "camelCase")]
  pub struct CalendarView {
      pub month: String,
      pub days: Vec<CalendarDay>,
      pub current_streak: i64,
      pub best_streak: i64,
  }

  pub fn journal_calendar(conn: &Connection, month: &str, now: i64, tz: &TimeZone) -> Result<CalendarView, AppError>;
  ```
  - `ListQuery` bertambah: `pub date: Option<String>`.
  - Filter `date` mencocokkan `created_at` yang berada pada rentang hari kalender lokal `YYYY-MM-DD` tersebut.

- [ ] **Step 1: Tulis test failing di `journal.rs` untuk `journal_calendar` dan filter `date`**
- [ ] **Step 2: Implementasi `journal_calendar`, kalkulasi streak, dan filter `date` di `journal.rs`**
- [ ] **Step 3: Tambah command `journal_calendar` di `commands.rs` & `lib.rs`**
- [ ] **Step 4: Jalankan `cargo test --lib` dan pastikan lulus**

---

### Task 2: Backend — Kenangan "Hari ini di masa lalu" & Ringkasan Mingguan Asisten (V10, V11)

**Files:**
- Modify: `src-tauri/src/journal.rs` (`Side` bertambah field `memories: Vec<EntrySummary>`, logika tanggal sebulan & setahun lalu di `journal_side`, fungsi `journal_weekly_summary`)
- Modify: `src-tauri/src/commands.rs` (tambah command `journal_weekly_summary`)
- Modify: `src-tauri/src/lib.rs` (daftarkan `commands::journal_weekly_summary`)

**Interfaces:**
- Produces (Rust):
  - `Side.memories: Vec<EntrySummary>`: entri tidak terhapus dari tanggal yang sama 1 bulan lalu dan 1 tahun lalu (29 Feb -> 28 Feb di tahun non-kabisat, tanggal 31 -> hari terakhir bulan bila bulan target < 31 hari).
  - `pub fn journal_weekly_summary(conn: &Connection, endpoint: &Endpoint, now: i64, tz: &TimeZone) -> Result<Entry, AppError>`: membaca entri 7 hari terakhir (dipotong 2000 karakter per entri), memanggil LLM lokal peran `recap`, membuat halaman Catatan / entri ber-tag `ringkasan`.

- [ ] **Step 1: Tulis test failing di `journal.rs` untuk `memories` dan `weekly_summary`**
- [ ] **Step 2: Implementasi pencarian memori tanggal sebulan dan setahun lalu di `journal_side`**
- [ ] **Step 3: Implementasi `journal_weekly_summary` dengan asisten lokal peran `recap`**
- [ ] **Step 4: Daftarkan command di `commands.rs` & `lib.rs` dan verifikasi dengan `cargo test`**

---

### Task 3: Frontend API & Kalender Jurnal Interaktif dengan Titik Suasana Hati (V8, V9)

**Files:**
- Modify: `src/api.ts` (tambah tipe `CalendarDay`, `CalendarView`, `memories` di `Side`, `date` di `JournalFilter`, method `journalCalendar`, `journalWeeklySummary`)
- Modify: `src/api.test.ts` (unit test pemanggilan API baru)
- Create: `src/journal/JournalCalendar.tsx` & `src/journal/JournalCalendar.test.tsx`
- Modify: `src/journal/JournalSide.tsx` (tempatkan kalender di kolom kanan)
- Modify: `src/journal/JournalPage.tsx` (dukung klik tanggal dari kalender -> filter chip `date`)

- [ ] **Step 1: Update `src/api.ts` dan test `src/api.test.ts`**
- [ ] **Step 2: Buat komponen `JournalCalendar.tsx` dengan visual streak, navigasi bulan, dan titik suasana hati**
- [ ] **Step 3: Integrasikan `JournalCalendar` ke `JournalSide.tsx` dan hubungkan pemilihan tanggal ke `JournalPage.tsx`**
- [ ] **Step 4: Jalankan `bun run typecheck` dan `bun run test`**

---

### Task 4: Frontend — Kartu Kenangan & Tombol "Ringkas minggu ini" (V10, V11)

**Files:**
- Modify: `src/journal/JournalSide.tsx` (tampilkan kartu kenangan "Hari ini, setahun lalu / sebulan lalu", tombol "Ringkas minggu ini" dengan status loading/error)
- Modify: `src/journal/JournalSide.test.tsx` / `JournalPage.test.tsx`

- [ ] **Step 1: Tambahkan kartu kenangan (Memories) di `JournalSide.tsx`**
- [ ] **Step 2: Tambahkan tombol "Ringkas minggu ini" dengan penanganan status loading dan error Ollama**
- [ ] **Step 3: Tulis unit test untuk kartu kenangan dan ringkasan mingguan**
- [ ] **Step 4: Jalankan `bun run typecheck` dan `bun run test`**

---

### Task 5: Smoke Test E2E, Review, dan Finalisasi PR

**Files:**
- Modify: `scripts/e2e-smoke.sh` (tambah pengujian klik tanggal kalender jurnal dan kartu memori di `check_journal_v2`)

- [ ] **Step 1: Jalankan typecheck, frontend tests, cargo test, dan cargo clippy**
- [ ] **Step 2: Update dan jalankan E2E smoke test `check_journal_v2` di Xvfb**
- [ ] **Step 3: Review diff per branch (role `reviewer`)**
- [ ] **Step 4: Buka PR dengan `Closes #142`, verifikasi CI, dan merge ke `main`**
- [ ] **Step 5: Update kartu task Kanban Anchoa ke `done`**
