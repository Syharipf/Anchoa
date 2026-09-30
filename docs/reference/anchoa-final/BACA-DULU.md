> **Catatan repo Anchoa (2026-09-30).** Isi `anchoa-final.zip` dipindah ke sini sebagai referensi. Stack SvelteKit + Supabase di paket ini tidak dipakai; aturan yang berlaku ada di `CLAUDE.md` root repo. Perubahan saat dipindah:
> - `anchoa-app/docs/design/` ada di `docs/design/` (dipakai langsung).
> - `CLAUDE.md` di tiap folder menjadi `CLAUDE.asli.md` supaya tidak ikut terbaca Claude Code.
> - `.claude/commands/` menjadi `commands/`, `.github/workflows/` menjadi `workflows/`, dan `docs/` tiap folder diratakan. Salinan ganda `ARCHITECTURE.md` dan diagram hanya disimpan sekali, di folder ini.

# Anchoa — paket final

- `ARCHITECTURE.md` + `arsitektur-anchoa.png` — arsitektur final: Supabase (tanpa server Go), 2 repo, file di laptop via Tailscale + SFTP, email & unduhan di perangkat.
- `anchoa-app/` — bekal repo aplikasi (Tauri 2 + SvelteKit). Mulai dari `anchoa-app/README-MULAI.md`.
- `anchoa-supabase/` — bekal repo backend (migrasi, RLS, pgTAP, Edge Functions). Mulai dari `anchoa-supabase/README-MULAI.md`.

Urutan yang disarankan:
1. `anchoa-app` Fase 0 (uji Live2D & performa) — tidak butuh Supabase.
2. `anchoa-supabase` Fase A–B sambil `anchoa-app` Fase 1–2 (UI dengan data mock).
3. `anchoa-app` Fase 3 dan seterusnya (tersambung ke Supabase).
