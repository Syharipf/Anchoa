# Anchoa Fase 3B (Jadwal): Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementasi oleh task role `Coder` (satu task per run). Review oleh task role `reviewer`.

**Goal:** Halaman Jadwal: kalender bulanan dengan panel agenda, dan timeline 8 minggu, untuk tugas dan tagihan.

**Architecture:**
- Satu modul Rust baru, `schedule.rs`, menggabungkan tugas (`tasks`/`projects` dari 3A) dan tagihan (`bills.rs`) untuk satu rentang tanggal lokal. Proyeksi tagihan bulanan memakai `time::next_month_due`.
- Frontend untuk halaman ini ada di `src/schedule/`. Semua perhitungan tata letak (grid bulan, chip per sel, grup agenda, posisi batang) ada di fungsi murni `src/schedule/layout.ts` yang dites.

**Spec:** `docs/superpowers/specs/2026-09-30-anchoa-fase3b-jadwal-design.md`. Bacalah seluruhnya sebelum task pertama.

**Bentuk rencana ini:** sama seperti rencana 3A. Rencana ini berisi antarmuka, aturan, dan test wajib, tanpa kode implementasi lengkap. Kerjakan TDD dengan satu commit per task, dan ikuti pola kode yang sudah ada.

## Global Constraints

- Semua Global Constraints rencana Fase 2 dan 3A berlaku.
- Warna jenis: tambahkan token `--color-cat-project: #3987e5`, `--color-cat-bill: #c98500`, `--color-cat-personal: #d55181` di `@theme` `src/index.css`. `--color-warn` yang sudah ada boleh dipakai untuk tagihan kalau nilainya sama.
- Tanggal lokal di antarmuka Rust–TS berupa string `YYYY-MM-DD`. Frontend hanya membuat string itu dari `Date` lokal untuk navigasi, dan tidak pernah menghitung "hari ini" untuk logika terlambat. Nilai itu datang dari `Schedule.today` dan `overdue`.
- Nama rilis: "Anchoa v0.4.0 — Jadwal".

## Menjalankan task

Sama seperti rencana 3A, dengan nama file rencana ini.

## Pembagian PR

| PR | Branch | Task |
|---|---|---|
| 3B-1 | `feat/<N1>-f3b-1-schedule-backend` | 1 |
| 3B-2 | `feat/<N2>-f3b-2-calendar` | 2–4 |
| 3B-3 | `feat/<N3>-f3b-3-timeline` | 5–6 |

---

# PR 3B-1

### Task 1: `schedule.rs` dan command

**Files:**
- Create `src-tauri/src/schedule.rs`.
- Modify `src-tauri/src/lib.rs` dan `src-tauri/src/commands.rs` (command `schedule(range: ScheduleRange)`).
- Modify `src/api.ts` (tipe dan `api.schedule(from, to)`).

**Antarmuka:**

```rust
pub struct ScheduleRange { from: String, to: String }             // Deserialize, camelCase
#[serde(rename_all = "lowercase")] pub enum ItemSource { Task, Bill }
#[serde(rename_all = "lowercase")] pub enum ItemKind { Project, Bill, Personal }
pub struct ScheduleItem { key, source: ItemSource, id, kind: ItemKind, title, group_id, group_name,
                          start_date: Option<String>, due_date: String, status: TaskStatus, overdue: bool, checkable: bool }
pub struct ProjectDeadline { project_id, name, date: String }
pub struct Schedule { today: String, items: Vec<ScheduleItem>, deadlines: Vec<ProjectDeadline> }
pub fn schedule(conn, &ScheduleRange, now, tz) -> Result<Schedule, AppError>
```

Tagihan memakai `TaskStatus::Done` untuk `paidToday` dan `Plan` untuk yang lain. `items` diurutkan menurut `due_date`, lalu `kind`, lalu judul.

**Test** (`schedule::tests`), dengan "sekarang" = `finance::testing::now()`:
- `tasks_get_kind_group_and_dates`: tugas proyek → `project` dan nama proyek; tugas lepas → `personal`/"Pribadi"; `start_date` dan `due_date` sebagai tanggal lokal.
- `range_keeps_overlapping_and_late_items`: tugas di luar rentang tidak ikut; tugas terlambat sebelum `from` ikut dengan `overdue`; tugas `done` di dalam rentang ikut dengan status `done`.
- `monthly_bills_are_projected`:
  - tagihan bulanan dengan `due_day` 31, rentang Jan–Mar 2027: jatuh tempo tersimpan `checkable`, dan proyeksi 28 Feb serta 31 Mar tidak;
  - tagihan sekali tidak diproyeksikan.
- `paid_today_bill_is_done`
- `project_deadlines_in_range`
- `deleted_items_are_left_out`
- `range_is_validated`: `from` > `to`, rentang lebih dari 93 hari, dan `"2026-9-1"` ditolak.

**Commit:** `feat: add the schedule of tasks and bills for a date range`.
**Penutup PR 3B-1.**

---

# PR 3B-2

### Task 2: Tata letak kalender dan agenda (fungsi murni)

**Files:** Create `src/schedule/layout.ts`, `src/schedule/layout.test.ts`.

