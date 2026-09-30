# Prompt siap pakai untuk Claude Code

Tips umum:
- Jalankan `claude` dari folder root proyek (yang berisi `CLAUDE.md`).
- Tekan **Shift+Tab** untuk masuk *plan mode* di awal tiap fase: Claude membuat rencana dulu, kamu setujui, baru menulis kode.
- Ketik `/clear` di antara fase supaya konteks tetap ringan (CLAUDE.md tetap terbaca otomatis).
- Commit git setelah setiap fase lolos.
- Perintah pintas yang sudah disiapkan: `/fase <nomor>`, `/cek-desain <halaman>`, `/cek-keamanan`.

---

## 0. Pesan pertama (orientasi)

```
Baca CLAUDE.md, docs/ARCHITECTURE.md, docs/design/DESIGN.md, dan docs/ROADMAP.md.
Jangan menulis kode dulu. Ringkas pemahamanmu tentang Anchoa dalam 10 poin,
cek apakah scaffold sekarang sudah sesuai aturan di CLAUDE.md (adapter-static,
fallback index.html, ssr = false, Svelte 5), lalu tulis rencana Fase 0.
```

## Fase 0 — Spike

```
/fase 0
```
atau manual:
```
Kerjakan Fase 0 di docs/ROADMAP.md. Cubism Core ada di static/live2d/core/
dan contoh model di static/live2d/models/. Buat halaman /spike sesuai daftar
tugasnya, lalu beri tahu aku cara mengukur FPS/CPU/RAM di Linux dan Android.
Setelah aku kirim angkanya, tulis docs/spike-report.md.
```

## Fase 1 — Fondasi

```
/fase 1
```
Tambahan yang berguna:
```
Acuan tampilan: @docs/design/screenshots/Main.png dan
@docs/design/screenshots/CommandPalette.png. Detail ukuran & state:
@docs/design/artboards/CommandPalette.dc.html dan @docs/design/artboards/NotifPanel.dc.html.
```

## Fase 2 — Dashboard & asisten

```
/fase 2
```
```
Acuan: @docs/design/screenshots/Main.png dan @docs/design/artboards/Main.dc.html
(bagian aside = panel asisten, bagian main = bento rekap). Pakai data mock dulu.
```

## Fase 3 — Tersambung ke Supabase

Pastikan Supabase lokal menyala dari repo `anchoa-supabase` (`supabase start`) dan Fase A–B di sana sudah selesai. Lalu jalankan Claude Code dengan:
```
claude --add-dir ../anchoa-supabase
```
```
/fase 3
Skema & policy ada di ../anchoa-supabase/supabase/migrations. Jangan ubah
skema dari repo ini; kalau butuh kolom baru, tulis usulan migrasinya dulu.
```

## Setelah membuat halaman apa pun

```
/cek-desain jadwal
```

## Sebelum menutup fase yang menyentuh Rust

```
/cek-keamanan
```

## Kalau jendela app kosong di Linux (NVIDIA)

```
Jendela Tauri kosong/putih di Fedora dengan GPU NVIDIA. Cek langkah di
https://v2.tauri.app/develop/debug/linux-graphics/ satu per satu, mulai dari
WEBKIT_DISABLE_DMABUF_RENDERER=1 untuk dev lokal saja. Catat yang berhasil di docs/spike-report.md.
```
