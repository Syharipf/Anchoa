# Anchoa — aplikasi (repo `anchoa-app`)

Dashboard pribadi dengan asisten suara (STT + TTS) dan avatar Live2D. Modul: Dashboard, Jurnal, Email, Jadwal, Habit, Keuangan, Proyek, Berkas, Unduhan, Profil.
Target: **Linux (utama) → Android → Windows**, satu codebase.

Dokumen wajib:
- `docs/ARCHITECTURE.md` + `docs/arsitektur-anchoa.png` — arsitektur final & pembagian tugas.
- `docs/design/DESIGN.md`, `docs/design/tokens.css`, `docs/design/screenshots/`, `docs/design/artboards/` — desain.
- `docs/agent-integration.md` — integrasi agen kode (Fase 11, opsional).
- `docs/ROADMAP.md` — fase kerja + kriteria selesai. Kerjakan **satu fase pada satu waktu**.
- Repo pasangan: `../anchoa-supabase` (skema database, RLS, Edge Functions). Jalankan Claude Code dengan `claude --add-dir ../anchoa-supabase` bila tugas menyentuh data.

## Stack

- **Tauri 2** (Rust stable) — hanya untuk hal yang harus di perangkat.
- **SvelteKit + Svelte 5 (runes) + TypeScript + Vite**, package manager **npm**.
- **Supabase** (`@supabase/supabase-js`) — auth, data, realtime. Tidak ada server backend lain.
- Live2D: **Cubism SDK for Web** (Core diunduh manual).

## Perintah

```bash
npm run tauri dev                    # jalankan app desktop
npm run check                        # svelte-check + TypeScript
npm run build                        # build frontend
npm run tauri build                  # build installer
npm run gen:types                    # tipe DB dari Supabase lokal → src/lib/api/database.types.ts
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test   --manifest-path src-tauri/Cargo.toml
npm run tauri android init           # sekali saja
npm run tauri android dev            # jalankan di HP/emulator
```

Script `gen:types` di `package.json` (Supabase lokal harus menyala dari repo `anchoa-supabase`):
```json
"gen:types": "supabase gen types --lang=typescript --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres --schema public > src/lib/api/database.types.ts"
```
(Jika flag CLI berubah, cek `supabase gen types --help`. Jika CLI tidak terpasang sebagai paket sistem, jalankan dari repo `anchoa-supabase` dengan `npx supabase gen types … > ../anchoa-app/src/lib/api/database.types.ts`.)

Sebelum menyatakan tugas selesai: `npm run check`, `cargo clippy …`, dan `cargo test …` harus lolos.

## Pembagian tanggung jawab

| Di mana | Apa |
|---|---|
| Supabase (lewat `src/lib/api/`) | login, tugas, proyek, jadwal, habit, keuangan, jurnal (terenkripsi), notifikasi, pengaturan, cache heatmap; realtime; panggilan asisten ke Edge Function `ai-gateway` |
| Rust lokal (`src-tauri/src/commands/`) | Berkas lokal + **klien SFTP** ke laptop (lewat Tailscale), unduhan (yt-dlp/ffmpeg sidecar, torrent opsional), **email IMAP/SMTP**, mikrofon & TTS, penyimpanan rahasia (keyring OS / Android Keystore), cache offline (nanti) |
| Svelte | tampilan & state; tidak mengakses file/jaringan/proses secara langsung selain Supabase |

## Struktur folder (target)

```
src/
  app.css
  lib/
    styles/tokens.css          # salinan docs/design/tokens.css
    api/
      supabase.ts              # satu klien Supabase
      database.types.ts        # hasil gen:types (di-commit)
      tasks.ts, finance.ts …   # fungsi bertipe per domain (satu-satunya tempat query)
      local.ts                 # wrapper invoke() ke command Rust
    components/ shell/ assistant/ ui/ <modul>/
    state/                     # *.svelte.ts (runes)
    mock/                      # data contoh sampai tersambung Supabase
  routes/                      # +layout.ts (ssr=false), +layout.svelte, +page.svelte, email/ jadwal/ …
static/live2d/                 # Cubism Core + model (tidak di-commit)
src-tauri/
  capabilities/default.json    # izin minimal
  src/lib.rs, error.rs, commands/{files,sftp,downloads,email,voice,secrets}.rs
```

## Aturan data & Supabase

