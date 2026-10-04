# Anchoa — Penyedia AI remote

Tanggal: 2026-10-04
Status: cakupan disetujui user; dokumen untuk review sebelum rencana implementasi.

## 1. Cakupan

Pengaturan Asisten & AI mendukung Ollama, OpenAI, Anthropic, Google Gemini, OpenRouter, dan tepat satu penyedia Kustom OpenAI-compatible. Tidak mengubah suara atau avatar. Percakapan (`chat`) dan rekap harian (`recap`) dapat memakai remote. Jurnal dan email tetap Ollama lokal. Aksi tulis tetap usulan dengan persetujuan pengguna.

## 2. Transport

Pertahankan satu klien OpenAI-compatible di `assistant/llm.rs`, streaming SSE dan tool calls; jangan menambah SDK provider. Endpoint tetap untuk provider resmi:

| Provider | Base URL |
|---|---|
| Ollama | `http://127.0.0.1:11434/v1` |
| OpenAI | `https://api.openai.com/v1` |
| Anthropic | `https://api.anthropic.com/v1` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Kustom | URL dari pengguna |

Anthropic memakai compatibility layer, bukan native Messages API. Dokumentasi Anthropic menyebut layer ini untuk pengujian/perbandingan dan menyarankan native API untuk produksi; UI harus menyebut mode kompatibilitas dan batasnya. Jangan menjanjikan seluruh kemampuan native Claude. Gemini juga memakai compatibility layer. Dukungan model terhadap streaming/tools harus dibuktikan, bukan disimpulkan dari daftar model. Model yang tidak mendukung tools mengembalikan kesalahan jelas; jangan diam-diam membuang tools atau mengganti provider/model.

Daftar model diperoleh melalui endpoint provider (Ollama `/api/tags`, remote `/models` dengan autentikasi yang didokumentasikan provider). Input ID model manual tetap tersedia untuk Kustom yang tidak menyediakan listing. Tes koneksi menunjukkan kesalahan autentikasi, jaringan, quota/rate limit, dan respons tidak kompatibel tanpa membocorkan secret.

## 3. Kredensial dan URL

Rust menyimpan API key dalam keyring OS yang sudah menjadi dependency. SQLite hanya menyimpan metadata provider, Base URL Kustom, nama Kustom, dan konfigurasi role. API key tidak masuk log, hasil IPC, backup, sync, atau pesan kesalahan. Frontend menerima status key tersedia/tidak, bukan nilainya. Form secret kosong saat dibuka; key kosong tidak menimpa key tersimpan. Penghapusan key adalah aksi eksplisit. Keyring gagal berarti simpan gagal, bukan fallback ke plaintext.

URL Kustom divalidasi di Rust: URL absolut, HTTPS kecuali HTTP dengan host loopback literal (`localhost`, `127.0.0.1`, `[::1]`); tolak userinfo, query, fragment, scheme lain, host kosong, dan port tidak valid. Normalisasi trailing slash. Jangan mengikuti redirect yang dapat mengirim secret ke origin lain atau menurunkan HTTPS ke HTTP. Key Kustom hanya dikirim ke endpoint yang dikonfigurasi; mengubah URL membatalkan key lama agar tidak otomatis dikirim ke tujuan baru.

## 4. Routing dan privasi

Endpoint request diselesaikan dari provider role aktual; semua jalur produksi yang memakai `Endpoint::default()` ditinjau dan diganti dengan resolusi role atau resolusi lokal eksplisit untuk role privat. Jangan menahan mutex DB selama jaringan/keyring. Test endpoint injection tetap tersedia, bukan bypass konfigurasi produksi.

`journal_weekly_summary` sekarang membaca role `recap` (`journal.rs:812`). Pindahkan ke `journal`, termasuk test dan label terkait. Ringkasan jurnal tidak boleh memakai konfigurasi rekap cloud. Rust menolak provider remote untuk `journal` dan `email`, termasuk settings yang ditamper.

