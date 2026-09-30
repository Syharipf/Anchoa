# Anchoa — Fase 3C: Habit

Tanggal: 2026-10-01
Status: disusun Claude saat user tidur, dari artboard `docs/design/artboards/Habit.dc.html` yang user tambahkan pada 2026-09-30. Semua keputusan di §2 diambil tanpa tanya-jawab. Ini versi awal.

## 1. Ringkasan

Menu baru **Habit** di nav, di antara Jadwal dan Keuangan. Isinya:
- daftar kebiasaan dengan jam, hari aktif (Sen–Min), dan centang hari ini;
- streak sekarang, streak terpanjang, dan persen konsisten 30 hari;
- 3 kartu ringkasan: progres hari ini, streak aktif terpanjang, dan konsistensi 30 hari;
- panel detail dengan riwayat bulanan berupa sel (selesai, terlewat, libur, hari ini);
- pengaturan pengingat (jam dan sakelar) dan hari aktif.

## 2. Keputusan tanpa tanya-jawab

| Kode | Keputusan | Alasan |
|---|---|---|
| H1 | Habit adalah item (`type = 'habit'`, `title` = nama) dengan tabel ekstensi `habits`. Centang harian disimpan di tabel `habit_checks` dengan kunci `(habit_id, date)`, dan membatalkan centang memakai soft delete. | Aturan "semua adalah item" berlaku untuk hal yang dibuat user. Centang adalah peristiwa per hari, dan kunci tanggal membuatnya aman untuk sync nanti. |
| H2 | Hari aktif disimpan sebagai bitmask: bit 0 = Senin sampai bit 6 = Minggu, dengan default 127 (setiap hari). | Satu kolom, dan mudah diubah dari 7 tombol. |
| H3 | Streak sekarang = hari terjadwal berurutan yang tercentang, berakhir hari ini kalau sudah dicentang, atau kemarin kalau belum. Hari libur tidak memutus streak. Hari ini yang belum dicentang juga tidak memutus streak. | Sama dengan logika artboard: streak baru putus kalau satu hari terjadwal lewat tanpa centang. |
| H4 | Konsisten 30 hari = hari terjadwal yang tercentang ÷ hari terjadwal, dalam 30 hari terakhir. Hari ini dihitung hanya kalau sudah dicentang, dan hari sebelum habit dibuat tidak dihitung. | Adil untuk habit baru, dan hari ini tidak menurunkan angka sebelum harinya selesai. |
| H5 | Hanya hari ini yang bisa dicentang atau dibatalkan. Riwayat hanya untuk dilihat. | Artboard tidak memberi aksi di riwayat, dan ini mencegah salah klik. |
| H6 | Pengingat disimpan (jam `HH:MM` dan sakelar). Habit terjadwal yang belum dicentang setelah jam pengingatnya lewat muncul di panel notifikasi (grup Hari ini) dan ikut dihitung di titik lonceng. Notifikasi OS ditunda. | Memakai panel yang sudah ada, tanpa scheduler latar. |
| H7 | "Catat lewat suara", frasa suara per habit, dan centang otomatis "Tulis jurnal" ditunda ke Fase 5 dan Fase Jurnal. Area frasa di panel detail tidak ditampilkan. | Butuh asisten suara dan modul Jurnal. |
| H8 | Filter daftar: "Semua" dan "Belum" (belum dicentang hari ini). | Sama dengan pesan kosong di artboard ("Tidak ada habit yang belum dicentang"). |
| H9 | Tinggi minimum jendela naik dari 680 ke 720 px, karena nav sekarang berisi 9 modul dan 3 tombol bawah. | Supaya semua tombol nav tetap muat tanpa scroll. |
| H10 | Menghapus habit adalah soft delete, dan riwayat centangnya tetap tersimpan. | Tidak ada data yang hilang permanen. |

## 3. Model data

### Migrasi `006_habits.sql`

```sql
CREATE TABLE habits (
  item_id   TEXT PRIMARY KEY REFERENCES items(id),  -- type='habit', title=nama
  days      INTEGER NOT NULL DEFAULT 127,           -- bit 0 = Senin … bit 6 = Minggu
  remind_at TEXT,                                   -- "HH:MM" waktu lokal, opsional
  remind_on INTEGER NOT NULL DEFAULT 0              -- 0/1
);

CREATE TABLE habit_checks (
  habit_id   TEXT NOT NULL REFERENCES items(id),
  date       TEXT NOT NULL,     -- "YYYY-MM-DD" lokal
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (habit_id, date)
);
```

`user_version` naik ke 6.

### Aturan

- **Status sebuah hari** untuk sebuah habit (enum `DayState`):
  - `blank` untuk hari sebelum habit dibuat;
  - `future` untuk hari setelah hari ini;
  - `off` untuk hari yang tidak terjadwal;
  - `done` untuk hari yang tercentang;
  - `todo` untuk hari ini yang terjadwal tapi belum dicentang;
  - `miss` untuk hari terjadwal yang sudah lewat tanpa centang.
- **Streak terpanjang** dihitung dari seluruh riwayat dengan aturan yang sama seperti streak sekarang (H3).
- **Kartu ringkasan:**
  - "Hari ini": habit terjadwal hari ini yang sudah dicentang ÷ semua habit terjadwal hari ini;
  - "Streak aktif terpanjang": streak sekarang terbesar, dengan nama habit-nya;
  - "Konsistensi 30 hari": jumlah tercentang ÷ jumlah terjadwal dari semua habit (H4), dengan teks bawah "n dari m hari terjadwal".
