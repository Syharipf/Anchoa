# Anchoa — Fase 7: Unduhan

Tanggal: 2026-10-01
Status: user meminta Fase 7 dilanjutkan pada 2026-10-01 dan memberi wewenang merge dan rilis. Semua keputusan di §2 diambil Claude dan bisa diubah nanti. Spec ini mengikuti `docs/design/artboards/Unduhan.dc.html` dan `DESIGN.md` §2 "Unduhan". Ini versi awal.

## 1. Ringkasan

Pengelola unduhan di dalam Anchoa:
- kotak tautan dengan deteksi jenis: media (yt-dlp), file langsung, atau magnet/torrent;
- opsi media: Video atau Audio saja, kualitas, format, dan subtitle;
- antrean dengan tab Semua, Aktif, Selesai, dan Gagal;
- status Menunggu, Mengunduh, Dijeda, Memproses (ffmpeg), Selesai, dan Gagal;
- tombol Jeda, Lanjutkan, Ulangi, Buka, Tampilkan di Berkas, dan Hapus dari daftar;
- panel Mesin unduhan (yt-dlp dan ffmpeg dengan versinya) dan panel Pengaturan (folder, unduhan bersamaan, batas kecepatan);
- kartu Unduhan di dashboard (2 aktif dengan progres, dan kecepatan total).

## 2. Keputusan

| Kode | Keputusan |
|---|---|
| U1 | yt-dlp dan ffmpeg diambil dari `PATH` sistem (di Fedora: `dnf install yt-dlp ffmpeg`). Kalau tidak ada, panel Mesin menampilkan "Belum terpasang" beserta perintah pasangnya, dan unduhan media ditolak dengan pesan yang sama. Membundel binary ditunda ke Fase 9. |
| U2 | **File langsung** diunduh oleh Rust dengan `ureq`, yang sudah menjadi dependency: satu koneksi, dan bisa dilanjut lewat header `Range` dari file `.part`. Tidak memakai aria2 (belum terpasang, dan menambah proses). Multi-koneksi ditunda. |
| U3 | **Torrent** belum ada di versi awal. Magnet dan `.torrent` terdeteksi, lalu ditolak dengan "Torrent belum didukung". Sakelar Torrent di panel Mesin nonaktif dengan label "Menyusul". Tab Torrent tidak ditampilkan. |
| U4 | **Deteksi** mengikuti artboard: `magnet:` atau `.torrent` berarti torrent; host video atau audio (youtube.com, youtu.be, vimeo.com, soundcloud.com, twitch.tv, bandcamp.com, dailymotion.com, bilibili.com) berarti media; URL `http(s)` lain berarti file langsung. Chip jenis bisa diklik untuk memaksa "Media" bagi situs lain yang didukung yt-dlp. |
| U5 | **Pembaruan yt-dlp:** paket sistem tidak bisa memakai `yt-dlp -U`. Panel Mesin menampilkan versi (tanggal rilis). Kalau versinya lebih tua dari 60 hari, muncul petunjuk "Perbarui: sudo dnf upgrade yt-dlp". Tidak ada pembaruan otomatis. |
| U6 | **Unduhan bersamaan:** default 2, rentang 1–5. Kelebihannya menunggu dengan status Menunggu dan dimulai otomatis secara FIFO. |
| U7 | **Batas kecepatan:** pilihan Tanpa batas, 1 MB/s, 5 MB/s, dan 10 MB/s. Batas ini dibagi rata ke unduhan yang aktif (yt-dlp `--limit-rate`; file langsung memakai jeda per potongan). Ditulis sebagai `ponytail:`, karena pembagian dinamis bisa menyusul. |
| U8 | **Folder simpan:** default folder XDG Unduhan (memakai parser dari `files.rs`). "Ubah" membuka input teks yang divalidasi: harus folder yang sudah ada di bawah home. Pemilih folder visual menyusul. |
| U9 | **Jeda:** proses yt-dlp dihentikan, atau thread file langsung berhenti lewat flag. File `.part` tetap ada. Lanjutkan berarti menjalankan ulang, dan yt-dlp melanjutkan `.part` secara default. Saat app dibuka, unduhan yang tadinya Mengunduh, Menunggu, atau Memproses menjadi Dijeda. |
| U10 | **Hapus dari daftar** melakukan soft delete pada item. File yang sudah diunduh tidak disentuh. File sementara setiap unduhan ada di `<folder>/.anchoa-part/<id>/` (yt-dlp `-P temp:`; file langsung juga ditulis di sana), lalu dipindah ke folder saat selesai. Membatalkan unduhan yang belum selesai menghentikannya dulu, lalu menghapus folder sementara itu. Folder itu milik Anchoa sendiri, bukan file user. |
| U11 | **Progres langsung** disimpan di memori. DB hanya diperbarui saat status berubah. Frontend memanggil `downloads_list` tiap 1 detik selama ada unduhan aktif dan halamannya terbuka. Tanpa event Tauri, supaya `api.ts` tetap satu-satunya pintu. |
| U12 | Pantau clipboard, pintasan dashboard "Unduh dari clipboard", dan rasio seeding ditunda. Pintasan itu tetap membuka halaman Unduhan. |
| U13 | Media: video {2160p, 1080p, 720p, 480p} × {MP4, MKV, WEBM}, dan audio {320, 192, 128 kbps} × {MP3, M4A, OPUS}. Subtitle (id, en) ditanam kalau tersedia. Playlist tidak diikuti (`--no-playlist`). |

