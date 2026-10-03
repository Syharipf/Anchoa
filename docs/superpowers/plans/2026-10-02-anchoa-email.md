# Anchoa Fase 8 Email: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementasi oleh task role `Coder` (satu task per run). Review oleh task role `reviewer`.

**Goal:** Gmail lewat IMAP/SMTP dengan App Password di keyring: baca, tandai, arsip, balas, dan tulis. Ringkasan dan saran balasan dari asisten lokal ada di PR terakhir.

**Spec:** `docs/superpowers/specs/2026-10-02-anchoa-email-design.md` (E1–E8).

## Global Constraints

- Semua aturan di `CLAUDE.md` berlaku.
- **Dependency baru**, hanya crate mapan dan rustls-only, disebut di body PR:
  - klien IMAP (`async-imap` dengan `tokio-rustls`, atau `imap` dengan rustls);
  - `lettre` (fitur `rustls-tls`, `smtp-transport`, `builder`, tanpa default `native-tls`);
  - `mail-parser` untuk MIME;
  - `keyring` (Secret Service).
  - Tanpa OpenSSL.
- App Password tidak pernah masuk DB, log, error message, atau frontend setelah `email_connect`.
- HTML tidak pernah dirender. Gambar remote tidak dimuat.
- Test tidak butuh jaringan atau Gmail: trait `MailClient` dengan implementasi palsu, plus mock keyring.
- Nama rilis: "Anchoa v0.16.0 — Email" dan "Anchoa v0.17.0 — Email pintar".

| PR | Task |
|---|---|
| E-1 (#116) | 1–3 |
| E-2 (#117) | 4–5 |
| E-3 (#118) | 6–7 |

### Task 1: Migrasi 011, akun, dan keyring

- Migrasi `011_emails.sql` sesuai spec §3, dengan test upgrade v10 ke v11.
- `email/account.rs`:
  - `connect(address, app_password, client)`: validasi alamat dan App Password (16 huruf, spasi diabaikan), uji login, lalu simpan alamat di `settings` dan password di keyring (`service = "io.github.syharipf.anchoa"`, `user = address`);
  - `disconnect` menghapus keyring dan alamat. Email lokal dihapus lunak.
- **Test:** validasi, kredensial salah tidak disimpan, disconnect menghapus semuanya, dan password tidak muncul di `Debug` atau error.

### Task 2: Klien, sinkron, dan badan

- Trait `MailClient`: `login`, `list_headers(folder, limit)`, `fetch_body(folder, uid)`, `set_flag`, `move_to`, `send(raw)`.
- Implementasi asli memakai IMAP dan SMTP Gmail (spec E2). Implementasi palsu berupa data dalam memori.
- `sync.rs`: upsert header menjadi item dan baris `emails`. Yang hilang dari server dihapus lunak.
- `body.rs`: `text/plain` diutamakan; kalau tidak ada, HTML diubah ke teks dengan pembersih tag dan entity sederhana. Pakai `mail-parser` untuk decoding.
- **Test** dengan klien palsu: sinkron awal, sinkron ulang (update dan hapus lunak), badan teks dan HTML ke teks, serta karakter Indonesia dan encoded-word.

### Task 3: Aksi dan command

- `email_open` mengambil badan kalau belum di-cache lalu menandai dibaca.
- `email_set_flag`, `email_archive`.
- `email_send(draft {to, subject, body, reply_to_id?})`: header balasan diisi, dan salinannya muncul di Terkirim setelah sinkron.
- Command di spec §3 dan wrapper `src/api.ts`.
- `ANCHOA_FAKE_MAIL=1` memakai klien palsu, hanya di build debug (`cfg(debug_assertions)`).
- **Test:** aksi ke klien palsu, dan bahwa DB tidak dipegang selama panggilan klien.
- **Penutup PR E-1:** `cargo test`, clippy, `bun run typecheck`, `bun run test`, dan E2E penuh `PASS`.

### Task 4: UI Email

Halaman tiga kolom, Tulis/Balas, empty state "Sambungkan Gmail" dengan langkah App Password, kartu Email di Pengaturan › Integrasi, dan status di Profil. Tanpa duplikasi, dengan token tema. Aturan SonarCloud.

### Task 5: E2E dan versi 0.16.0

- `check_email` memeriksa dua hal: empty state tanpa akun, dan alur dengan `ANCHOA_FAKE_MAIL=1` (sambungkan, daftar, buka lalu jadi dibaca di DB, bintang, balas).
- Versi 0.16.0 dan status di `CLAUDE.md`.

### Task 6: Asisten untuk email

- Peran `email` di `roles.rs` (lokal saja).
- `email_assist(id)`: ringkasan dan 3 saran balasan dengan JSON terstruktur, ditampilkan di panel "Ringkasan asisten". Satu aksi kontekstual memakai usulan tools yang sudah ada dan tetap harus disetujui.
- Saran balasan mengisi kotak balas, tidak langsung terkirim.

### Task 7: E2E dan versi 0.17.0

`check_email_assist` dengan `scripts/fake-llm.py` yang diperluas: ringkasan tampil, dan aksi menghasilkan usulan.

## Menjalankan task