- Semua batas hari memakai tanggal lokal dan dihitung di Rust.

## 4. Command

| Command | Masukan | Keluaran |
|---|---|---|
| `habits_overview` | - | `{ today: "YYYY-MM-DD", todayDone, todayTotal, topStreak: { name, days } \| null, consistency: { percent, done, scheduled }, habits: HabitRow[] }` |
| `habit_history` | `{ id, month: "YYYY-MM" }` | `{ month, cells: { date, day, state }[] }` (grid Senin-pertama; tanggal di luar bulan berstatus `blank`) |
| `save_habit` | `{ id?, name, days, remindAt?, remindOn }` | `HabitRow` |
| `delete_habit` | `id` | `()` |
| `check_habit` | `{ id, done: bool }` (selalu untuk hari ini) | `HabitRow` |

```
HabitRow { id, name, days, remindAt, remindOn, scheduledToday, doneToday, streak, best,
           rate30 (0–100), week: DayState[7] (6 hari lalu … hari ini), createdAt }
```

**Validasi** (`Invalid`, dengan pesan Bahasa Indonesia):
- nama di-trim dan tidak boleh kosong;
- `days` antara 1 dan 127;
- `remindAt` harus berformat `HH:MM` yang valid;
- `check_habit` pada hari yang tidak terjadwal ditolak.

**Dashboard:** `get_dashboard` mendapat field `habitReminders`: habit yang terjadwal hari ini, belum dicentang, pengingatnya aktif, dan jamnya sudah lewat. Isinya `{ id, name, remindAt }[]`.

## 5. UI

Mengikuti `Habit.dc.html`, dengan warna dari token.

- **Nav:** tombol Habit di antara Jadwal dan Keuangan (y dihitung ulang). Tinggi minimum jendela di `tauri.conf.json` menjadi 720 (H9).
- **Header:**
  - "Habit", subjudul "Kebiasaan harian · Selasa, 29 September";
  - "Catat lewat suara" (nonaktif, tooltip "Hadir di Fase 5");
  - "+ Habit".
- **3 kartu:**
  - Hari ini: "n / m selesai" dengan bar segmen;
  - Streak aktif terpanjang: ikon api, jumlah hari, nama habit;
  - Konsistensi 30 hari: persen dan teks bawahnya.
- **"Centang hari ini":** filter Semua/Belum dan kepala 7 hari (inisial). Tiap baris berisi:
  - checkbox bulat (`role="checkbox"`, nonaktif untuk habit yang tidak terjadwal hari ini, dengan tooltip "Libur hari ini");
  - nama dan meta ("06.30 · Setiap hari" atau "06.30 · Sen–Jum" atau "5 hari/minggu"; tanpa jam jika kosong);
  - strip 7 sel dengan warna status;
  - streak dengan ikon api.
  Klik nama memilih habit untuk panel detail.
- **Pesan:**
  - semua sudah dicentang: "Semua habit hari ini sudah dicentang.";
  - filter Belum kosong: "Tidak ada habit yang belum dicentang.";
  - tanpa habit: "Belum ada habit" dan tombol "Buat habit".
- **Panel detail (kanan, 340px):**
  - nama, jadwal panjang ("Setiap hari pukul 06.30");
  - 3 angka: streak sekarang, terpanjang, konsisten 30 hari;
  - riwayat bulanan dengan ‹ › (tidak bisa maju melewati bulan ini, dan tidak bisa mundur melewati bulan habit dibuat), grid Sen–Min berisi sel angka tanggal, dan legenda Selesai/Terlewat/Libur;
  - pengingat: jam dan sakelar (`role="switch"`);
  - hari aktif: 7 tombol `aria-pressed`, dan paling tidak satu harus tetap aktif;
  - tombol "Ubah" (formulir: nama, jam) dan "Hapus".
- **Formulir habit:** `Dialog` dengan nama, jam pengingat (opsional, `<input type="time">`), dan hari aktif (7 tombol, default semua).
- **Panel notifikasi:** grup "Hari ini" mendapat kartu "Olahraga pagi", dengan detail "Belum dicentang · pengingat 06.30" dan tautan ke Habit.

## 6. Testing

- **Rust:**
  - migrasi v5→v6;
  - bitmask hari;
  - `DayState` untuk tiap cabang;
  - streak (dengan hari libur, hari ini belum dicentang, dan putus);
  - streak terpanjang;
  - `rate30` untuk habit baru dan habit lama;
  - kartu ringkasan;
  - `check_habit` (centang, batal, hari libur ditolak);
  - riwayat bulan (grid, `blank` sebelum habit dibuat, `future`);
  - validasi;
  - pengingat di dashboard (sebelum dan sesudah jamnya).
- **Frontend:** label jadwal ("Setiap hari", "Sen–Jum", "5 hari/minggu", "Sen, Rab, Jum"), bit hari, dan warna sel.
- **E2E:**
  - buat habit lewat "+ Habit", centang hari ini, lalu cek DB;
  - batalkan centang, lalu cek `deleted_at`;
  - ubah hari aktif;
  - screenshot halaman dan panel detail.

## 7. Rencana PR

Rinciannya ada di `docs/superpowers/plans/2026-10-01-anchoa-fase3c-habit.md`.

| PR | Isi |
|---|---|
| 3C-1 | Migrasi 006, `habits.rs`, command, pengingat di dashboard, tipe API |
| 3C-2 | Halaman Habit, nav, panel notifikasi, tinggi jendela 720, E2E, versi 0.5.0, rilis "Anchoa v0.5.0 — Habit" |
