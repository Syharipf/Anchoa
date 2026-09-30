# Anchoa — Fase 4: Jurnal

Tanggal: 2026-10-01
Status: disusun Claude saat user tidur, dari artboard `docs/design/artboards/Jurnal.dc.html` yang user tambahkan pada 2026-09-30. Semua keputusan di §2 diambil tanpa tanya-jawab. Isi Fase 4 lama (pohon halaman, editor blok BlockNote, wikilink, FTS5, export Markdown) **tidak** termasuk di sini dan menunggu keputusan user. Ini versi awal.

## 1. Ringkasan

**Jurnal** menggantikan Inbox di nav. Halaman ini tempat ide, curhat, dan catatan cepat. Isinya:
- **Daftar entri** (kiri): pencarian, filter jenis, dan grup per waktu.
- **Editor entri** (tengah): jenis, judul, isi, tag, dan suasana hati 1–5.
- **Kolom kanan:**
  - **Suasana 30 hari:** batang per hari;
  - **Pemantik:** pertanyaan untuk mulai menulis;
  - **Ide terbaru:** ide yang belum dijadikan tugas.
- **"Jadikan tugas"** untuk entri Ide.
- Habit bisa tercentang otomatis saat menulis jurnal. Ini melunasi keputusan H7 di Fase 3C.

## 2. Keputusan tanpa tanya-jawab

| Kode | Keputusan | Alasan |
|---|---|---|
| N1 | Entri jurnal adalah catatan yang sudah ada (`type = 'note'`), dengan tabel ekstensi opsional `journal_entries`. Catatan tanpa baris ekstensi dianggap berjenis Catatan tanpa suasana hati (LEFT JOIN). | Semua catatan lama langsung menjadi entri Jurnal tanpa migrasi data, dan Ctrl+N tetap membuat catatan. |
| N2 | Jenis entri: `idea` (Ide), `vent` (Curhat), dan `note` (Catatan). | Tiga jenis dari artboard. |
| N3 | Tag disimpan sebagai teks di `journal_entries.tags`: huruf kecil, dipisah spasi, tanpa `#`. | Belum ada kebutuhan tag lintas modul. Kalau muncul nanti, isinya bisa dipindah ke tabel sendiri. |
| N4 | Grup waktu dihitung di Rust dari waktu dibuat: Hari ini, Kemarin, 7 hari terakhir, lalu per bulan ("September 2026"). | Batas hari di Rust, dan label sama dengan artboard. |
| N5 | Pencarian memakai `LIKE` pada judul dan isi, di perangkat. | FTS5 termasuk isi Fase 4 lama yang menunggu keputusan user. |
| N6 | Chip "Privat · di perangkat". Artboard menulis "terenkripsi", tapi enkripsi baru ada bersama sync (Fase 9), jadi label itu belum boleh dipakai. | Tidak menjanjikan fitur yang belum ada. |
| N7 | "Jadikan tugas" (hanya untuk Ide) membuat tugas lepas berstatus Rencana dengan judul entri. Isi tugas berisi tautan balik ke entri dan cuplikan isinya. ID tugas disimpan di `journal_entries.task_id`. Setelah itu tombol menjadi "Buka tugas". | Ide tidak hilang, dan tugas tahu asalnya. |
| N8 | Suasana 30 hari: satu batang per hari lokal, tingginya rata-rata suasana hati entri hari itu (dibulatkan). Hari tanpa entri tampil sebagai titik. Hari dengan entri tapi tanpa suasana hati tampil sebagai batang pendek abu. Keterangan "n hari menulis". | Sama dengan artboard. |
| N9 | Pemantik berupa daftar tetap berisi 8 pertanyaan di frontend, diputar dengan "Ganti". "Tulis dari sini" membuat entri baru dengan judul sama dengan pertanyaannya. | Tidak butuh backend. |
| N10 | Habit mendapat opsi "Centang otomatis saat menulis jurnal" (kolom `habits.auto_journal`). Menyimpan entri yang isinya tidak kosong hari ini akan mencentang habit itu untuk hari ini, kalau hari ini terjadwal. | Melunasi keputusan H7 di Fase 3C. |
| N11 | "Dikte", "Bacakan", dan "Minta tanggapan" tampil nonaktif dengan tooltip "Hadir di Fase 5". | Butuh asisten suara dan LLM. |
| N12 | Halaman `inbox` diganti nama menjadi `jurnal` di `nav.ts`, termasuk labelnya. Titik lime di nav Inbox dihapus. Teks "Simpan ke Inbox" dan "Tersimpan ke Inbox" menjadi "Simpan ke Jurnal" dan "Tersimpan ke Jurnal". | Artboard Main mengganti Inbox dengan Jurnal. |

## 3. Model data

### Migrasi `007_journal.sql`

