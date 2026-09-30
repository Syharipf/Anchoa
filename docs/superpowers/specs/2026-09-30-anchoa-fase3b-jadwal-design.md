# Anchoa — Fase 3B: Jadwal

Tanggal: 2026-09-30
Status: disusun Claude saat user tidur, dengan izin untuk mengambil keputusan sendiri (lihat §2). Mengikuti `docs/design/artboards/Jadwal.dc.html` dan `DESIGN.md` §2 "Jadwal". Ini versi awal.

## 1. Ringkasan

Halaman Jadwal menampilkan tugas (Fase 3A) dan tagihan (Fase 2) dalam dua tampilan:
- **Kalender:** grid bulan dengan chip per tanggal, dan panel agenda di kanan.
- **Timeline:** 8 minggu, dengan batang per tugas yang dikelompokkan per proyek.

Warna chip dan batang mengikuti **jenis**, bukan proyek:
- Proyek: `--cat-proyek` `#3987E5`;
- Tagihan: `--cat-tagihan` `#C98500`;
- Pribadi: `--cat-pribadi` `#D55181`.

## 2. Keputusan tanpa tanya-jawab

| Kode | Keputusan | Alasan |
|---|---|---|
| J1 | Jenis item: tugas di dalam proyek = Proyek, tugas lepas = Pribadi, tagihan = Tagihan. | Sama dengan tiga filter di artboard, tanpa field baru. |
| J2 | Di kalender, tugas tampil di tanggal tenggatnya saja. Tugas tanpa tenggat tidak tampil. Di timeline, batang membentang dari `start_at` (atau tenggat, kalau tidak ada) sampai tenggat. | Kalender adalah daftar tenggat, dan timeline menampilkan rentang kerja. |
| J3 | Tagihan bulanan diproyeksikan ke bulan-bulan dalam rentang yang ditampilkan, memakai aturan `due_day` Fase 2. Hanya jatuh tempo berikutnya (yang tersimpan) yang bisa dicentang; mencentangnya sama dengan "Tandai lunas". Proyeksi hanya untuk dilihat. | Kalender bulan depan tetap menampilkan tagihan rutin, tanpa membuat data palsu. |
| J4 | Mencentang tugas di panel agenda memakai `update_task` status `done`, dan mencentangnya lagi mengembalikan ke `plan`. | Sama seperti "Hari ini". |
| J5 | Minggu dimulai Senin. | Kebiasaan di Indonesia. |
| J6 | Timeline: 8 minggu mulai Senin minggu lalu, sehingga hari ini ada di minggu kedua. Tombol ‹ › menggeser 4 minggu. Kalender: tombol ‹ › menggeser satu bulan. "Hari ini" kembali ke periode yang berisi hari ini. | Hari ini selalu terlihat, dan ada konteks satu minggu ke belakang. |
| J7 | Tugas `done` tidak tampil di timeline, dan tampil dicoret di kalender dan agenda. | Timeline fokus pada pekerjaan yang tersisa. |
| J8 | Filter jenis (Proyek, Tagihan, Pribadi) berlaku di kalender, agenda, dan timeline. Pilihannya diingat di `localStorage` (dengan try/catch). | Preferensi per perangkat, bukan data. |
| J9 | "Acara non-tugas" (acara berjam) dari roadmap ditunda. | Artboard tidak memuatnya, dan butuh model waktu yang berbeda. |
| J10 | Klik chip atau baris tugas membuka halaman item. Klik tagihan membuka halaman Keuangan. | Memakai halaman yang sudah ada. |

## 3. Data

Tidak ada migrasi. Satu command baru:

`schedule({ from: "YYYY-MM-DD", to: "YYYY-MM-DD" })` → `Schedule`

```
Schedule      { today: "YYYY-MM-DD", items: ScheduleItem[], deadlines: ProjectDeadline[] }
ScheduleItem  { key, source: "task" | "bill", id, kind: "project" | "bill" | "personal",
                title, groupId, groupName, startDate?: "YYYY-MM-DD", dueDate: "YYYY-MM-DD",
                status: "plan" | "doing" | "done", overdue, checkable }
ProjectDeadline { projectId, name, date: "YYYY-MM-DD" }
```

- Semua tanggal adalah tanggal lokal, dan konversinya dikerjakan di Rust.
- `items` berisi:
  - tugas yang hidup dan punya tenggat, dengan rentang `[startDate atau dueDate, dueDate]` yang beririsan dengan `[from, to]`;
  - tugas dengan tenggat sebelum `from` yang belum selesai, karena terlambat (supaya bagian Terlambat di agenda lengkap);
  - tagihan: jatuh tempo tersimpan (dengan `checkable` benar, status `done` kalau `paidToday`) dan proyeksi bulanan di dalam rentang (dengan `checkable` salah).
