# Arsitektur Anchoa (final)

Diagram: `arsitektur-anchoa.png` / `.svg`.

## Keputusan

| # | Keputusan | Alasan singkat |
|---|---|---|
| 1 | **Hybrid kecil: cloud hanya untuk data, sisanya lokal** | HP harus bisa membuka tugas/jadwal/keuangan saat laptop mati. Yang berat & privat tetap di perangkat. |
| 2 | **Supabase** sebagai backend | Postgres + Auth + Row Level Security + Realtime + Edge Functions + pg_cron dalam satu layanan. Postgres standar → tidak terkunci (bisa self-host atau pindah nanti). |
| 3 | **Tanpa server Go** (untuk sekarang) | Supabase sudah menutup kebutuhan backend. Logika sisi server yang sedikit (AI, sinkron GitHub, rekap, push) cukup di Edge Functions (TypeScript). Server Go = satu layanan lagi untuk di-host, diamankan, dan dirawat. |
| 4 | **2 repo**: `anchoa-app` dan `anchoa-supabase` | Batasnya jelas: aplikasi vs database/fungsi. Kontraknya = skema database → tipe TypeScript hasil `supabase gen types`. |
| 5 | **File tetap di laptop**, HP akses lewat **Tailscale + SFTP** | Tidak ada file besar di cloud; Tailscale hanya untuk jalur ini. |
| 6 | **Email & unduhan berjalan di perangkat** | Password IMAP tidak disimpan di cloud; yt-dlp/torrent di server cloud boros bandwidth dan sering melanggar ketentuan hosting. |

**Kenapa bukan yang lain**
- **Neon**: hanya Postgres (+ auth terkelola). API, logika, dan fungsi harus server sendiri → kembali butuh Go + hosting.
- **Firebase**: Firestore (NoSQL) kurang pas untuk data relasional (proyek→tugas, akun→transaksi), lock-in tinggi, Cloud Functions wajib paket Blaze.

**Kapan Go layak ditambahkan nanti:** ada job berat/lama yang tidak cocok untuk Edge Functions, atau ingin keluar dari Supabase. Karena datanya Postgres standar, server Go bisa ditambahkan belakangan tanpa migrasi data.

## Siapa mengerjakan apa

| Bagian | Isi |
|---|---|
| **Anchoa App** (Tauri 2 + SvelteKit + Rust) — Linux, Android, Windows | UI, klien Supabase (`supabase-js`), dan Rust lokal: mikrofon/TTS, Berkas + klien SFTP, IMAP/SMTP, yt-dlp + ffmpeg, torrent (opsional, default mati), cache offline |
| **Supabase** | Auth · Postgres + RLS · Realtime · Edge Functions (`ai-gateway`, `github-sync`, `rekap-harian`, `kirim-push`) · pg_cron · Storage (opsional, lampiran kecil) |
| **Laptop** | Menjalankan Anchoa App + `sshd` (SFTP, chroot, key-only) sebagai tempat file utama |
| **Layanan luar** | API AI (LLM/STT/TTS) & GitHub API — dipanggil **hanya** dari Edge Functions; FCM untuk push Android (opsional) |

## Aliran utama

1. **Baca/tulis data**: App → `supabase-js` (HTTPS + JWT) → Postgres. RLS memastikan hanya baris milik pengguna.
2. **Sinkron antar perangkat**: perubahan di Postgres → Realtime (WebSocket) → semua perangkat yang terbuka.
3. **Asisten**: mikrofon → STT (lokal di desktop, atau lewat `ai-gateway`) → `ai-gateway` memanggil LLM dengan API key yang tersimpan di Supabase → hasil (mis. tugas baru) ditulis ke Postgres → Realtime.
4. **File**: HP → Tailscale → SFTP laptop (daftar, pratinjau bertahap, simpan ke HP).
5. **Terjadwal**: pg_cron → `rekap-harian`, `github-sync` → hasil disimpan di tabel → muncul di Dashboard.

## Skema data awal (semua di schema `public`)

Setiap tabel: `id uuid primary key default gen_random_uuid()`, `user_id uuid not null references auth.users on delete cascade`, `created_at`, `updated_at`, `deleted_at` (soft delete, memudahkan cache offline nanti), **RLS aktif** dengan policy `user_id = auth.uid()`.

