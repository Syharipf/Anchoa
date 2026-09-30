# Mulai `anchoa-supabase` dengan Claude Code

Isi paket:

| Isi | Fungsi |
|---|---|
| `CLAUDE.md` | Aturan repo: perintah Supabase CLI, pola tabel + RLS, test pgTAP, aturan Edge Functions. |
| `docs/ARCHITECTURE.md` + `docs/arsitektur-anchoa.png` | Arsitektur final (sama dengan di repo app). |
| `docs/ROADMAP.md` | Fase A–F dengan checklist. |
| `.claude/commands/` | `/fase A`, `/cek-rls`. |
| `.github/workflows/` | Contoh CI (test) dan deploy. |
| `gitignore-tambahan.txt` | Baris untuk `.gitignore`. |

## Langkah 1 — Prasyarat (Fedora)

1. **Docker** untuk stack lokal Supabase (Docker Engine; Podman bisa dipakai tapi kadang bermasalah dengan Supabase CLI). Pastikan user kamu bisa menjalankan `docker ps`.
2. **Supabase CLI**. Supaya perintah `supabase` tersedia di kedua repo, pasang sebagai paket sistem (unduh `.rpm` dari https://github.com/supabase/cli/releases), atau pakai `npx supabase …` di repo ini.
3. **Deno** (untuk lint/test Edge Functions): lihat https://deno.com.

## Langkah 2 — Buat repo

```bash
mkdir anchoa-supabase && cd anchoa-supabase
git init
supabase init
```
Salin **isi** paket ini ke folder tersebut (gabungkan), tambahkan `gitignore-tambahan.txt` ke `.gitignore`, lalu:
```bash
supabase start          # pertama kali mengunduh image, agak lama
supabase status         # catat API URL & anon key → dipakai .env.local di anchoa-app
git add -A && git commit -m "chore: init supabase + bekal proyek"
```

## Langkah 3 — Claude Code

```bash
cd anchoa-supabase
claude
```
Pesan pertama:
```
Baca CLAUDE.md, docs/ARCHITECTURE.md, dan docs/ROADMAP.md. Jangan menulis kode
dulu. Ringkas pemahamanmu, lalu rencanakan Fase A (migrasi, test, CI).
```
Lalu `/fase A`, `/fase B`, dst. Setelah membuat/mengubah tabel: `/cek-rls`.

## Urutan dengan repo app

`anchoa-app` Fase 0–2 bisa jalan duluan (mock). Selesaikan **Fase A–B** di sini sebelum `anchoa-app` Fase 3.
Kalau bekerja dari repo app dan butuh konteks skema: `claude --add-dir ../anchoa-supabase`.

## Produksi (Fase F)

Buat proyek di https://supabase.com, isi GitHub Secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `PROJECT_REF`), dan biarkan `deploy.yml` yang menerapkan migrasi & fungsi. Jangan mengubah skema prod lewat dashboard.
