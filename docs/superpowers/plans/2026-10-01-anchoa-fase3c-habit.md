# Anchoa Fase 3C (Habit): Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Kode ditulis oleh Gemini 3.8 Flash High lewat `agy-multi`, lalu dicek sesi Opus.

**Goal:** Menu Habit: kebiasaan dengan hari aktif, centang harian, streak, konsistensi, riwayat bulanan, dan pengingat di panel notifikasi.

**Architecture:**
- Satu modul Rust baru, `habits.rs`, memakai migrasi `006_habits.sql`. Semua perhitungan status hari, streak, dan persen ada di fungsi murni yang menerima daftar tanggal centang, jadi mudah dites.
- Frontend untuk halaman ini ada di `src/habits/`. Label dan warna ada di `src/habits/view.ts`.

**Spec:** `docs/superpowers/specs/2026-10-01-anchoa-fase3c-habit-design.md`. Bacalah seluruhnya dulu.

**Bentuk rencana:** sama seperti rencana 3A dan 3B. Rencana ini berisi antarmuka, aturan, dan test wajib. Kerjakan TDD, satu commit per task, dan ikuti pola kode yang sudah ada. Stage path secara eksplisit; jangan `git add -A` atau `git commit -a`.

## Global Constraints

- Semua Global Constraints rencana Fase 2, 3A, dan 3B berlaku.
- Tanggal lokal di antarmuka Rust–TS berupa string `YYYY-MM-DD`. "Hari ini" selalu datang dari backend.
- Nama rilis: "Anchoa v0.5.0 — Habit".

## Pembagian PR

| PR | Branch | Task |
|---|---|---|
| 3C-1 | `feat/<N1>-f3c-1-habits-backend` | 1–2 |
| 3C-2 | `feat/<N2>-f3c-2-habits-page` | 3–5 |

---

# PR 3C-1

### Task 1: Migrasi 006 dan logika habit

**Files:**
- Create `src-tauri/migrations/006_habits.sql` (isi persis dari spec §3).
- Create `src-tauri/src/habits.rs`.
- Modify `src-tauri/src/db.rs` (`MIGRATIONS`, test `version_5_database_upgrades_to_habits_schema`), `src-tauri/src/lib.rs`, `scripts/e2e-smoke.sh` (`user_version` 6).

**Antarmuka:**

```rust
#[serde(rename_all = "lowercase")] pub enum DayState { Blank, Future, Off, Done, Todo, Miss }
pub fn scheduled(days: u8, date: jiff::civil::Date) -> bool                 // bit 0 = Senin
pub fn day_state(date, today, created: Date, days: u8, checked: &HashSet<Date>) -> DayState
pub fn current_streak(today, created, days, checked) -> i64
pub fn best_streak(today, created, days, checked) -> i64
pub fn rate30(today, created, days, checked) -> (done: i64, scheduled: i64)
pub struct HabitRow { id, name, days: u8, remind_at: Option<String>, remind_on: bool, scheduled_today: bool,
                      done_today: bool, streak: i64, best: i64, rate30: i64, week: Vec<DayState>, created_at: i64 }
pub struct HabitInput { id: Option<String>, name: String, days: u8, remind_at: Option<String>, remind_on: bool }
pub struct Overview { today: String, today_done: i64, today_total: i64, top_streak: Option<TopStreak>,
                      consistency: Consistency, habits: Vec<HabitRow> }
pub struct HistoryCell { date: String, day: i8, state: DayState }
pub struct History { month: String, cells: Vec<HistoryCell> }
pub fn habits_overview(conn, now, tz) -> Result<Overview, AppError>
pub fn habit_history(conn, id, month: &str, now, tz) -> Result<History, AppError>
pub fn save_habit(conn, &HabitInput, now, tz) -> Result<HabitRow, AppError>
pub fn delete_habit(conn, id, now) -> Result<(), AppError>
pub fn check_habit(conn, id, done: bool, now, tz) -> Result<HabitRow, AppError>
pub fn due_reminders(conn, now, tz) -> Result<Vec<HabitReminder>, AppError>   // { id, name, remind_at }
```

Daftar habit diurutkan menurut jam pengingat (tanpa jam di akhir), lalu nama.

