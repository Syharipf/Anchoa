---
description: Kerjakan satu fase dari docs/ROADMAP.md (contoh: /fase 1)
argument-hint: <nomor fase>
---

Kerjakan **Fase $ARGUMENTS** dari `docs/ROADMAP.md`.

1. Baca `CLAUDE.md`, bagian Fase $ARGUMENTS di `docs/ROADMAP.md`, dan bagian terkait di `docs/design/DESIGN.md`. Buka screenshot dan artboard yang relevan di `docs/design/`.
2. Tulis rencana singkat: file yang akan dibuat/diubah, dependensi baru (jika ada, jelaskan alasannya dan **tunggu persetujuan**), dan item bertanda ⚑ yang butuh keputusanku.
3. Setelah rencana disetujui, kerjakan item satu per satu. Setelah tiap item: jalankan `npm run check`; jika menyentuh Rust, jalankan juga `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` dan `cargo test --manifest-path src-tauri/Cargo.toml`.
4. Centang item yang selesai di `docs/ROADMAP.md`.
5. Tutup dengan ringkasan: yang selesai, yang belum, cara aku menguji hasilnya (langkah konkret), dan apakah semua poin **Selesai jika** sudah terpenuhi.

Jangan lompat ke fase berikutnya.
