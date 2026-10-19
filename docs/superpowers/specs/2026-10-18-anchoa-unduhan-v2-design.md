# Anchoa — Unduhan v2: Akselerator Multi-Koneksi & Media Universal

Tanggal: 2026-10-19
Status: Disetujui user untuk peningkatan kecepatan unduhan, pencegahan file corrupt, dan dukungan tautan universal.

## 1. Ringkasan

Modul Unduhan ditingkatkan dengan teknologi akselerasi dan proteksi korupsi:
1. **Akselerator Berkas Langsung (Multi-Segment Worker):**
   - Menghapus pembatasan `is_strong_etag` yang sebelumnya membatalkan 90% unduhan paralel.
   - Mengaktifkan segmentasi paralel (hingga 8 pekerja range per unduhan) untuk berkas yang mendukung `Range: bytes` dan memiliki ukuran $\ge 2\text{ MiB}$.
   - Penyimpanan sementara berkas terisolasi per chunk (`payload.part`) dengan verifikasi integritas SHA-256 dan *atomic rename*.
2. **Akselerator Media (`yt-dlp` + `aria2c`):**
   - Mendeteksi ketersediaan binary `aria2c` di sistem. Jika ada, `yt-dlp` mendelegasikan pengunduhan fragmen ke `aria2c` dengan 8 koneksi bersamaan.
   - Parameter akselerasi bawaan: `--concurrent-fragments 8`, `--http-chunk-size 10M`, dan `--buffer-size 64K`.
   - Proteksi kegagalan jaringan: `--retries 10`, `--fragment-retries 10`, dan `--file-access-retries 5`.
3. **Dukungan Tautan Universal:**
   - Deteksi otomatis diperluas mencakup: Threads (`threads.net`), Instagram (`instagram.com`), TikTok (`tiktok.com`), X/Twitter (`x.com`, `twitter.com`), Facebook (`facebook.com`, `fb.watch`), Reddit (`reddit.com`), Pinterest (`pinterest.com`), dan LinkedIn (`linkedin.com`).
   - Tautan dari situs mana pun tetap dapat dipaksa diunduh sebagai Media (`forcedMedia`).
4. **Format Selector Lengkap & Tempel Clipboard:**
   - Kualitas Video: 2160p (4K), 1440p (2K), 1080p, 720p, 480p, 360p.
   - Format Kontainer Video: MP4, MKV, WEBM.
   - Kualitas Audio: 320 kbps, 256 kbps, 192 kbps, 128 kbps.
   - Format Audio: MP3, M4A, FLAC, OPUS, WAV.
   - Tombol "Tempel Tautan" langsung membaca isi clipboard sistem.

## 2. Keputusan Desain & Arsitektur

5. **Auto-Catch Clipboard:**
   - Memantau clipboard sistem saat jendela Anchoa aktif / fokus (`window.onfocus` atau clipboard listener).
   - Jika mendeteksi URL yang valid (video, audio, berkas, magnet), muncul floating badge dialog "Tautan terdeteksi: [URL] [Unduh] [Tutup]".
6. **Dukungan Torrent & Magnet (via aria2c):**
   - Menghapus larangan `magnet:` dan `.torrent`.
   - Eksekusi engine torrent via binary `aria2c`:
     `aria2c --dir=<dir> --seed-time=0 --max-connection-per-server=8 --split=8 <url>`
   - Parser stdout aria2c menangkap byte terunduh, total byte, kecepatan, dan status selesai.
7. **Pemutar Media Langsung (Built-in Media Player):**
   - Komponen modal `MediaPlayerModal.tsx` yang memutar file video (`.mp4`, `.mkv`, `.webm`) atau audio (`.mp3`, `.m4a`, `.flac`, `.opus`, `.wav`) yang berstatus "done".
   - Menggunakan URL protokol asset Tauri `http://asset.localhost/<filepath>` yang sudah dikonfigurasi di `tauri.conf.json`.
8. **Batch / Multi-Link Downloader:**
   - Mode input banyak tautan sekaligus di `AddDownload.tsx` (satu tautan per baris).
   - Otomatis memecah dan mendaftarkan seluruh tautan secara berurutan ke antrean database.
| Kode | Keputusan | Alasan |
|---|---|---|
| A1 | Hapus syarat `probe.is_strong_etag` pada `fetch_multi_range`. Cukup `supports_range && total >= 2MB`. | Mayoritas server modern (Cloudflare, AWS S3, GitHub) mengirimkan weak ETag (`W/"..."`) atau hanya `Last-Modified`. Syarat strong ETag menyebabkan unduhan lambat single-stream. |
| A2 | Naikkan pekerja paralel berkas langsung dari 4 menjadi 8 chunk worker (`NUM_WORKERS = 8`). | Memaksimalkan utilisasi bandwidth internet broadband tanpa membebani overhead koneksi. |
| A3 | Delegasikan unduhan fragmen video ke `aria2c` bila terpasang di sistem (`/usr/bin/aria2c`). | `aria2c` terbukti 3x–10x lebih cepat dalam multi-connection pooling dibanding downloader bawaan python. |
| A4 | Tautan media sosial baru dimasukkan ke `MEDIA_HOSTS`. | Pengguna dapat langsung menempel tautan X, Threads, IG Reels, TikTok tanpa perlu memilih opsi manual. |
| A5 | Verifikasi integritas otomatis dengan SHA-256 dan proteksi part. | File tidak akan dinamai ke file akhir sebelum 100% byte terunduh dan terverifikasi. |