- **Semua** query ke Supabase lewat fungsi di `src/lib/api/<domain>.ts` yang memakai `Database` dari `database.types.ts`. Komponen tidak memanggil `supabase.from(...)` langsung.
- App hanya memakai **URL + anon/publishable key** (`PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` di `.env.local`, tidak di-commit). **Service role key tidak pernah ada di repo ini.**
- Keamanan data bergantung pada **RLS** di `anchoa-supabase`. Jangan menambal masalah izin di sisi app — perbaiki policy di repo Supabase.
- Uang = `bigint` rupiah. Format tampilan `Rp 975.000` di UI saja.
- Soft delete: isi `deleted_at`, jangan `delete` langsung (kecuali diminta).
- Langganan Realtime dibuat dan **dibersihkan** di `$effect` (return fungsi unsubscribe).
- **Cache baca**: fungsi di `src/lib/api/` mengembalikan data cache lebih dulu, lalu data segar dari Supabase; komponen tidak tahu soal cache.
- **Jurnal**: isi dienkripsi di perangkat sebelum dikirim (`journal_entries.ciphertext`); jangan pernah menulis isi jurnal ke log, notifikasi, atau `ai-gateway` — kecuali pengguna menekan "Minta tanggapan" untuk entri itu.
- Perubahan skema = kerjakan di `anchoa-supabase` dulu (migrasi + test), lalu `npm run gen:types` di sini.

## Aturan frontend (Svelte)

- **Svelte 5 runes saja**: `$state`, `$derived`, `$effect`, `$props`, `$bindable`. Jangan `export let`, `$:`, atau `on:click` (pakai `onclick`).
- SvelteKit: `@sveltejs/adapter-static` dengan `fallback: 'index.html'`, dan `export const ssr = false;` di `src/routes/+layout.ts`.
- Styling: CSS variables dari `tokens.css` + `<style>` per komponen. Tanpa library UI besar/Tailwind kecuali diputuskan.
- Teks UI **Bahasa Indonesia**; kode & nama file bahasa Inggris.
- Aksesibilitas: elemen asli, `aria-label` untuk tombol ikon, `role="switch"`/`aria-checked`, `aria-pressed`, `aria-live="polite"` untuk status asisten.
- **Performa (wajib):** animasi hanya `transform`/`opacity`; animasi berulang pause saat asisten idle dan saat tab tersembunyi; hormati `prefers-reduced-motion`; tanpa `backdrop-filter`/blur.

## Aturan Rust (Tauri)

- Satu modul per domain di `commands/`; `Result<T, AppError>`; **tanpa `unwrap()`/`expect()`** di jalur command; struct ke frontend `#[serde(rename_all = "camelCase")]`.
- IO berat: async (tokio) / `spawn_blocking`.
- **Keamanan:** capabilities minimal; kanonikalisasi & batasi setiap path; sidecar (yt-dlp, ffmpeg) dengan argumen array, tanpa shell, tolak URL/argumen yang diawali `-`; kredensial IMAP/SFTP & token sesi di keyring OS / Android Keystore, tidak pernah di log atau dikirim ke Supabase.
- Fitur per platform: `#[cfg(target_os = "android")]` / `#[cfg(desktop)]`. Torrent **nonaktif secara default**.
- Tanya dulu sebelum menambah dependensi besar yang tidak disebut di `docs/ROADMAP.md`.

## Tentang `docs/design/artboards/*.dc.html`

Sumber tool desain: pakai untuk struktur, ukuran, warna, logika state. Sintaks `{{…}}`, `<sc-for>`, `<sc-if>`, `<dc-import>`, `<x-dc>`, `<helmet>`, `class Component extends DCLogic` **bukan** kode untuk disalin. Semua data di sana contoh.

## Catatan Linux + NVIDIA

Jendela kosong/putih saat dev: coba `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev` (dev lokal saja; jangan dipasang tanpa syarat di rilis). Lihat https://v2.tauri.app/develop/debug/linux-graphics/

## Cara kerja

1. Baca fase terkait di `docs/ROADMAP.md` + bagian terkait di `DESIGN.md`/`ARCHITECTURE.md`.
2. Rencana singkat dulu, baru kode. Item ⚑ = tunggu keputusan pengguna.
3. Langkah kecil → jalankan pemeriksaan → centang ROADMAP.
4. Tutup dengan ringkasan: selesai, belum, cara menguji, keputusan yang dibutuhkan.