**Test** (`habits::tests`, "sekarang" = Selasa 29 Sep 2026 12:00 WIB):
- `scheduled_uses_monday_first_bits`
- `day_state_covers_every_case`
- `streak_skips_days_off_and_waits_for_today`: habit Sen–Jum, dicentang Kamis dan Jumat minggu lalu serta Senin kemarin, hari ini (Selasa) belum → streak 3; setelah dicentang → 4; kalau Senin terlewat → 0 sebelum centang hari ini.
- `best_streak_scans_history`
- `rate30_ignores_days_before_creation_and_open_today`
- `overview_cards`: `todayDone`/`todayTotal`, `topStreak`, dan konsistensi gabungan.
- `check_habit_toggles_and_refuses_days_off`: centang → baris ada; batal → `deleted_at` terisi; centang lagi → `deleted_at` kosong lagi; habit yang libur hari ini → `Invalid`.
- `history_grid_is_monday_first_with_blank_and_future`
- `habit_input_is_validated`: nama kosong, `days` 0 atau 128, `remindAt` "25:00" dan "7:5".
- `due_reminders_after_the_time_only`: jam pengingat 06.30 → muncul pada 12:00; jam pengingat 18.00 → tidak muncul; sudah dicentang → tidak muncul; `remind_on` false → tidak muncul.
- `deleted_habits_are_left_out`

**Commit:** `feat: add habits with day schedule, streaks and history`.

### Task 2: Command, dashboard, dan tipe API

**Files:**
- `src-tauri/src/commands.rs` dan `lib.rs`: command `habits_overview`, `habit_history`, `save_habit`, `delete_habit`, `check_habit`.
- `src-tauri/src/dashboard.rs`: field `habit_reminders` dari `due_reminders`, dengan test.
- `src/api.ts`: tipe dan pemanggil, plus `Dashboard.habitReminders`.

**Test:** `cargo test`, clippy, typecheck, `bun run test`, dan E2E penuh `PASS`.
**Commit:** `feat: expose habit commands and habit reminders on the dashboard`.
**Penutup PR 3C-1.**

---

# PR 3C-2

### Task 3: Aturan tampilan

**Files:** Create `src/habits/view.ts`, `src/habits/view.test.ts`.

- `scheduleLabel(days)`: 127 → "Setiap hari", 31 → "Sen–Jum", 96 → "Sab–Min". Hari berurutan lain memakai "Sel–Kam"; yang tidak berurutan memakai "Sen, Rab, Jum".
- `metaLabel(row)` → "06.30 · Setiap hari", atau "Setiap hari" tanpa jam.
- `longSchedule(row)` → "Setiap hari pukul 06.30".
- `DAY_INITIALS = ["S","S","R","K","J","S","M"]`, `DAY_NAMES`, `toggleDay(days, index)` (tidak boleh menghasilkan 0).
- `STATE_STYLE: Record<DayState, string>`: kelas Tailwind untuk tiap status, mengikuti fungsi `look()` di artboard.

**Test:** semua cabang.
**Commit:** `feat: add habit display rules`.

### Task 4: Halaman Habit, nav, notifikasi, tinggi jendela

**Files:**
- Create di `src/habits/`: `HabitsPage.tsx`, `SummaryCards.tsx`, `TodayList.tsx`, `HabitDetail.tsx` (termasuk riwayat), `HabitForm.tsx` (memakai `Dialog`).
- Modify `src/shell/nav.ts`: tambah `habit` di antara `jadwal` dan `keuangan`, dengan ikon api dari artboard.
- Modify `src/shell/Sidebar.tsx` jika perlu.
- Modify `src/App.tsx`: render halaman.
- Modify `src/notifications/reminders.ts` (varian `{ kind: "habit" }` di grup Hari ini, dengan `reminderText`), `reminders.test.ts`, dan `NotifPanel.tsx` (tautan ke Habit lewat callback baru `onOpenHabits`).
- Modify `src-tauri/tauri.conf.json`: `minHeight` 720.

**Perilaku:** spec §5.
**Test:** typecheck dan `bun run test`, termasuk test baru untuk pengingat habit.
**Commit:** `feat: add the Habit page`.

### Task 5: E2E, versi 0.5.0, penutup

**Files:**
- `scripts/e2e-smoke.sh`:
  - koordinat nav bergeser, karena Habit menyisip setelah Jadwal. Perbarui semua `click 36 <y>` untuk Keuangan, Proyek, Berkas, Unduhan, dan loop `check_nav`;
  - tambah `check_habits`: "+ Habit", nama "Olahraga pagi", Enter, centang, cek DB, batal, cek `deleted_at`, lalu screenshot `14-habits`.
- Versi 0.5.0 (`package.json`, `Cargo.toml`, `Cargo.lock`, `tauri.conf.json`, README).
- `CLAUDE.md` Status.

**Commit:** `test: cover habits end to end; bump version to 0.5.0`.
**Penutup PR 3C-2**, lalu rilis "Anchoa v0.5.0 — Habit".
