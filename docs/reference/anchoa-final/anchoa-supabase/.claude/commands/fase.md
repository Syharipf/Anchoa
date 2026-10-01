---
description: Kerjakan satu fase dari docs/ROADMAP.md (contoh: /fase A)
argument-hint: <huruf fase>
---

Kerjakan **Fase $ARGUMENTS** dari `docs/ROADMAP.md`.

1. Baca `CLAUDE.md`, bagian Fase $ARGUMENTS di `docs/ROADMAP.md`, dan `docs/ARCHITECTURE.md`.
2. Tulis rencana singkat: tabel/kolom/policy/fungsi yang akan dibuat, file migrasi & test yang akan ditulis, dan item ⚑ yang butuh keputusanku. **Tunggu persetujuan.**
3. Kerjakan per item. Setiap perubahan skema = migrasi baru + test pgTAP. Setelah tiap item jalankan: `supabase db reset`, `supabase db lint`, `supabase test db`; jika menyentuh fungsi: `deno lint` + `deno test`.
4. Centang item yang selesai di `docs/ROADMAP.md`.
5. Tutup dengan ringkasan: yang selesai, yang belum, apakah repo app perlu `npm run gen:types`, dan apakah semua poin **Selesai jika** terpenuhi.

Jangan lompat ke fase berikutnya. Jangan menyentuh proyek Supabase cloud.
