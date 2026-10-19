# Anchoa — Rencana Implementasi: Unduhan v2 Accelerator

Spesifikasi: `docs/superpowers/specs/2026-10-18-anchoa-unduhan-v2-design.md`
Cabang: `feat/unduhan-accelerator`

## Task 1: Akselerator Berkas Rust (downloader.rs)
- Ubah `use_multi_range` agar tidak bergantung pada `is_strong_etag`.
- Naikkan `NUM_WORKERS` dari 4 menjadi 8.
- Threshold ukuran minimum berkas untuk multi-range diturunkan dari 8 MiB menjadi 2 MiB.
- Pastikan tes integrasi range dan SHA-256 tetap lolos.

## Task 2: Akselerator Media & Proteksi Anti-Corrupt (downloads.rs)
- Deteksi `aria2c` di `build_ytdlp_args`. Jika ada, tambahkan `--downloader aria2c --downloader-args "aria2c:-s 8 -x 8 -k 1M"`.
- Tambahkan argumen retries tinggi (`--retries 10`, `--fragment-retries 10`, `--file-access-retries 5`).
- Naikkan `--concurrent-fragments` dari 4 menjadi 8.

## Task 3: Deteksi Tautan Universal (view.ts)
- Perluas `MEDIA_HOSTS` dengan `threads.net`, `instagram.com`, `tiktok.com`, `facebook.com`, `fb.watch`, `reddit.com`, `pinterest.com`, `linkedin.com`.
- Perbarui unit test `view.test.ts` untuk memverifikasi deteksi tautan baru.

## Task 4: UI Format Selector & Tempel Clipboard (AddDownload.tsx)
- Tambahkan resolusi 1440p (2K) dan format FLAC & WAV.
- Tambahkan tombol "Tempel Clipboard" di samping input URL.
## Task 6: Auto-Catch Clipboard (useClipboardCatch.ts & DownloadsPage.tsx)
- Buat hook `useClipboardCatch`: periksa clipboard saat window focus.
- Tampilkan floating banner "Tautan terdeteksi di clipboard: Unduh?".

## Task 7: Engine Torrent & Magnet aria2c (downloader.rs & downloads.rs)
- Tambahkan runner torrent di `downloader.rs` memanggil `aria2c`.
- Buat parser progres output console `aria2c`.
- Izinkan jenis URL `magnet:` dan `.torrent` di `downloads.rs`.

## Task 8: In-App Media Player Modal (MediaPlayerModal.tsx & DownloadQueue.tsx)
- Buat modal dialog pemutar video/audio bawaan di `src/downloads/MediaPlayerModal.tsx`.
- Tambahkan tombol "Putar Media" pada kartu tugas unduhan berstatus "done".

## Task 9: Batch Multi-Link Downloader (AddDownload.tsx)
- Tambahkan toggle "Mode Batch" (textarea untuk memasukkan banyak tautan sekaligus).
- Validasi setiap baris dan tambahkan semua tautan valid ke antrean unduhan secara otomatis.

## Task 5: Verifikasi Penuh (@advisor)
- Jalankan `cargo test downloads` dan `cargo test downloader`.
- Jalankan `bun test src/downloads` dan `bun run typecheck`.
- Build release binary dan perbarui `/usr/bin/anchoa`.