## 3. Data (migrasi 008)

```sql
CREATE TABLE downloads (
  item_id     TEXT PRIMARY KEY REFERENCES items(id),  -- type='download', title = judul/nama file
  url         TEXT NOT NULL,
  kind        TEXT NOT NULL,             -- 'media' | 'file'
  options     TEXT NOT NULL DEFAULT '{}',-- JSON MediaOptions untuk media
  status      TEXT NOT NULL,             -- queued | running | paused | processing | done | failed
  total_bytes INTEGER,
  done_bytes  INTEGER NOT NULL DEFAULT 0,
  file_path   TEXT,                      -- hasil akhir
  error       TEXT,
  finished_at INTEGER
);
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Kunci setting yang dipakai: `downloads.dir`, `downloads.parallel`, dan `downloads.limit` (byte/detik, 0 = tanpa batas).

## 4. Backend

- **`downloads.rs`:** CRUD, status, dan pengaturan sebagai fungsi murni di atas `Connection`. Isinya:
  - `build_ytdlp_args(opts, dir, limit) -> Vec<String>`;
  - `parse_progress_line(line) -> Option<Progress>`.
- **`downloader.rs`:** manajer runtime di `State`.
  - Isinya `Mutex<HashMap<id, Running>>` dengan proses anak atau flag batal, serta progres langsung (byte, kecepatan, ETA).
  - `schedule()` memulai antrean sampai batas paralel. Fungsi ini dipanggil setelah tambah, selesai, gagal, jeda, lanjut, dan saat pengaturan diubah.
  - Thread pembaca stdout yt-dlp mem-parse baris berawalan:
    - `PROGRESS <downloaded>/<total>/<speed>/<eta>` (dari `--progress-template`);
    - `POST` (pascaproses, sehingga status menjadi Memproses);
    - `TITLE <judul>` (dari `--print before_dl:`);
    - `FILE <path>` (dari `--print after_move:`).
  - Exit code bukan 0 berarti Gagal, dengan baris `ERROR:` terakhir sebagai pesan.
- **Argumen yt-dlp:**
  - dasar: `--newline --no-colors --no-playlist --progress`, `-P <dir>`, `-P temp:<dir>/.anchoa-part/<id>`, dan `-o %(title)s.%(ext)s`;
  - video: `-S res:<h>,ext:<fmt>` dan `--merge-output-format <fmt>`;
  - audio: `-x --audio-format <fmt> --audio-quality <k>K`;
  - subtitle: `--write-subs --sub-langs id,en --embed-subs`;
  - `--limit-rate <n>` kalau ada batas.
- **File langsung:**
  - nama diambil dari `Content-Disposition`, lalu dari segmen terakhir URL;
  - nama dibuat unik (`files::unique_name`);
  - data ditulis ke `<dir>/.anchoa-part/<id>/<nama>`, lalu di-rename ke `<dir>` saat selesai;
  - melanjutkan unduhan memakai `Range: bytes=<n>-`; kalau server menjawab 200 (bukan 206), unduhan mulai dari awal.
- **Command:**
  - `downloads_list` → `{ items: DownloadView[], speed, active }`;
  - `add_download { url, kind, options }`;
  - `pause_download`, `resume_download`, `retry_download`, `remove_download` (masing-masing menerima `id`);
  - `open_download` (membuka file; folder untuk yang gagal) dan `reveal_download` (path untuk halaman Berkas);
  - `download_engines` → versi yt-dlp dan ffmpeg atau null, serta petunjuk;
  - `download_settings` dan `save_download_settings`.
- **Validasi:**
  - URL harus `http`, `https`, atau `magnet`, dan magnet ditolak (U3);
  - folder harus ada dan berada di bawah home;
  - path keluaran dicek tetap di dalam folder (nama yang mengandung `/` atau `..` disanitasi).

## 5. UI

Halaman `src/downloads/` mengikuti artboard dan menggantikan halaman "menyusul". Isinya:
- **Header:** ↓ kecepatan total, jumlah aktif, dan "Jeda semua" atau "Lanjutkan semua".
- **Kartu Tambah unduhan:**
  - input URL dan chip deteksi;
  - opsi media (segmented Video/Audio, chip kualitas, chip format, sakelar subtitle);
  - tombol "Unduh 1080p MP4" atau "Unduh";
  - petunjuk per jenis (`DET` di artboard).
- **Antrean:**
  - tab dengan jumlah;
  - baris berisi ikon jenis, judul, meta (host · format · ukuran), bar progres, teks progres, status, dan tombol aksi;
  - kosong: "Tidak ada unduhan di tab ini."
- **Panel kanan:**
  - Mesin unduhan: yt-dlp, ffmpeg, File langsung (bawaan), dan Torrent (nonaktif);
  - Pengaturan: folder, unduhan bersamaan − n +, dan batas kecepatan.
- **Dashboard:** kartu Unduhan menampilkan 2 unduhan aktif dengan progres dan kecepatan total, atau "Tidak ada unduhan aktif".

Polling dilakukan dengan `useEffect` + `setInterval(1000)`, hanya saat ada item aktif.

## 6. Testing

- **Rust:**
  - `build_ytdlp_args` untuk video, audio, subtitle, dan batas kecepatan;
  - `parse_progress_line`;
  - status: tambah, mulai sampai batas paralel, jeda, lanjut, dan app dibuka ulang;
  - sanitasi nama;
  - unduhan file langsung dari server HTTP lokal di test (`std::net::TcpListener` di thread), termasuk melanjutkan lewat `Range`;
  - pengaturan.
- **Frontend:** deteksi URL (contoh-contoh dari artboard) dan label progres ("63% · 8,2 MB/s · 19 dtk lagi").
- **E2E** (`check_downloads`):
  - `python3 -m http.server` lokal menyajikan `contoh.bin` (2 MB) dan `klip.mp4` (dibuat `ffmpeg -f lavfi`);
  - tambahkan URL file langsung, lalu tunggu Selesai dan cek file ada di folder unduhan sementara;
  - tambahkan URL `klip.mp4` sebagai Media dengan Audio MP3 (yt-dlp generic dan ffmpeg), lalu tunggu Selesai dan cek `.mp3` ada;
  - screenshot;
  - folder unduhan diarahkan ke direktori sementara lewat setting di DB, tanpa jaringan luar.

## 7. Rencana PR

| PR | Isi |
|---|---|
| 7-1 | Migrasi 008, `downloads.rs`, `downloader.rs`, command, tipe API |
| 7-2 | Halaman Unduhan, kartu dashboard, E2E, versi 0.8.0, rilis "Anchoa v0.8.0 — Unduhan" |
