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
- [ ] `journal_entries` (jenis `ide`/`curhat`/`catatan`, `mood smallint` 1–5 nullable, `tags text[]`, `ciphertext bytea` + `nonce bytea` — judul & isi dienkripsi di perangkat, server tidak bisa membacanya; ⚑ tag ikut dienkripsi atau tidak)
- [ ] `habits` (nama, `days smallint` bitmask Sen–Min, `remind_at time` nullable, `remind_enabled bool`, `auto_source text` nullable mis. `journal`, `archived_at`) dan `habit_logs` (`habit_id`, `day date`, **unique (habit_id, day)**) — streak dihitung dari log + hari terjadwal (view atau fungsi SQL, dengan test pgTAP)
- [ ] `notifications` (jenis, judul, isi, `href`, `read_at`) — ditulis fungsi, dibaca app
- [ ] `settings` (JSONB per pengguna)
- [ ] `contributions` (tanggal, jumlah) — cache heatmap
- [ ] Foreign key antar tabel **wajib milik user yang sama** (cek di policy/trigger, dan di test).
- [ ] Publication realtime: `tasks`, `notifications`, `transactions`, `bills`, `habit_logs`, `journal_entries`.
- [ ] Index untuk query utama (mis. `tasks (user_id, due_date)`).

**Selesai jika:** semua test lolos (termasuk test "pengguna B tidak bisa melihat/mengubah data A"), `db lint` bersih, dan app bisa `npm run gen:types`.

---

## Fase C — Edge Function `ai-gateway`

- [ ] Penyedia dipilih pengguna di app (Anthropic, OpenAI, Google, OpenRouter). Tabel `ai_settings` (provider, model per tugas: intent/summarize/journal/recap; **tanpa kunci**).
- [ ] Edge Function `ai-config`: `set-key` (simpan kunci ke **Supabase Vault** per pengguna; balas hanya 4 karakter terakhir), `test` (permintaan kecil → ok / 401 / 429 / error jaringan + latensi), `models` (daftar model dari API penyedia). Tidak ada endpoint yang mengembalikan kunci utuh. Test pgTAP/deno untuk memastikannya.
- [ ] Ollama lokal **tidak** lewat Supabase (dipanggil app langsung via Tailscale).
- [ ] `_shared/`: `cors.ts` (origin Tauri & dev saja), `auth.ts` (klien dengan JWT pengguna), `validate.ts`, `ratelimit.ts` (per pengguna, tabel `ai_usage`).
- [ ] Endpoint: `intent` (teks → aksi terstruktur: buka halaman / tambah tugas / catat transaksi / centang habit / dikte jurnal / rekap), `summarize` (ringkas email/teks), opsional `stt`, `tts`.
- [ ] Aksi yang mengubah data dijalankan dengan **JWT pengguna** (RLS berlaku), bukan service role.
- [ ] `deno test` untuk validasi input, rate limit, dan penolakan tanpa JWT.

---

## Fase D — Job terjadwal

- [ ] `github-sync`: ambil kontribusi (GitHub GraphQL `contributionsCollection`) → upsert `contributions`. Token disimpan sebagai secret.
- [ ] `rekap-harian`: buat baris `notifications` berisi rekap (tenggat hari ini, terlambat, tagihan, habit yang belum dicentang). Tidak pernah membaca `journal_entries`.
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

---

## Fase G — Agen kode (opsional, untuk Fase 11 app)

Detail: `docs/agent-integration.md`.
- [ ] Tabel `agent_tokens`, `agent_sessions`, `agent_events`, `agent_commands`, `agent_approvals`; kolom `tasks.source`, `tasks.external_ref`. RLS + pgTAP.
- [ ] Edge Function `agent-mcp` (MCP lewat HTTP): auth token hash, scope per proyek, tool `plan_create`, `task_update`, `progress_log`, `test_report`, `task_list`; batas ukuran & filter rahasia; rate limit.
- [ ] Fungsi SQL penulis yang memeriksa proyek ∈ `project_ids` token. Test: token proyek A ditolak di proyek B; token dicabut ditolak; scope kurang ditolak.
- [ ] Realtime: `agent_events`, `agent_commands`, `agent_approvals`.
- [ ] pg_cron: hapus `agent_events` > 90 hari, `agent_commands` kedaluwarsa > 1 jam jadi `expired`.