Audit `context::system_prompt`, `today_overview`, `search_items`, `list_tasks`, dan hasil aksi tulis: tidak mengirim isi jurnal/email atau salinan jurnal yang menjadi tugas. Prompt saat ini mengecualikan dashboard.recent; search chat sudah mengecualikan note dan tugas dari jurnal. Seluruh jalur lain harus menjaga batas sama, termasuk hasil persetujuan `add_journal_entry`. Percakapan yang diketik pengguna sendiri tetap dikirim ke provider yang dipilih; UI menjelaskan batas ini.

Mengganti provider/model chat atau Base URL Kustom mereset riwayat percakapan dan usulan lama agar konteks tidak berpindah provider tanpa diketahui pengguna. Request aktif dihentikan sebelum perubahan berlaku. Tidak ada fallback otomatis ke cloud/lokal.

UI persetujuan remote menjelaskan data yang dikirim: pesan, riwayat sesi, nama profil, konteks tugas/tagihan/habit/akun, serta hasil tools yang diizinkan. Menyimpan key tidak otomatis mengubah role ke remote.

## 5. UI

Gunakan artboard Pengaturan sebagai acuan layout. Kartu provider berfungsi, tanpa label Segera setelah provider terimplementasi. Kustom hanya satu slot: nama, Base URL, API key, dan model. Form menyediakan simpan/hapus key, tes koneksi, daftar model, serta pemilihan provider/model per role. Jurnal/email menampilkan lokal terkunci. Jangan tampilkan kontrol yang tidak bekerja.

Seluruh invoke tetap melalui `src/api.ts`. Rust command mengikuti `Result<T, AppError>` dan PIN enforcement existing. Metadata konfigurasi perangkat/secret tidak ikut sync lintas perangkat.

## 6. Acceptance dan verifikasi

- Key dapat disimpan, diganti, dihapus melalui UI; aplikasi restart tetap mengenali key dari keyring.
- Request chat benar-benar menuju provider terpilih; Bearer key benar dan tidak dikembalikan lewat IPC.
- Uji streaming teks, fragmented tool calls, hasil tool baca, proposal tulis, persetujuan/penolakan, cancel, error HTTP dan SSE untuk setiap kontrak provider.
- Uji nyata chat + tools terhadap OpenAI, Anthropic compatibility, Gemini compatibility, OpenRouter, dan Kustom sebelum menyatakan provider terverifikasi. Tanpa credential yang diizinkan pengguna, laporkan provider belum diuji nyata; jangan klaim parity berdasarkan fake server.
- Regresi privasi: jurnal/email dan tugas salinan jurnal tidak muncul dalam payload prompt/tools cloud; ringkasan jurnal tetap lokal meskipun recap remote.
- URL HTTP non-loopback ditolak; redirect tidak membocorkan key; perubahan URL Kustom tidak memakai key lama.
- UI Xvfb: simpan/test/select/reset/error dan state role privat; DB hanya metadata, keyring menyimpan secret.
- Full frontend tests/typecheck, Rust tests/clippy, E2E sesuai workflow repo. PR ber-issue, review, CI dan SonarCloud hijau sebelum merge/release.

## 7. Pembagian PR untuk rencana

1. Kredensial/provider metadata, validasi URL, routing role dan batas privasi.
2. Pengaturan provider/model, integrasi lifecycle percakapan, smoke end-to-end dan dokumentasi.

Detail langkah, issue dan test konkret ditulis dalam rencana setelah review spec. Implementasi menunggu persetujuan pindah dari planning ke kode.

## 8. Referensi

- Spec Fase 5: `2026-10-01-anchoa-fase5-asisten-design.md`, C1–C6.
- OpenAI: https://platform.openai.com/docs/api-reference/chat/completions
- Anthropic compatibility: https://docs.anthropic.com/en/api/openai-sdk
- Gemini compatibility: https://ai.google.dev/gemini-api/docs/openai
- OpenRouter tools: https://openrouter.ai/docs/guides/features/tool-calling