| Tabel | Catatan |
|---|---|
| `profiles` | nama, preferensi suara, zona waktu |
| `devices` | perangkat terdaftar (untuk cabut akses & push token) |
| `projects`, `tasks` | tugas: status (`plan`/`doing`/`done`), `start_date`, `due_date`, `project_id` (nullable = tugas pribadi) |
| `events` | acara kalender non-tugas |
| `accounts`, `transactions`, `bills` | uang disimpan sebagai `bigint` rupiah (tanpa desimal/float) |
| `notes` | Catatan/Inbox; opsi isi terenkripsi di perangkat |
| `notifications` | dibuat oleh fungsi/cron, dibaca app |
| `contributions` | cache heatmap dari `github-sync` |
| `settings` | pengaturan per pengguna (JSONB) |

## Keamanan

- **RLS di setiap tabel, default menolak.** Setiap policy punya test pgTAP (baca/tulis milik sendiri boleh, milik orang lain ditolak).
- `anon`/publishable key boleh ada di app (memang publik); **service role key hanya di Edge Functions**, tidak pernah di app atau repo.
- API key AI & token GitHub: `supabase secrets set`, hanya dibaca Edge Functions.
- Edge Functions memverifikasi JWT dan membatasi laju per pengguna.
- Data sangat sensitif (mis. isi catatan tertentu) bisa dienkripsi di perangkat sebelum dikirim — konsekuensi: tidak bisa dicari di server.
- Token sesi di perangkat: penyimpanan aman OS (Keystore di Android, keyring di desktop).
- **Backup sendiri**: jangan mengandalkan paket gratis — GitHub Actions terjadwal menjalankan `pg_dump`, dienkripsi (mis. `age`), disimpan di lokasi privat. Uji restore berkala.

## Lingkungan

| | Dev | Prod |
|---|---|---|
| Supabase | lokal: `supabase start` (Docker/Podman) | proyek cloud (paket gratis; dijeda setelah 7 hari tanpa aktivitas, DB 500 MB) |
| App | `npm run tauri dev` → Supabase lokal | build rilis → Supabase cloud |
| Rahasia | `.env.local` (tidak di-commit) | `supabase secrets` & GitHub Secrets |

## Repo & CI

**`anchoa-supabase`**: `supabase/migrations/*.sql`, `supabase/tests/*.sql` (pgTAP), `supabase/functions/*`, `supabase/seed.sql`, `config.toml`.
CI: `supabase db start` → `supabase db lint` → `supabase test db` → lint/test Deno. Deploy (branch `main`): `supabase db push` + `supabase functions deploy`.

**`anchoa-app`**: Tauri 2 + SvelteKit. Tipe database di `src/lib/api/database.types.ts` hasil `supabase gen types` (di-commit).
CI: `svelte-check`, `cargo clippy`, `cargo test`, `cargo audit`, build Linux & Android.

Bekerja lintas repo di Claude Code: dari `anchoa-app`, jalankan `claude --add-dir ../anchoa-supabase`.

## Performa & kapasitas

- **Region Supabase: Singapura** (terdekat dari Indonesia).
- **Cache baca di perangkat** sejak app tersambung ke Supabase: tampilkan data terakhir dari cache lokal secara instan, lalu perbarui dari Supabase di latar belakang; perubahan perangkat lain masuk lewat Realtime. Antrean tulis saat offline menyusul belakangan.
- **Ambil seperlunya**: kolom yang dipakai saja, rentang tanggal yang terlihat, pagination, index untuk query utama.
- **Kapasitas**: hanya data teks terstruktur yang masuk Supabase (perkiraan: 10.000 tugas ≈ 3–5 MB, 50.000 transaksi ≈ 20–25 MB) — jauh di bawah 500 MB paket gratis. File, email, unduhan, dan audio tidak disimpan di Supabase.
- **Pembersihan otomatis (pg_cron)**: notifikasi yang sudah dibaca > 90 hari, log `ai_usage` > 60 hari, baris soft delete > 30 hari dihapus permanen. Ukuran DB dipantau di dashboard.

## Jalur berkembang

1. **Sekarang**: desktop + Supabase + Tailscale/SFTP.
2. **Android**: codebase sama; tambah push (FCM) bila perlu.
3. **Offline penuh**: antrean aksi saat offline di atas cache lokal (memanfaatkan `updated_at`/`deleted_at`).
4. **Beban naik / butuh job panjang**: tambah server Go terpisah yang terhubung ke Postgres yang sama.
5. **Keluar dari Supabase** (jika perlu): self-host Supabase, atau Postgres (mis. Neon) + server sendiri — skema & data tetap.