**Antarmuka:**
- `monthGrid(month: "YYYY-MM") -> { date: string; inMonth: boolean }[][]`: minggu Senin-pertama, dengan 5 atau 6 baris.
- `chipsFor(items, date, rows: 5 | 6) -> { shown: ScheduleItem[]; more: number }`: maksimal 3 chip, atau 2 kalau 6 baris.
- `agendaGroups(items, selected: string, today: string) -> { late: ScheduleItem[]; due: ScheduleItem[]; next: ScheduleItem[] }`:
  - `late` berisi `overdue`, di luar item yang tenggatnya tepat di tanggal terpilih;
  - `due` berisi item bertenggat di tanggal terpilih;
  - `next` berisi item dalam 7 hari setelah tanggal terpilih.
- `visible(items, off: Set<ItemKind>)`
- `monthLabel` dan `addMonths`: pakai ulang dari `src/money.ts`. Kalau perlu, pindahkan helper bulan ke `src/dates.ts` dan perbarui import Fase 2. Refactor ini boleh, asal test tetap lulus.
- `agendaTitle(date) -> "Rabu, 30 September"`

**Test:**
- September 2026 dimulai Senin 31 Agustus dan punya 5 baris;
- November 2026 punya 6 baris;
- `chipsFor` memberi `more` yang benar;
- setiap grup agenda;
- filter.

**Commit:** `feat: add calendar and agenda layout rules`.

### Task 3: Halaman Jadwal, kalender, dan agenda

**Files:**
- Create di `src/schedule/`:
  - `SchedulePage.tsx`: state tampilan, periode, filter, pemuatan `schedule`;
  - `ScheduleHeader.tsx`;
  - `CalendarView.tsx`;
  - `AgendaPanel.tsx`.
- Modify `src/App.tsx`: `page.name === "jadwal"`, dengan `onOpenItem`, `onOpenFinance`, `onChanged`.
- Modify `src/shell/nav.ts`: Jadwal tanpa `fase` dan `about`.
- Modify `src/index.css`: token warna jenis.

**Perilaku:**
- spec §4 "Header", "Kalender", "Panel agenda";
- rentang yang dimuat untuk kalender = tanggal pertama sampai terakhir di grid;
- mencentang tugas memanggil `updateTask`; mencentang tagihan memanggil `payBill` lalu menampilkan toast "Tercatat Rp x";
- setelah centang: muat ulang, lalu `onChanged`;
- filter disimpan di `localStorage` dengan key `anchoa.schedule.off`, dengan try/catch.

**Test:** typecheck dan `bun run test`.
**Commit:** `feat: add the Jadwal page with calendar and agenda`.

### Task 4: E2E kalender

**Files:** `scripts/e2e-smoke.sh`: fungsi `check_schedule`, ditambahkan ke daftar pemanggilan.

Alur:
1. buat tugas bertenggat hari ini lewat palette "Buat tugas", lalu set `due_at` hari ini lewat SQL;
2. buat tagihan lewat SQL, dengan pola `check_bills` atau `add_account` dan formulir tagihan;
3. nav Jadwal (y=256), lalu screenshot `13-calendar`;
4. klik sel hari ini, lalu screenshot `13-agenda`;
5. centang tugas di agenda, lalu cek DB `status = 'done'`;
6. matikan filter Tagihan, lalu screenshot `13-filter`.

Koordinat diukur dari screenshot build ini.

**Commit:** `test: cover the calendar and agenda end to end`.
**Penutup PR 3B-2.**

---

# PR 3B-3

### Task 5: Timeline

**Files:**
- Modify `src/schedule/layout.ts` dan `layout.test.ts`:
  - `timelineWindow(today, shiftWeeks) -> { from, to, days: string[] }`: 8 minggu, mulai Senin minggu lalu;
  - `barFor(item, window) -> { left, width }` dalam px, dengan 16px per hari dan dipotong ke tepi jendela;
  - `timelineGroups(items, deadlines) -> { id, name, kind, items }[]`: urutan sesuai spec §4.
- Create `src/schedule/TimelineView.tsx`.
- Modify `SchedulePage.tsx` untuk toggle dan navigasi 4 minggu.

**Test:**
- awal jendela untuk hari Selasa 29 Sep 2026 = Senin 21 Sep;
- lebar dan posisi batang, termasuk yang terpotong di tepi;
- urutan grup.

**Commit:** `feat: add the eight-week timeline`.

### Task 6: E2E timeline, versi 0.4.0, penutup

**Files:**
- `scripts/e2e-smoke.sh`: perluas `check_schedule`. Toggle Timeline, screenshot `13-timeline`, lalu klik batang tugas dan pastikan halaman item terbuka (lewat judul di screenshot).
- Versi 0.4.0 di `package.json`, `Cargo.toml`, `Cargo.lock`, `tauri.conf.json`, dan README.
- `CLAUDE.md` Status: "Fase 3 (Proyek, tugas, Jadwal) is built; next is Fase 4 (Catatan)".

**Commit:** `test: cover the timeline end to end; bump version to 0.4.0`.
**Penutup PR 3B-3**, lalu rilis "Anchoa v0.4.0 — Jadwal".
