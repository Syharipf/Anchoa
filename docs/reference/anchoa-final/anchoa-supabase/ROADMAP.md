# Roadmap `anchoa-supabase`

Centang `[x]` saat selesai. **⚑** = butuh keputusan pengguna. Fase A–B harus selesai sebelum Fase 3 di `anchoa-app`.

---

## Fase A — Fondasi

- [ ] `supabase init`; `config.toml` ditinjau (auth email aktif, redirect URL untuk app, `verify_jwt` per fungsi).
- [ ] Migrasi `0001_base.sql`: fungsi `public.set_updated_at()`, tabel `profiles` (pola wajib dari `CLAUDE.md`) + trigger yang membuat profil saat user baru mendaftar.
- [ ] pgTAP aktif (`create extension if not exists pgtap` di test) + test `profiles` (pemilik vs pengguna lain vs anon).
- [ ] `seed.sql` berisi 1 pengguna contoh untuk lokal.
- [ ] `.github/workflows/ci.yml` jalan: `supabase db start` → `supabase db lint` → `supabase test db`.

**Selesai jika:** `supabase db reset && supabase db lint && supabase test db` lolos di lokal dan CI hijau.

---

## Fase B — Skema inti (untuk Fase 3–4 app)

Tabel (semua pakai pola wajib + test pgTAP):
- [ ] `devices` (nama, platform, `last_seen_at`, `push_token` nullable)
- [ ] `projects` (nama, jenis, deskripsi, `deadline date`, `repo_url` nullable)
- [ ] `tasks` (judul, `status` in plan/doing/done, `start_date`, `due_date`, `project_id` nullable → tugas pribadi, `tag`)
- [ ] `events` (acara kalender non-tugas)
- [ ] `accounts` (nama, jenis), `transactions` (`amount bigint`, arah masuk/keluar, kategori, `account_id`, `occurred_at`), `bills` (nama, `amount bigint` nullable, `due_date`, `paid_at`)
- [ ] `notes` (isi teks; ⚑ perlu kolom `ciphertext` untuk catatan terenkripsi di perangkat?)
- [ ] `notifications` (jenis, judul, isi, `href`, `read_at`) — ditulis fungsi, dibaca app
- [ ] `settings` (JSONB per pengguna)
- [ ] `contributions` (tanggal, jumlah) — cache heatmap
- [ ] Foreign key antar tabel **wajib milik user yang sama** (cek di policy/trigger, dan di test).
- [ ] Publication realtime: `tasks`, `notifications`, `transactions`, `bills`.
- [ ] Index untuk query utama (mis. `tasks (user_id, due_date)`).

**Selesai jika:** semua test lolos (termasuk test "pengguna B tidak bisa melihat/mengubah data A"), `db lint` bersih, dan app bisa `npm run gen:types`.

---

## Fase C — Edge Function `ai-gateway`

- [ ] ⚑ Provider AI (LLM, dan opsional STT/TTS) + model.
- [ ] `_shared/`: `cors.ts` (origin Tauri & dev saja), `auth.ts` (klien dengan JWT pengguna), `validate.ts`, `ratelimit.ts` (per pengguna, tabel `ai_usage`).
- [ ] Endpoint: `intent` (teks → aksi terstruktur: buka halaman / tambah tugas / catat transaksi / rekap), `summarize` (ringkas email/teks), opsional `stt`, `tts`.
- [ ] Aksi yang mengubah data dijalankan dengan **JWT pengguna** (RLS berlaku), bukan service role.
- [ ] `deno test` untuk validasi input, rate limit, dan penolakan tanpa JWT.

---

## Fase D — Job terjadwal

- [ ] `github-sync`: ambil kontribusi (GitHub GraphQL `contributionsCollection`) → upsert `contributions`. Token disimpan sebagai secret.
- [ ] `rekap-harian`: buat baris `notifications` berisi rekap (tenggat hari ini, terlambat, tagihan).
- [ ] pg_cron memanggil kedua fungsi (dilindungi secret header), jadwal ⚑ (mis. rekap 07.00 WIB).
- [ ] **Pembersihan otomatis** (pg_cron, SQL murni): hapus `notifications` yang sudah dibaca > 90 hari, `ai_usage` > 60 hari, dan baris dengan `deleted_at` > 30 hari. Test pgTAP untuk fungsi pembersihnya.

---

## Fase E — Push Android (opsional) ⚑

- [ ] `kirim-push` via FCM ke `devices.push_token`; dipicu saat `notifications` baru bertipe penting.

---

## Fase F — Produksi & operasional

- [ ] Buat proyek Supabase cloud di **region Singapura**; simpan `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `PROJECT_REF` di GitHub Secrets.
- [ ] `.github/workflows/deploy.yml`: push ke `main` → `supabase link` → `supabase db push` → `supabase functions deploy`.
- [ ] Backup: workflow terjadwal `pg_dump` → enkripsi (`age`) → simpan di lokasi privat di luar repo. Dokumentasikan & uji **restore** di `docs/backup.md`.
- [ ] Catat batas paket gratis (dijeda setelah 7 hari tanpa aktivitas, DB 500 MB), pantau ukuran DB, dan kapan perlu naik paket.
