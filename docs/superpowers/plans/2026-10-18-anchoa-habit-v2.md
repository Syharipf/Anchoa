# Anchoa — Rencana Implementasi: Habit v2

Spesifikasi: `docs/superpowers/specs/2026-10-18-anchoa-habit-v2-design.md`
Cabang: `feat/habit-upgrade`

## Task 1: Backend Rust Metadata & Check Date (habits.rs & commands.rs)
- Definisikan `HabitMeta`: `{ category, icon, target_days, archived }`.
- Tambahkan field tersebut ke `HabitRow` dan `HabitInput`.
- Di `save_habit`, serialize `HabitMeta` ke `items.body`.
- Di `get_habit_row` dan `habits_overview`, parse `i.body` sebagai `HabitMeta`.
- Tambahkan fungsi `check_habit_date`: validasi `target_date == today || target_date == yesterday`.
- Expose argumen opsional `date: Option<String>` di Tauri command `check_habit`.
- Tulis unit test untuk verifikasi penyimpanan metadata dan centang kemarin.

## Task 2: Update IPC Contract & API Wrappers (src/api.ts & api.test.ts)
- Perbarui interface `HabitRow` dan `HabitInput`.
- Perbarui `api.checkHabit(id: string, done: boolean, date?: string)`.

## Task 3: Komponen Motivasi & Perayaan (DailyQuote.tsx & HabitCelebration.tsx)
- Buat `DailyQuote.tsx`: kurasi 15+ kutipan motivasi kebiasaan & disiplin dengan pergantian harian otomatis.
- Buat `HabitCelebration.tsx`: animasi visual saat semua habit hari ini selesai (`todayDone === todayTotal`).

## Task 4: Perkaya Form & Detail (HabitForm.tsx & HabitDetail.tsx)
- Di `HabitForm.tsx`: pilih kategori, picker emoji ikon, input target tantangan (targetDays), dan sakelar arsip.
- Di `HabitDetail.tsx`: tampilkan kartu target challenge progres, sakelar arsip, dan tombol centang kemarin.

## Task 5: Daftar Harian & Filter Tab (TodayList.tsx & HabitsPage.tsx)
- Tambahkan tab filter: `Semua` | `Belum` | `Arsip`.
- Tampilkan badge kategori, ikon emoji, dan opsi "Centang Kemarin" pada baris habit yang kemarin terlewat.
- Integrasikan `DailyQuote` di atas ringkasan metrik.

## Task 6: Verifikasi & Test Suite (@advisor)
- `cargo test habits` & `cargo clippy`.
- `bun test src/habits`, `bun run test`, `bun run typecheck`.
- Build release binary ke `/usr/bin/anchoa`.
