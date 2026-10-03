# Anchoa Fase 9a Sync: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementasi oleh task role `Coder` (satu task per run). Review oleh task role `reviewer`.

**Goal:** sync local-first ke Supabase, terenkripsi end-to-end, hemat ruang, siap dipakai HP nanti.

**Architecture:**
- SQLite lokal tetap sumber kebenaran.
- Trigger mencatat perubahan ke outbox.
- Engine di Rust melakukan pull dan push record terenkripsi lewat REST Supabase, memakai `ureq`.
- Konflik diselesaikan dengan LWW per record.
- Server hanya menyimpan ciphertext, dilindungi RLS.

**Tech Stack:** Rust (`chacha20poly1305`, `argon2`, `miniz_oxide`, `keyring`, `ureq`), Supabase Postgres + PostgREST + GoTrue + pg_cron + pgTAP, React.

**Spec:** `docs/superpowers/specs/2026-10-02-anchoa-sync-design.md` (S1–S13, §3–§7).

## Global Constraints

**Aturan umum**
- Semua aturan di `CLAUDE.md` berlaku. Frontend hanya lewat `src/api.ts`.

**Dependency baru**
- Hanya `chacha20poly1305` (RustCrypto), plus `miniz_oxide` dan `zeroize` (keduanya sudah ada di lockfile, sekarang jadi dependency langsung). Semuanya disebut di body PR.
- Tanpa OpenSSL, tanpa `supabase-js`.

**Rahasia**
- Frasa sandi, recovery key, DEK, access token, dan refresh token tidak pernah masuk DB, log, error message, atau `Debug`. Tidak pernah dikirim ke frontend, kecuali recovery key satu kali saat dibuat.
- Service role key tidak ada di app, repo, maupun CI.

**Batas dan aturan sync**
- Batas: 256 KB ciphertext per record, 500 baris per RPC, kuota klien bawaan 400 MB, tombstone 90 hari.
- Konstanta Supabase dibaca dari `option_env!("ANCHOA_SUPABASE_URL")` dan `option_env!("ANCHOA_SUPABASE_ANON_KEY")` saat build. Di build debug, env runtime dengan nama sama boleh menimpanya. Kalau keduanya kosong, kartu Sync menampilkan "Sync belum dikonfigurasi di build ini".
- Test tidak butuh jaringan: trait `SyncServer` dengan implementasi palsu. `ANCHOA_FAKE_SYNC=<file>` hanya berlaku di `cfg(debug_assertions)`.
- Saat app terkunci PIN, semua command `sync_*` ditolak oleh guard yang sudah ada. Sync latar ikut berhenti.

**Rilis**
- Nama rilis: "Anchoa v0.18.0 — Sync terenkripsi".

| PR | Task |
|---|---|
| S-1 | 1–2 |
| S-2 | 3 |
| S-3 | 4–5 |
| S-4 | 6–7 |

### Task 1: Keystore bersama dan kriptografi

