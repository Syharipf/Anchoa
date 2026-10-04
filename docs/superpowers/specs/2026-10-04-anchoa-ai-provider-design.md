# Anchoa — AI Kustom / 9router

Tanggal: 2026-10-04
Status: user menyetujui fokus 9router lokal; rencana implementasi menunggu persetujuan kode.

## 1. Cakupan

Ollama tetap tersedia. Tambahkan tepat satu konfigurasi Kustom OpenAI-compatible untuk 9router: nama, Base URL, API key opsional, tes koneksi, daftar model dan ID model manual, pemilihan provider/model per role. Target awal `http://127.0.0.1:20128/v1`; `/v1/models` telah merespons HTTP 200, belum bukti chat/tools. OpenAI, Anthropic, Gemini, dan OpenRouter langsung ditunda; jangan aktifkan kartu mereka atau menambah transport native. Suara/avatar tidak berubah.

## 2. Transport dan konfigurasi

Gunakan klien HTTP `assistant/llm.rs` yang sudah ada: POST `{base}/chat/completions`, streaming SSE, tool calls, Authorization Bearer jika key tersedia. Daftar model Kustom memakai GET `{base}/models`, Ollama tetap `/api/tags`. Listing gagal tidak menghapus pilihan model; ID manual tersedia. Tes koneksi membedakan auth, jaringan, quota/rate limit, respons invalid; jangan memasukkan body error provider mentah atau secret ke pesan error. Model tidak mendukung tools berarti error jelas, bukan tools dibuang diam-diam. Tidak ada fallback provider otomatis.

Rust menyimpan secret melalui keyring OS existing; settings hanya metadata dan role. Secret tidak masuk IPC hasil, log, DB, backup, sync, issue. UI input kosong saat dibuka; simpan metadata tidak menghapus key. Ganti/hapus key eksplisit. Keyring gagal berarti operasi gagal, tanpa plaintext fallback. Kustom boleh tanpa key untuk server loopback yang tidak memerlukan auth.

Rust memvalidasi URL absolut: HTTPS, atau HTTP hanya host `localhost`, `127.0.0.1`, `[::1]`. Tolak userinfo/query/fragment/scheme lain/host kosong/port invalid; normalisasi trailing slash. Matikan redirect untuk request berkredensial sehingga key tidak berpindah origin atau downgrade. Perubahan URL menghapus key lama sebelum metadata baru dipakai. Kegagalan tidak boleh menghasilkan key lama dikirim ke URL baru.

## 3. Routing, lifecycle, privasi

`chat` dan `recap` boleh Kustom. `journal` dan `email` hanya Ollama, divalidasi di Rust juga saat membaca settings tampered. Semua request produksi memakai endpoint role aktual, bukan default Ollama yang mengabaikan pilihan pengguna. Endpoint injection test tidak menjadi bypass produksi. DB mutex dilepas sebelum jaringan/keyring.

`journal_weekly_summary` saat ini menggunakan `recap`; pindahkan ke `journal` dan endpoint lokal eksplisit. Jangan mengirim jurnal tujuh hari ke rekap cloud. Audit semua pemakai recap: jika tidak ada rekap harian yang berjalan, jangan membuat fitur rekap baru atau mengklaim fitur itu aktif.

Prompt chat dan tools read tidak boleh menyertakan jurnal/email atau salinan jurnal menjadi tugas. Audit system_prompt/today_overview/search_items/list_tasks serta hasil apply. Untuk chat Kustom, keluarkan add_journal_entry dari definitions; propose dan apply juga menolak di Rust. Guard bukan sekadar UI. Pengguna yang mengetik sendiri data sensitif ke chat remote tetap mengirimnya; jelaskan di UI.

Perubahan provider/model chat, URL Kustom, atau key membatalkan request aktif dan mereset history serta usulan pending sebelum konfigurasi berlaku. Request tidak boleh menambahkan history/usulan kembali setelah reset; gunakan lifecycle cancellation/generation existing atau minimum guard yang diperlukan. Proposal lama tidak bisa diterapkan lewat ID lama. Jangan mengekspor percakapan lokal ke cloud saat berganti provider.

UI menjelaskan data dikirim ke Kustom: pesan dan riwayat sesi, nama profil, konteks tugas/tagihan/habit/akun, hasil tools yang diizinkan. Simpan konfigurasi tidak otomatis mengganti role. Metadata perangkat tidak ikut sync.

## 4. UI

Pertahankan artboard layout Pengaturan. Ollama dan Kustom aktif; provider resmi tetap diberi label belum tersedia. Kustom: nama, Base URL, input password key opsional, simpan metadata, ganti/hapus key, tes koneksi, daftar model dan ID manual. Role chat/recap memilih provider/model; journal/email lokal terkunci. Status key hanya tersedia/tidak, bukan mask yang berasal dari secret. Semua invoke melalui src/api.ts; command tunduk PIN enforcement existing.

## 5. Acceptance

- Restart aplikasi mempertahankan metadata/role/keyring key; tidak ada secret di DB/IPC/log.
- Chat menuju 9router terpilih; SSE teks dan fragmented tool calls berfungsi, baca tools, proposal tulis, approve/reject, cancel.
- Error auth, server offline, malformed response, model tanpa tools jelas tanpa fallback atau kebocoran key.
- Error URL HTTP non-loopback; redirect tidak membawa key; URL baru tidak memakai key lama.
- Remote prompt/tools tidak memuat jurnal/email/tugas turunan jurnal; add_journal_entry remote ditolak; ringkasan jurnal lokal meski recap Kustom.
- Switch/reset di tengah request tidak membawa history/proposal lama ke konfigurasi baru.
- Smoke nyata 9router chat+tools wajib sebelum klaim selesai; memakai key hanya setelah user memasukkan melalui UI. Jangan mengekstrak kredensial 9router dari file konfigurasi. Permintaan smoke dapat memakai endpoint lokal tanpa key jika server mengizinkan.
- Verifikasi UI nyata pada Xvfb, DB metadata dan secret status; full tests/typecheck/Rust tests/clippy, E2E/review/CI/SonarCloud sesuai workflow repo.

## 6. Referensi

- Fase 5 C1–C6: `2026-10-01-anchoa-fase5-asisten-design.md`.
- Kontrak OpenAI-compatible: https://platform.openai.com/docs/api-reference/chat/completions
