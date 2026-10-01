---
description: Review keamanan kode Rust/Tauri yang berubah
---

Lakukan review keamanan pada perubahan terbaru (`git diff` terhadap commit terakhir; jika belum ada commit, seluruh `src-tauri/` dan `src/lib/api/`).

Periksa:
1. **Capabilities Tauri** (`src-tauri/capabilities/`): izin seminimal mungkin, tidak ada wildcard yang tidak perlu, scope `fs` hanya folder yang dibutuhkan.
2. **Path**: setiap path dari frontend dikanonikalisasi dan dicek tetap di dalam folder yang diizinkan (cegah path traversal `..`, symlink keluar).
3. **Proses eksternal** (yt-dlp, ffmpeg): argumen berupa array, tidak ada string shell, URL divalidasi, tidak ada opsi yang bisa disuntik lewat input pengguna (mis. URL diawali `-`).
4. **Rahasia**: tidak ada service role key Supabase atau API key AI di repo/app; hanya URL + anon/publishable key. Kredensial IMAP/SFTP & token sesi di keyring OS / Android Keystore, tidak di-log, tidak dikirim ke Supabase.
4b. **Supabase**: query hanya lewat `src/lib/api/`; tidak ada logika izin yang menggantikan RLS; data sensitif tidak ikut dikirim ke `ai-gateway` tanpa perlu.
5. **Error handling**: tidak ada `unwrap()`/`expect()` di jalur command; pesan error ke frontend tidak membocorkan path sistem atau detail sensitif.
6. **Dependensi**: jalankan `cargo audit` jika tersedia (sarankan instalasinya jika belum).
7. **Jaringan**: TLS diverifikasi, timeout diset, ukuran unduhan/respons dibatasi.

Laporkan temuan dengan tingkat (tinggi/sedang/rendah), lokasi file:baris, dan usulan perbaikan. Jangan mengubah kode sebelum aku setuju.