**Files:**
- Create: `src-tauri/src/keystore.rs`, `src-tauri/src/sync/mod.rs`, `src-tauri/src/sync/crypto.rs`
- Modify: `src-tauri/src/email/account.rs`, sehingga `KeyringStore` pindah ke `keystore.rs` dan email memakai wrapper tipis tanpa mengubah perilaku atau pesan errornya
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`

**Interfaces (produces):**
- `keystore::KeyringStore { get(&self, user: &str) -> Result<Option<String>, AppError>, set(&self, user: &str, secret: &str), delete(&self, user: &str) }`, dengan `with_builder` untuk mock.
- `sync::crypto`:
  - `Dek` (32 byte, `Zeroize` saat drop, tanpa `Debug`);
  - `RecoveryKey` (16 byte; `display()` → `XXXX-XXXX-…`, 8 grup base32 Crockford; `parse(&str)` mengabaikan spasi, tanda hubung, dan huruf besar/kecil);
  - `Kdf { m_kib: u32, t: u32, p: u32, salt: [u8; 16] }`, default m = 64 MiB, t = 3, p = 1;
  - `wrap(dek, kek) -> Vec<u8>` dan `unwrap(blob, kek) -> Result<Dek, AppError>`;
  - `kek_from_passphrase(&str, &Kdf) -> Result<[u8; 32], AppError>` dan `kek_from_recovery(&RecoveryKey) -> [u8; 32]` (HKDF-SHA256 atau SHA-256 dari key + label tetap);
  - `seal(dek, aad: &[u8], plain: &[u8]) -> Vec<u8>` (nonce 24 byte ‖ ciphertext);
  - `open(dek, aad, blob) -> Result<Vec<u8>, AppError>`;
  - `aad(user_id: &str, record_id: &str, changed_at: i64, device_id: &str) -> Vec<u8>`.

**Test:**
- round trip `seal` dan `open`;
- AAD dengan id, versi, atau user lain → `open` gagal;
- satu byte ciphertext diubah → gagal;
- frasa sandi salah → `unwrap` gagal dengan `AppError::Invalid("Frasa sandi sync salah")`;
- recovery key: parse dari `display()`, dan input yang salah ditolak;
- `Debug` dan pesan error tidak memuat byte rahasia;
- test email yang ada tetap lulus.

### Task 2: Migrasi 012, trigger, dan record

**Files:**
- Create: `src-tauri/migrations/012_sync.sql`, `src-tauri/src/sync/record.rs`
- Modify: `src-tauri/src/db.rs` (daftar migrasi, plus test upgrade v11 → v12)
- Modify: `src-tauri/src/habits.rs`, supaya kolom `habit_checks.updated_at` baru diisi saat centang, batal, dan centang ulang

**Interfaces (produces):**
- Tabel `sync_state`, `sync_outbox`, `sync_pending`, `sync_versions` sesuai spec §4.
- Trigger `AFTER INSERT/UPDATE/DELETE` pada `items` (hanya tipe di S6), tabel ekstensi S6, dan `habit_checks`, dengan `WHEN (SELECT value FROM sync_state WHERE key='applying')='0'`.
  - Trigger ekstensi memakai `record_id` = `item_id` induk.
  - `changed_at` dihitung dengan `CAST(unixepoch('subsec') * 1000 AS INTEGER)`.
- `sync::record`:
  - `SYNCED_TYPES: &[&str]`;
  - `Record { id: String, changed_at: i64, deleted: bool, payload: Option<Vec<u8>> }` (plaintext JSON yang sudah dikompresi deflate);
  - `export(conn, record_id) -> Result<Option<Record>, AppError>`;
  - `apply(conn, &Record) -> Result<Applied, AppError>`, dengan `Applied::{Done, NeedsParent(String), NewerSchema}`, dijalankan di dalam `applying = 1`;
  - `enqueue_all(conn)` untuk pemetaan pertama;
  - `MAX_RECORD_BYTES = 262_144`.
- `apply` menghitung ulang `links` dan menjaga `items_fts` lewat trigger yang sudah ada.

**Test:**
- Setiap jalur tulis memasukkan record ke outbox, termasuk:
  - hapus habit di `habits.rs`;
  - centang dan batal habit;
  - ubah ekstensi saja (status tugas, jumlah transaksi);
  - hapus lunak.
- Tipe di luar S6 (email, activity, download) tidak masuk outbox.
- Saat `applying = 1`, outbox tetap kosong.
- `export` lalu `apply` ke DB kosong menghasilkan baris yang identik untuk setiap tipe.
- Kolom lokal saja (`opened_at`, `projects.agent*`) tidak ikut.
- Induk belum ada → `NeedsParent`.
- `schema` lebih baru → `NewerSchema`.
- Record lebih dari 256 KB → `AppError::Invalid`, dengan pesan yang menyebut judulnya.
- Upgrade dari v11 mempertahankan data.

**Penutup PR S-1:** `cargo test`, clippy, `bun run typecheck`, `bun run test`, dan E2E penuh `PASS`. E2E `check_db` mengharapkan `user_version` 12.

### Task 3: Server Supabase

**Files:**
- Create: `supabase/config.toml`, `supabase/migrations/20261002000000_sync.sql`, `supabase/tests/sync.test.sql`
- Modify: `.github/workflows/ci.yml` (job `supabase` di `ubuntu-24.04`: `supabase/setup-cli`, `supabase start`, `supabase test db`, `supabase db lint`)

**Isi:**
- Tabel `vault` dan `records` sesuai spec §5.
- RLS aktif dengan policy `user_id = auth.uid()` untuk select, insert, dan update.
- Sequence `records_seq`. Trigger `before insert or update` mengisi `seq = nextval(...)` dan `updated_at = now()`.
- RPC, semuanya `security invoker` dan `set search_path = ''`:
  - `push_records(rows jsonb) returns jsonb`: tolak lebih dari 500 baris; upsert hanya kalau `(changed_at, device_id)` lebih baru; kembalikan `{"rejected":[{id, changed_at, device_id}]}`;
  - `pull_records(after bigint, max int) returns setof records`, dengan `max` maksimal 500;
  - `usage() returns table(rows bigint, bytes bigint)`;
  - `delete_my_data() returns void`.
- `pg_cron` harian: `delete from records where deleted and updated_at < now() - interval '90 days'`.
- `grant execute` hanya untuk `authenticated`. `revoke all` dari `anon` dan `public`.

**Test pgTAP:**
- dua pengguna: A tidak bisa membaca, mengubah, atau menimpa baris B, baik lewat tabel maupun RPC;
- `anon` tidak bisa memanggil RPC apa pun;
- LWW: versi lama ditolak, versi baru diterima, tie-break `device_id`;
- `payload` lebih dari 256 KB ditolak;
- `pull` berurutan menurut `seq` dan menghormati `max`;
- `delete_my_data` hanya menghapus milik sendiri.

**Penutup PR S-2:** job CI `supabase` hijau. App tidak berubah.

### Task 4: Engine sync

**Files:**
- Create: `src-tauri/src/sync/server.rs` (trait + klien HTTP), `src-tauri/src/sync/fake.rs`, `src-tauri/src/sync/engine.rs`

**Interfaces (produces):**
- `trait SyncServer: Send + Sync`:
  - `authorize_url(provider: Provider, redirect: &str, code_challenge: &str, state: &str) -> String`, `exchange_code(code: &str, code_verifier: &str) -> Session`, `refresh(&Session) -> Session`, `sign_out(&Session)`;
  - `get_vault(&Session) -> Option<Vault>`, `put_vault(&Session, &Vault)`;
  - `push(&Session, &[WireRecord]) -> Vec<Rejected>`, `pull(&Session, after: i64, max: u32) -> Vec<WireRecord>`;
  - `usage(&Session) -> Usage`, `delete_my_data(&Session)`.
- `Provider::{Google, GitHub}` (query `provider=google|github`).
- `Session { user_id, email, access_token, refresh_token, expires_at }` (tanpa `Debug` pada token).
- `sync/oauth.rs`: `begin(server, provider) -> Result<OAuthFlow, AppError>` (PKCE S256: verifier 32 byte acak, `state` 32 byte acak, listener `std::net::TcpListener` di `127.0.0.1:0`) dan `OAuthFlow::wait(timeout) -> Result<Session, AppError>` (hanya menerima `GET /callback?code=…&state=…` dengan `state` yang cocok; request lain dijawab 404 dan tidak menghentikan listener; satu callback valid lalu listener ditutup; batas waktu 5 menit; halaman balasan statis "Login berhasil, kembali ke Anchoa" tanpa script). Browser dibuka lewat opener yang sudah ada.
- `WireRecord { id, changed_at, device_id, deleted, payload: Option<Vec<u8>>, seq }`.
- `HttpServer` memakai `ureq`:
  - auth lewat GoTrue `/auth/v1/authorize`, `/auth/v1/token?grant_type=pkce|refresh_token`, `/auth/v1/user`, dan `/auth/v1/logout`;
  - data lewat PostgREST `/rest/v1/rpc/<name>` dan `/rest/v1/vault`;
  - header `apikey` dan `Authorization: Bearer`; `bytea` dikirim sebagai hex `\x…`.
- `MemoryServer` (untuk test) dan `FileServer` (SQLite bersama, untuk E2E dua instance) menerapkan aturan RLS dan LWW yang sama dengan server asli.
- `engine::sync_once(db, keystore, server, now) -> Result<SyncReport, AppError>`:
  - pull (dekripsi, LWW terhadap `sync_versions`, `apply`, `sync_pending` dicoba ulang) → push outbox (seal, batas kuota) → record yang ditolak di-pull ulang;
  - DB tidak dipegang selama panggilan server;
  - `changed_at` keluar tidak pernah lebih kecil dari versi terakhir yang diterima + 1.
- `SyncReport { pulled, pushed, pending, bytes_used, quota_bytes, stopped_by_quota: bool }`.

**Test (dua klien, satu `MemoryServer`):**
- buat di A → muncul di B;
- ubah di A dan B, versi lebih baru menang di kedua sisi;
- hapus vs ubah;
- anak datang sebelum induk → `pending`, lalu diterapkan setelah induk datang;
- kuota penuh → push berhenti, pull tetap jalan, `stopped_by_quota`;
- server menukar payload antar-record → `open` gagal, record ditolak, sync lanjut untuk record lain;
- token kedaluwarsa → `refresh` sekali, lalu berhasil;
- OAuth: `state` salah, path salah, dan request tanpa `code` ditolak tanpa menutup listener; callback valid menghasilkan sesi; timeout → error; `code_challenge` = base64url(SHA-256(verifier)); URL authorize hanya memakai `redirect_to` ke `127.0.0.1`;
- server tidak terjangkau → error jelas, outbox utuh;
- DB tidak dipegang saat panggilan server (`is_unlocked_for_test`).

### Task 5: Command, jadwal, dan API

**Files:**
- Create: `src-tauri/src/sync/commands.rs`
- Modify: `src-tauri/src/lib.rs` (registrasi dan state), `src/api.ts`

**Interfaces (produces):**
- Command:
  - `sync_status() -> SyncStatus { configured, signed_in, email, last_sync_at, last_error, bytes_used, quota_bytes, needs_unlock_key }`;
  - `sync_sign_in(provider: "google" | "github")`: membuka browser dan menunggu callback (async, bisa dibatalkan lewat `sync_cancel_sign_in`);
  - `sync_create_key(passphrase) -> { recovery_key }`, hanya kalau `vault` belum ada; frasa sandi minimal 12 karakter;
  - `sync_unlock_key(passphrase_or_recovery)`;
  - `sync_change_passphrase(old, new)`;
  - `sync_now() -> SyncReport`;
  - `sync_sign_out(delete_cloud: bool)`.
- Jadwal latar: sync saat start (setelah unlock PIN), saat jendela kembali fokus, setiap 60 detik selama jendela aktif (5 menit di latar), dan 2 detik setelah outbox berubah (debounce). Tidak berjalan saat terkunci, belum login, atau DEK belum ada. Satu sync aktif dalam satu waktu.
- Event `sync-changed` ke frontend setelah pull menerapkan record, supaya halaman memuat ulang.
- Wrapper `src/api.ts`: `syncStatus`, `syncSignIn`, `syncCancelSignIn`, `syncCreateKey`, `syncUnlockKey`, `syncChangePassphrase`, `syncNow`, `syncSignOut`, dan `onSyncChanged`.

**Test:**
- urutan status: belum login → login → perlu kunci → siap (dengan server palsu yang melewati browser);
- `sync_create_key` kedua ditolak;
- frasa sandi pendek ditolak;
- `sync_sign_out(false)` menghapus token dan DEK dari keyring tapi data lokal tetap;
- `sync_sign_out(true)` juga memanggil `delete_my_data`;
- command ditolak saat terkunci;
- wrapper `api.ts` memakai nama dan argumen yang benar.

**Penutup PR S-3:** semua check dan E2E penuh `PASS`.

### Task 6: UI Sync

**Files:**
- Create: `src/settings/SyncSection.tsx`, `src/settings/SyncSection.test.tsx`
- Modify: `src/settings/view.ts` (bagian "Sinkron & data"), `src/profile/ProfilePage.tsx`, `src/App.tsx` (memuat ulang data saat `sync-changed`)

**Isi:**
- Kartu Sync dengan langkah-langkahnya:
  1. Akun: tombol "Masuk dengan Google" dan "Masuk dengan GitHub", status "Menunggu login di browser…" dengan tombol Batal.
  2. Kunci:
     - perangkat pertama: frasa sandi dua kali, lalu recovery key ditampilkan dalam kotak mono dengan tombol Salin dan centang "Sudah saya simpan" sebelum lanjut;
     - perangkat berikutnya: frasa sandi atau recovery key.
  3. Status: terakhir sync, error, bar pemakaian `x MB dari 400 MB`, serta tombol "Sinkronkan sekarang", "Ganti frasa sandi", dan "Matikan sync" (dialog dengan centang "Hapus juga data di cloud").
- Teks penjelasan singkat: login Google/GitHub ≠ frasa sandi sync; lupa frasa sandi dan recovery key berarti salinan cloud tidak bisa dibuka; data lokal tetap aman.
- Profil: baris status Sync.
- Token tema, `Readonly<>` props, dan aturan SonarCloud. Tanpa duplikasi dengan `EmailSection`; kalau polanya sama, ambil komponen bersama.

**Test komponen:** setiap langkah; recovery key hanya tampil sekali dan hilang setelah lanjut; error dari backend tampil; tombol nonaktif saat sibuk.

### Task 7: E2E dan versi 0.18.0

- `check_sync` di `scripts/e2e-smoke.sh`, dengan dua instance (data dir berbeda) dan `ANCHOA_FAKE_SYNC=$WORK/sync.db`:
  1. Instance A: "Masuk dengan Google" (server palsu langsung memberi sesi tanpa browser), buat kunci dengan frasa sandi tetap dari skrip, lalu centang "Sudah saya simpan". Pastikan recovery key tidak ada di DB A.
  2. Buat tugas "Tugas sync" di A, lalu Sinkronkan.
  3. Instance B: "Masuk dengan GitHub" ke akun yang sama, buka kunci dengan frasa sandi, Sinkronkan. Tugasnya harus ada di DB B.
  4. Ubah status di B, lalu sync di B dan A. Status baru harus ada di A.
  5. Hapus di A. `deleted_at` harus terisi di B.
  6. Di `sync.db` server palsu, payload tidak memuat "Tugas sync" dalam bentuk teks.
- **Review keamanan wajib sebelum rilis:** task role `reviewer` (read-only), memakai tabel §11 "Model ancaman" di spec sebagai checklist baris per baris. Setiap baris harus punya bukti (test atau kode). Temuan diverifikasi lalu diperbaiki sebelum merge.
- Versi 0.18.0 dan status di `CLAUDE.md`. README dan MANUAL mendapat bagian Sync, dengan bagian Privasi diperbarui.
- **Langkah user sebelum rilis:**
  - buat proyek Supabase (region Singapura);
  - buat OAuth Client Google dan OAuth App GitHub, isi di Supabase › Authentication › Providers, dan batasi redirect ke `http://127.0.0.1:*/callback` (spec §8);
  - `supabase link` lalu `supabase db push`;
  - berikan URL dan anon key untuk build rilis, lewat GitHub secrets `ANCHOA_SUPABASE_URL` dan `ANCHOA_SUPABASE_ANON_KEY` yang dipakai `dnf-repo.yml`/build.

  Tanpa langkah ini, rilis tetap jalan dengan kartu "Sync belum dikonfigurasi".

## Menjalankan task

- Task 3 butuh Docker atau Podman untuk `supabase start`. Kalau tidak tersedia di laptop, cukup verifikasi lewat job CI.