```sql
CREATE TABLE journal_entries (
  item_id TEXT PRIMARY KEY REFERENCES items(id),  -- items.type = 'note'
  kind    TEXT NOT NULL DEFAULT 'note',           -- idea | vent | note
  mood    INTEGER,                                -- 1–5, NULL = belum diisi
  tags    TEXT NOT NULL DEFAULT '',               -- "anchoa kuliah"
  task_id TEXT REFERENCES items(id)               -- tugas hasil "Jadikan tugas"
);

ALTER TABLE habits ADD COLUMN auto_journal INTEGER NOT NULL DEFAULT 0;
```

`user_version` naik ke 7.

## 4. Command

| Command | Masukan | Keluaran |
|---|---|---|
| `journal_list` | `{ query?, kind? }` | `{ groups: { key, label, entries: EntrySummary[] }[] }` |
| `journal_entry` | `id` | `Entry` |
| `create_entry` | `{ kind, title? }` | `Entry` |
| `update_entry` | `id`, `EntryPatch { kind?, mood?: number \| null, tags?: string }` | `Entry` |
| `entry_to_task` | `id` | `Entry` (dengan `taskId` terisi) |
| `journal_side` | - | `{ trend: { date, mood \| null, wrote }[30], writeDays, ideas: EntrySummary[5] }` |

```
EntrySummary { id, kind, title, preview, mood, createdAt, time: "21.10" | "Sen 22.05" | "29 Sep" }
Entry        { id, kind, title, body, mood, tags: string[], createdAt, when: "Selasa, 29 Sep · 21.10", taskId }
```

- Judul dan isi tetap diubah lewat `update_item` (autosave yang sudah ada). Setelah `update_item` pada catatan yang isinya tidak kosong, backend menjalankan centang otomatis (N10).
- `journal_list` diurutkan dari yang terbaru. Pencarian tidak membedakan huruf besar-kecil.
- Validasi (`Invalid`): `mood` harus 1–5, jenis harus salah satu dari tiga nilai, tag hanya boleh huruf, angka, dan `-`, dan `entry_to_task` hanya untuk Ide yang belum punya tugas.

## 5. UI

Mengikuti `Jurnal.dc.html`.

- **Header:**
  - "Jurnal", subjudul "Ide, keluh kesah, dan catatan — tanpa dinilai";
  - chip "Privat · di perangkat";
  - "Dikte" (nonaktif) dan "Tulis" (membuat entri Catatan baru, atau entri berjenis filter aktif, lalu memilihnya).
- **Tiga kolom** `296px | 1fr | 272px`:
  - **Daftar:**
    - pencarian (dengan debounce 250 ms);
    - filter Semua/Ide/Curhat/Catatan;
    - grup berlabel;
    - kartu berisi ikon jenis (Ide lime, lainnya muted), jenis, waktu, batang suasana hati mini, judul (atau "Tanpa judul"), dan cuplikan dua baris.
  - **Editor:**
    - jenis (Segmented dengan ikon) dan waktu;
    - judul (Space Grotesk 22px) dan isi (textarea);
    - tag dengan input `#tag` (Enter menambah, × menghapus);
    - suasana hati (5 tombol, dan tombol yang aktif bisa diklik lagi untuk mengosongkan);
    - footer: status simpan, "Jadikan tugas" atau "Buka tugas" (khusus Ide), "Bacakan" dan "Minta tanggapan" (nonaktif).
  - **Kanan:** Suasana 30 hari, Pemantik, dan Ide terbaru.
- **Kosong:** "Belum ada entri. Mulai dari pemantik di kanan, atau tekan Tulis."
- **Habit:** formulir habit (Fase 3C) mendapat checkbox "Centang otomatis saat menulis jurnal".

## 6. Testing

- **Rust:**
  - migrasi v6→v7, dan catatan lama muncul sebagai Catatan;
  - grup waktu;
  - pencarian;
  - filter jenis;
  - `update_entry` dan validasinya;
  - `entry_to_task`, termasuk ditolak kedua kalinya dan untuk yang bukan Ide;
  - tren 30 hari (rata-rata, hari tanpa entri, `writeDays`);
  - Ide terbaru tanpa yang sudah jadi tugas;
  - centang otomatis habit (isi kosong tidak mencentang, hari libur tidak mencentang).
- **Frontend:** parsing tag, putaran pemantik, dan label jenis.
- **E2E:**
  - Ctrl+N lalu entri muncul di Jurnal;
  - Tulis, isi, pilih suasana hati, lalu cek DB;
  - ubah jenis ke Ide, Jadikan tugas, lalu cek DB;
  - habit "Tulis jurnal" otomatis tercentang;
  - screenshot.

## 7. Rencana PR

Rinciannya ada di `docs/superpowers/plans/2026-10-01-anchoa-fase4-jurnal.md`.

| PR | Isi |
|---|---|
| 4-1 | Migrasi 007, `journal.rs`, centang otomatis habit, command, tipe API |
| 4-2 | Halaman Jurnal (menggantikan Inbox), nav, teks palette dan toast, opsi habit, E2E, versi 0.6.0, rilis "Anchoa v0.6.0 — Jurnal" |
