# Anchoa — paket final

- `ARCHITECTURE.md` + `arsitektur-anchoa.png` — arsitektur final: Supabase (tanpa server Go), 2 repo, file di laptop via Tailscale + SFTP, email & unduhan di perangkat.
- `anchoa-app/` — bekal repo aplikasi (Tauri 2 + SvelteKit). Mulai dari `anchoa-app/README-MULAI.md`.
- `landing/index.html` — landing page (satu berkas, dua bahasa). Ganti `LINKS` di bagian `<script>` (akun GitHub, portofolio, LinkedIn) dan slot `LOGO` sebelum dipasang, mis. di GitHub Pages.
- `anchoa-supabase/` — bekal repo backend (migrasi, RLS, pgTAP, Edge Functions). Mulai dari `anchoa-supabase/README-MULAI.md`.

Urutan yang disarankan:
1. `anchoa-app` Fase 0 (uji Live2D & performa) — tidak butuh Supabase.
2. `anchoa-supabase` Fase A–B sambil `anchoa-app` Fase 1–2 (UI dengan data mock).
3. `anchoa-app` Fase 3 dan seterusnya (tersambung ke Supabase).
