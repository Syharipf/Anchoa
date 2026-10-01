# Anchoa — backend (repo `anchoa-supabase`)

Backend Anchoa sepenuhnya di **Supabase**: Postgres + Row Level Security, Auth, Realtime, Edge Functions (Deno/TypeScript), pg_cron.
Tidak ada server lain. Aplikasi (repo `../anchoa-app`) hanya memakai URL + anon/publishable key; keamanan data **sepenuhnya** bergantung pada RLS di repo ini.

Dokumen wajib: `docs/ARCHITECTURE.md` (+ `docs/arsitektur-anchoa.png`), `docs/ROADMAP.md`.

## Perintah

```bash
supabase start                 # stack lokal (Docker); `supabase status` untuk URL & key lokal
supabase stop
supabase migration new <nama>  # buat file migrasi baru
supabase db reset              # terapkan ulang semua migrasi + seed.sql di lokal
supabase db lint               # cek kesalahan skema/fungsi
supabase test db               # jalankan test pgTAP di supabase/tests/
supabase functions new <nama>
supabase functions serve       # jalankan Edge Functions lokal
deno lint supabase/functions && deno test supabase/functions
# prod (lewat CI, bukan manual):
supabase link --project-ref <ref>
supabase db push
supabase functions deploy --project-ref <ref>
supabase secrets set NAMA=nilai
```
Setelah skema berubah, tipe untuk app dibuat di repo app: `npm run gen:types` (lihat `../anchoa-app/CLAUDE.md`).

Sebelum menyatakan tugas selesai: `supabase db reset`, `supabase db lint`, `supabase test db`, dan (jika menyentuh fungsi) `deno lint` + `deno test` harus lolos.

## Struktur

```
supabase/
  config.toml
  migrations/            # 0001_…sql, satu perubahan per file; JANGAN mengubah migrasi yang sudah diterapkan
  tests/                 # *.test.sql (pgTAP), satu file per tabel/fitur
  seed.sql               # data contoh untuk lokal saja
  functions/
    _shared/             # cors.ts, auth.ts (klien dengan JWT pengguna), ratelimit.ts, validate.ts
    ai-gateway/          # satu pintu ke LLM/STT/TTS
    github-sync/         # isi tabel contributions
    rekap-harian/        # buat notifikasi rekap
    kirim-push/          # FCM (opsional)
docs/
.github/workflows/       # ci.yml (test), deploy.yml (prod)
```

## Aturan skema (wajib untuk setiap tabel data pengguna)

```sql
create table public.<nama> (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- kolom domain …
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index on public.<nama> (user_id);
alter table public.<nama> enable row level security;
create policy "<nama>_select_own" on public.<nama> for select to authenticated using (user_id = (select auth.uid()));
create policy "<nama>_insert_own" on public.<nama> for insert to authenticated with check (user_id = (select auth.uid()));
create policy "<nama>_update_own" on public.<nama> for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "<nama>_delete_own" on public.<nama> for delete to authenticated using (user_id = (select auth.uid()));
create trigger <nama>_updated_at before update on public.<nama> for each row execute function public.set_updated_at();
```
- **RLS aktif di semua tabel `public`.** Tidak ada policy `using (true)` untuk data pengguna. Role `anon` tidak mendapat akses ke data pengguna.
- Uang = `bigint` (rupiah utuh). Tanggal = `date`/`timestamptz`. Status = `text` + `check (...)` atau enum.
- Tabel yang ditulis oleh fungsi/cron (mis. `notifications`, `contributions`) tetap punya policy select milik sendiri; penulisan dari fungsi memakai service role **di dalam fungsi saja**.
- Tabel yang perlu realtime ditambahkan ke publication `supabase_realtime` secara eksplisit di migrasi.

## Aturan test (pgTAP)

Setiap tabel punya test yang membuktikan: pemilik bisa select/insert/update/delete miliknya; pengguna lain **tidak** bisa membaca atau mengubahnya; `anon` tidak bisa apa-apa.
Pola mensimulasikan pengguna di test:
```sql
set local role authenticated;
set local request.jwt.claims to '{"sub": "00000000-0000-0000-0000-000000000001"}';
```
(Atau pakai helper test Supabase/basejump bila sudah dipasang.)

## Aturan Edge Functions

- Deno + TypeScript, `verify_jwt = true` di `config.toml` (kecuali fungsi yang hanya dipanggil cron — lindungi dengan secret header).
- Akses DB atas nama pengguna memakai klien dengan **JWT pengguna** (RLS tetap berlaku). **Service role** hanya bila benar-benar perlu, tidak pernah dikembalikan ke klien.
- Validasi input (mis. zod), batasi ukuran body, rate limit per pengguna, timeout ke layanan luar.
- Rahasia server (token GitHub, FCM) hanya lewat `supabase secrets set` / `supabase/functions/.env` lokal (tidak di-commit). **Kunci API AI milik pengguna** disimpan di Supabase Vault lewat `ai-config`; tidak ada endpoint yang mengembalikan kunci utuh. Jangan pernah di-log.
- CORS: izinkan origin aplikasi Tauri & dev lokal saja (`tauri://localhost`, `http://tauri.localhost`, `http://localhost:1420`), bukan `*`.
- `ai-gateway` punya antarmuka provider yang bisa ditukar (⚑ provider AI dipilih pengguna).

## Cara kerja

1. Baca fase di `docs/ROADMAP.md`. Rencana singkat dulu (tabel, kolom, policy, test). Item ⚑ tunggu keputusan pengguna.
2. Perubahan skema = migrasi baru + test pgTAP di commit yang sama.
3. Jalankan pemeriksaan, centang ROADMAP, beri tahu pengguna untuk menjalankan `npm run gen:types` di repo app bila skema berubah.
4. Jangan pernah mengubah prod secara manual lewat dashboard; semua lewat migrasi & CI.