- `key` unik per baris: `task:<id>`, `bill:<id>:<dueDate>`.
- `groupId`/`groupName`: proyek untuk tugas proyek, `personal`/"Pribadi" untuk tugas lepas, dan `bills`/"Tagihan" untuk tagihan.
- `overdue`: tenggat sebelum hari ini dan belum selesai. Untuk tagihan, statusnya `overdue`.
- `deadlines`: deadline proyek yang hidup di dalam rentang.
- Validasi: `from` ≤ `to`, rentang paling panjang 93 hari, dan format tanggal benar. Semuanya mengembalikan `Invalid`.

## 4. UI

Halaman Jadwal menggantikan halaman "menyusul"; field `about` dan `fase` Jadwal dihapus dari `nav.ts`.

- **Header:**
  - "Jadwal", toggle **Kalender | Timeline** (`aria-pressed`);
  - navigasi ‹ label periode › ("September 2026", atau "28 Sep – 22 Nov" untuk timeline), dan tombol "Hari ini";
  - chip filter Proyek, Tagihan, Pribadi, masing-masing dengan titik warna jenisnya. Chip yang mati tampil redup.
- **Kalender:**
  - grid 7 kolom Sen–Min, 5 atau 6 baris;
  - tanggal di luar bulan tampil redup, dan hari ini punya bingkai lime;
  - maksimal 3 chip per sel (2 kalau 6 baris), lalu "+n lagi";
  - chip berisi judul terpotong dengan latar warna jenis. Chip tugas yang `done` dicoret, dan chip yang terlambat punya bingkai coral;
  - klik sel memilih tanggal, dan tanggal terpilih mendapat latar `--surface-2`.
- **Panel agenda** (kanan, 320px, di tampilan kalender):
  - judul "Rabu, 30 September";
  - tiga grup: **Terlambat** (semua yang terlambat), **Tenggat hari itu**, dan **7 hari berikutnya** (setelah tanggal terpilih);
  - tiap baris berisi checkbox (kalau `checkable`), titik warna, judul, nama grup, dan tanggal (untuk grup 7 hari);
  - kalau kosong: "Tidak ada tenggat".
- **Timeline:**
  - baris minggu dan hari (16px per hari, 56 hari = 896px), dengan scroll horizontal kalau perlu;
  - kiri: nama grup (proyek dengan deadline dalam rentang lebih dulu, lalu Pribadi, lalu Tagihan);
  - batang: `doing` = batang penuh, `plan` = garis tepi dengan warna jenis, `overdue` = bingkai coral. Tagihan dan tugas satu hari tampil sebagai batang 1 hari;
  - belah ketupat = deadline proyek, dan garis vertikal lime = hari ini;
  - `title` dan `aria-label` tiap batang: "Judul · 28 Sep – 3 Okt · Dikerjakan";
  - klik batang membuka item.
- **Dashboard dan palette** tidak berubah. Halaman Jadwal sudah ada di palette ("Buka halaman").

## 5. Testing

- **Rust:**
  - jenis dan grup dari tugas proyek, tugas lepas, dan tagihan;
  - rentang dan irisan;
  - tugas terlambat sebelum `from` ikut masuk;
  - proyeksi tagihan bulanan (31 Jan → 28 Feb) dan `checkable`;
  - `done` dan `paidToday`;
  - deadline proyek;
  - validasi rentang;
  - item yang dihapus tidak ikut.
- **Frontend** (`bun test`):
  - grid bulan Senin-pertama (5 dan 6 baris);
  - pembagian chip per sel dengan "+n lagi";
  - grup agenda;
  - posisi dan lebar batang timeline;
  - label periode;
  - filter jenis.
- **E2E:**
  - buka Jadwal, lalu screenshot kalender;
  - klik tanggal hari ini, lalu agenda menampilkan tugas hari ini;
  - centang tugas di agenda, lalu cek DB `status = 'done'`;
  - toggle Timeline, lalu screenshot;
  - matikan filter Tagihan, lalu chip tagihan hilang.

## 6. Kriteria selesai

1. Kalender, agenda, dan timeline menampilkan tugas dan tagihan dengan tanggal lokal yang benar.
2. Centang di agenda mengubah status tugas atau melunasi tagihan.
3. Filter jenis bekerja di ketiga tampilan.
4. Semua test lulus, dan CI serta SonarCloud hijau.

## 7. Rencana PR

Rinciannya ada di `docs/superpowers/plans/2026-09-30-anchoa-fase3b-jadwal.md`.

| PR | Isi |
|---|---|
| 3B-1 | Command `schedule` (backend) |
| 3B-2 | Halaman Jadwal: header, filter, kalender, panel agenda |
| 3B-3 | Timeline, E2E Jadwal, versi 0.4.0, rilis "Anchoa v0.4.0 — Jadwal" |
