# Anchoa Fase 9a — Sync terenkripsi ke Supabase

Tanggal: 2026-10-02
Status: disetujui user 2026-10-02 14:56 ("lanjut, merge kalau sudah hijau"). Keputusan user 2026-10-02 13:09–13:10:
- tujuan sync adalah menyiapkan HP (Android menyusul), diuji dengan dua instance Fedora;
- hanya data terstruktur;
- semua data dienkripsi end-to-end;
- Supabase tidak boleh penuh.

Detail lain diputuskan Claude saat user pergi. Daftarnya ada di §9 dan bisa diubah.

## 1. Ringkasan

Sampai v0.17.0 semua data hanya ada di SQLite laptop. Fase 9a menambahkan sync ke Supabase supaya perangkat kedua (nanti HP) bisa memakai data yang sama.

Bentuknya **local-first**:
- SQLite di setiap perangkat tetap menjadi sumber kebenaran dan sekaligus cache penuh;
- Supabase hanya menjadi kotak surat terenkripsi berisi versi terakhir setiap record;
- app tetap bekerja penuh tanpa jaringan, dan sync berjalan saat ada koneksi.

Ini kebalikan dari `docs/reference/anchoa-final/ARCHITECTURE.md`, yang menjadikan Supabase sumber utama. Arah itu tidak dipakai, karena kode sekarang sudah local-first dan user memilih enkripsi penuh. Dengan enkripsi penuh, server memang tidak bisa membaca atau meng-query data.

Fase 9 lain menyusul sebagai spec terpisah: Windows, Android, lokasi "Laptop" di Berkas lewat Tailscale + SFTP, dan CI multi-platform.

## 2. Keputusan

| Kode | Keputusan | Alasan |
|---|---|---|
| S1 | **Local-first.** SQLite lokal tetap sumber kebenaran. Supabase menyimpan satu baris per record, isinya versi terakhir (upsert), tanpa riwayat. | Supabase tidak tumbuh karena riwayat. App tetap jalan offline. Tidak perlu mengubah modul yang ada. |
| S2 | **Enkripsi end-to-end untuk semua isi.** Server hanya melihat: `user_id`, id record, versi (waktu ubah + id perangkat), status hapus, ukuran ciphertext, dan nomor urut server. Judul, isi, jumlah uang, tipe item, dan relasi ada di dalam ciphertext. | Pilihan user. DB atau key Supabase yang bocor tidak membuka isi. |
| S3 | **Kriptografi.** Isi record dienkripsi dengan XChaCha20-Poly1305 (crate `chacha20poly1305`, RustCrypto) memakai kunci data (DEK) acak 256-bit dan nonce acak 192-bit per enkripsi. AAD = `user_id ‖ record_id ‖ version`, sehingga server tidak bisa menukar ciphertext antar-record atau antar-versi tanpa ketahuan. | AEAD mapan dengan nonce panjang, jadi nonce acak aman. Murni Rust, tanpa OpenSSL. |
| S4 | **Kunci.** DEK dibungkus dua kali dan keduanya disimpan di tabel `vault` server: (a) oleh KEK dari frasa sandi sync lewat Argon2id (crate `argon2` yang sudah dipakai PIN; salt dan parameter disimpan di `vault`), dan (b) oleh recovery key acak 128-bit yang ditampilkan sekali sebagai 8 grup base32. Di perangkat, DEK disimpan di keyring (`service = io.github.syharipf.anchoa`, `user = sync-dek:<user_id>`). Frasa sandi tidak pernah disimpan. | Perangkat baru cukup login lalu memasukkan frasa sandi. Kalau frasa sandi lupa, recovery key membuka. Kalau keduanya hilang, salinan cloud tidak bisa dibuka, tapi data lokal tetap aman. |
| S5 | **Akun: hanya login Google atau GitHub** (keputusan user 2026-10-02 16:13), lewat Supabase Auth OAuth dengan PKCE. Tidak ada email + password. Desktop memakai redirect loopback (RFC 8252): Rust membuka listener sekali pakai di `127.0.0.1` dengan port acak, membuka browser sistem ke `/auth/v1/authorize?provider=google\|github&redirect_to=<URL-encoded http://127.0.0.1:<port>/callback?state=<state>>&code_challenge=…&code_challenge_method=s256` dengan `state` acak di dalam `redirect_to` (GoTrue menambahkan `code` atau `error`/`error_description` ke redirect ini, bukan menggemakan `state` tingkat atas), lalu menukar `code` lewat `/auth/v1/token?grant_type=pkce`. Android memakai deep link di fase Android. Satu pengguna per akun; Supabase menggabungkan Google dan GitHub dengan email yang sama. Access dan refresh token disimpan di keyring. Login dan frasa sandi sync adalah dua hal berbeda; UI menjelaskan bedanya. | Tanpa password akun yang bisa bocor. Login saja tidak cukup untuk membaca data; tetap perlu frasa sandi. Tanpa dependency baru (listener memakai `std::net`). |
| S6 | **Yang disinkron** (dari §3 di bawah): item `task`, `project`, `account`, `transaction`, `bill`, `budget`, `habit`, `note` (Jurnal), dan `page` (Catatan), beserta baris tabel ekstensinya; ditambah `habit_checks`. **Tidak disinkron:** `email`, `activity` (log agen), unduhan, berkas, `contributions`, `github_sync`, `settings`, dan semua rahasia (token GitHub, App Password, hash PIN, DEK). `links` dan `items_fts` dihitung ulang di setiap perangkat. | Data terstruktur saja (keputusan user). Rahasia tidak pernah keluar dari keyring perangkat. |
| S7 | **Deteksi perubahan dengan trigger SQLite**, bukan lewat `updated_at`. Trigger `AFTER INSERT/UPDATE/DELETE` pada `items` dan setiap tabel ekstensi yang disinkron menulis `record_id` dan waktu ubah ke `sync_outbox`. UPDATE hanya dicatat kalau nilai kolom yang disinkron berubah (`old.col IS NOT new.col`); perubahan `items.updated_at` saja dan kolom lokal tidak dicatat. Trigger tidak aktif saat perubahan datang dari sync (flag `sync_state.applying`). | Tidak semua jalur tulis memperbarui `items.updated_at` (contoh: hapus habit di `habits.rs`). Trigger menangkap semua jalur tulis di satu tempat, sekarang maupun nanti. |
| S8 | **Konflik: last-writer-wins per record.** Versi = `(changed_at ms, device_id)`, dibandingkan secara leksikografis, dan berlaku sama di server maupun di klien. Soft delete item dan habit check tetap dikirim sebagai record biasa (`deleted = false`), dengan baris lengkap dan `deleted_at` asli di dalam payload. Hanya baris yang sudah tidak ada secara lokal tetapi masih di outbox menjadi tombstone (`deleted = true`), dengan dokumen tombstone terenkripsi dan payload yang tidak pernah null. Mengubah dan menghapus record yang sama di dua perangkat berakhir dengan versi yang lebih baru. | Payload lengkap mempertahankan relasi, pengelompokan sampah subtree halaman, dan restore. Pemakaian satu orang di dua perangkat jarang bentrok di record yang sama. Merge per kolom ditunda sampai benar-benar dibutuhkan. |
| S9 | **Hemat ruang (cache) supaya Supabase tidak penuh:** satu baris per record (S1); isi dikompresi (deflate, crate `miniz_oxide`) sebelum dienkripsi; batas 256 KB ciphertext per record (halaman Catatan yang lebih besar tetap lokal dan diberi peringatan); batas dekompresi 8 MiB di klien; hanya tombstone (`deleted = true`) dihapus permanen oleh pg_cron setelah 90 hari, bukan record biasa yang soft-deleted; perangkat yang 90 hari tidak sync melakukan sync penuh ulang; batas kuota di klien, default 400 MB dari 500 MB paket gratis. Saat batas tercapai push berhenti, muncul notifikasi, dan pull tetap jalan. Pemakaian tampil di Pengaturan › Sync. | Perkiraan: 10.000 tugas dan 50.000 transaksi setelah kompresi dan enkripsi masih di bawah 50 MB. Batas klien mencegah DB penuh tanpa disadari. |
| S10 | **Transport:** Rust memanggil REST Supabase (GoTrue untuk auth, PostgREST RPC untuk data) lewat `ureq` + rustls yang sudah ada. Tanpa `supabase-js`, karena frontend tetap tidak menyentuh jaringan data (aturan arsitektur). Sync berjalan saat app dibuka, saat jendela kembali difokuskan, setiap 60 detik selama jendela aktif (5 menit saat di latar), 2 detik setelah tulisan terakhir (debounce), dan dari tombol "Sinkronkan sekarang". Setiap siklus memeriksa `vault`, menyegarkan `usage`, dan memanggil `pull_records` kecil. Tanpa Realtime di fase ini. | Perubahan muncul di perangkat lain dalam hitungan detik sampai satu menit, tanpa koneksi WebSocket permanen. Realtime bisa ditambah nanti kalau perlu instan. |
| S11 | **Server di repo yang sama**, folder `supabase/`: migrasi SQL, test pgTAP, dan `config.toml`. Bukan repo kedua. | Modular monolith, satu repo. Kontraknya kecil (2 tabel, 4 RPC). |
| S12 | **Test tanpa Supabase cloud.** Rust memakai trait `SyncServer` dengan implementasi asli (HTTP) dan palsu (memori). Build debug punya `ANCHOA_FAKE_SYNC=<file>`: server palsu berbasis file SQLite bersama, sehingga dua instance di Xvfb bisa saling sync. pgTAP untuk RLS dan RPC berjalan di CI dengan `supabase start`. | Seperti `ANCHOA_FAKE_MAIL`. CI tidak butuh kredensial. |
| S13 | **Kunci PIN** tetap berlaku: command sync ditolak saat terkunci, dan sync latar berhenti saat terkunci. | Konsisten dengan K-1. |

## 3. Model record

- **Satu record = satu item beserta baris ekstensinya**, diserialisasi ke JSON: `{"item": {...kolom items...}, "ext": {...kolom tabel ekstensi...}, "schema": <versi migrasi DB>}`.
  - `record_id` = `items.id`.
  - Kolom lokal saja tidak ikut: `items.opened_at`, kolom `projects.agent*`, dan kolom cache email.
- **`habit_checks`** jadi record sendiri dengan `record_id = "hc:" + habit_id + ":" + date`. Migrasi 012 menambahkan `updated_at` ke tabel itu supaya waktu ubahnya tercatat.
- **Urutan menerapkan record dari server:** induk dulu, yaitu record yang dirujuk lewat `parent_id`, `project_id`, `account_id`, atau `habit_id`. Record yang induknya belum ada ditahan di `sync_pending` sampai induknya datang.
- **Versi skema:** perangkat dengan `schema` lebih lama dari record yang diterima menyimpan record itu di `sync_pending` dan menampilkan "Perbarui Anchoa untuk sync". Record tidak pernah ditimpa dengan skema lama.

## 4. Lokal (migrasi 012)

- `sync_state(key, value)` berisi:
  - `device_id` (UUIDv7, dibuat sekali);
  - `user_id`;
  - `cursor` (nomor urut server terakhir);
  - `applying` (0/1);
  - `last_sync_at`;
  - `quota_bytes`;
  - `bytes_used` (pemakaian terakhir, disegarkan setiap sync);
  - `vault_fingerprint` (SHA-256 hex dari blob `dek_by_passphrase` yang terakhir dibuka);
  - `last_error` dan `warning:<record_id>` untuk peringatan ukuran per record.
- `sync_outbox(record_id PRIMARY KEY, changed_at)`: diisi oleh trigger.
- `sync_pending(record_id PRIMARY KEY, version, payload)`: record yang menunggu induk atau versi skema yang lebih baru.
- `sync_versions(record_id PRIMARY KEY, version)`: versi terakhir yang diketahui per record, dipakai untuk LWW di klien.
- Trigger per tabel di S6, dengan `WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'`.
- **Pemetaan pertama:** saat sync dinyalakan, semua record yang disinkron masuk ke outbox.

## 5. Server (`supabase/migrations`)

```sql
create table vault (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  kdf jsonb not null,                -- {"alg":"argon2id","m":..,"t":..,"p":..,"salt":"base64"}
  dek_by_passphrase bytea not null,  -- nonce || ciphertext
  dek_by_recovery bytea not null,
  created_at timestamptz not null default now()
);

create table records (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  id text not null check (length(id) <= 80),
  changed_at bigint not null,
  device_id uuid not null,
  deleted boolean not null default false,
  payload bytea not null check (octet_length(payload) <= 262144),  -- encrypted document, including tombstones
  seq bigint not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index records_seq on records (user_id, seq);
```

- **Payload selalu ada:** soft delete item dan habit check memakai `deleted = false`, dengan baris lengkap (termasuk ekstensi item dan `deleted_at`) dikompresi lalu dienkripsi. Klien menerapkan `deleted_at` persis dari payload, tidak menggantinya dengan `changed_at`.
- **Tombstone hanya untuk baris lokal yang hilang tetapi masih di outbox:** `deleted = true` dan payload berisi dokumen `{"schema": N, "tombstone": true, "id": "<record id>"}` yang dikompresi lalu dienkripsi dengan AEAD dan AAD record yang sama. Klien menolak tombstone tanpa payload, dokumen yang bukan tombstone, atau id yang berbeda. Tombstone valid hanya melakukan soft delete lokal dengan `deleted_at = COALESCE(deleted_at, changed_at)`, tidak pernah hard delete.
- **RLS aktif** di kedua tabel dan menolak secara default. Policy: `user_id = auth.uid()` untuk select, insert, dan update. Tanpa policy delete; penghapusan hanya lewat RPC.
- **`push_records(rows jsonb)`** (`security invoker`):
  - menerima paling banyak 500 baris per panggilan;
  - upsert hanya kalau `(changed_at, device_id)` lebih baru dari yang tersimpan;
  - mengisi `seq` dari sequence global;
  - mengembalikan id yang ditolak beserta versi server-nya.
- **`pull_records(after bigint, max int)`:** record dengan `seq > after`, diurutkan menurut `seq`, paling banyak 500.
- **`usage()`:** jumlah baris dan `sum(octet_length(payload))` milik pengguna.
- **`delete_my_data()`:** menghapus `records` dan `vault` milik pengguna.
- **pg_cron harian:** hanya menghapus tombstone (`deleted = true`) yang `updated_at`-nya lebih dari 90 hari. Record biasa yang memuat soft delete tetap disimpan.
- **Batas server:** `payload` paling besar 256 KB, `id` paling panjang 80 karakter, batas laju bawaan Supabase, dan pemeriksaan JWT bawaan PostgREST.
- **Key di app:** hanya URL proyek dan publishable/anon key, yang memang publik. Service role key tidak ada di app, di repo, maupun di CI.

## 6. Alur

1. **Nyalakan sync** (Pengaturan › Sync):
   - klik "Masuk dengan Google" atau "Masuk dengan GitHub" → browser → kembali ke app (S5);
   - kalau `vault` belum ada: buat frasa sandi sync (minimal 12 karakter) → buat DEK → tampilkan recovery key sekali → user mencentang "Sudah saya simpan" → simpan `vault`;
   - kalau `vault` sudah ada (perangkat kedua): masukkan frasa sandi atau recovery key → buka DEK → simpan di keyring.
2. **Siklus sync:**
   - pull dari `cursor` → dekripsi → LWW terhadap `sync_versions` → terapkan dalam transaksi dengan `applying = 1` → majukan `cursor`;
   - lalu push isi outbox per 500 baris → id yang ditolak di-pull ulang;
   - DB lokal tidak dipegang selama panggilan jaringan (pola sama dengan email).
3. **Matikan sync:** hapus token dan DEK dari keyring. Data lokal tetap ada. Opsi "Hapus juga data di cloud" memanggil `delete_my_data()`.
4. **Ganti frasa sandi:** bungkus ulang DEK dengan KEK baru. Isi record tidak perlu dienkripsi ulang.

## 7. UI

**Pengaturan › Sync**, kartu baru:
- status: mati / tersambung sebagai `<email>` / terakhir sync `<waktu>` / error;
- bar pemakaian `x MB dari 400 MB`;
- tombol "Sinkronkan sekarang", "Ganti frasa sandi", dan "Matikan sync";
- langkah awal: tombol "Masuk dengan Google" dan "Masuk dengan GitHub", lalu penjelasan singkat tentang login, frasa sandi sync, dan recovery key.

Tampil juga sebagai baris status di Profil. Semuanya dengan token tema dan mengikuti aturan SonarCloud. Belum ada artboard untuk ini: tata letak mengikuti kartu Integrasi yang sudah ada.

## 8. Rencana PR

| PR | Isi | Versi |
|---|---|---|
| S-1 | `sync/crypto.rs` (DEK, KEK Argon2id, recovery key, AEAD + AAD), `sync/record.rs` (serialisasi item ↔ record, kompresi, batas ukuran), migrasi 012 (state, outbox, trigger, `habit_checks.updated_at`). Unit test: round trip, AAD diubah gagal, frasa sandi salah gagal, trigger menangkap setiap jalur tulis, termasuk hapus habit. | — |
| S-2 | Folder `supabase/` (migrasi, RLS, RPC, pg_cron) dan test pgTAP: milik sendiri boleh, milik orang lain ditolak, LWW di RPC, batas ukuran. Job CI `supabase start` + `supabase test db`. | — |
| S-3 | `sync/engine.rs`, trait `SyncServer`, klien HTTP (`ureq`), server palsu memori dan file, LWW, `sync_pending`, kuota, jadwal latar, command `sync_*`, wrapper `src/api.ts`. Test dua klien di server palsu: konflik, hapus vs ubah, induk datang belakangan, kuota habis, offline lalu online. | — |
| S-4 | UI Pengaturan › Sync + Profil, E2E `check_sync`: dua instance di Xvfb dengan `ANCHOA_FAKE_SYNC` (buat tugas di A → muncul di B; ubah di B → kembali ke A; hapus). Versi 0.18.0, status di CLAUDE.md, dan README/MANUAL. | 0.18.0 |

**Langkah user** (tidak bisa diotomatiskan):
- membuat OAuth Client (Google Cloud Console, tipe Web application) dan OAuth App (GitHub Developer Settings), dengan callback `https://<ref>.supabase.co/auth/v1/callback`; client ID dan secret diisi di Supabase › Authentication › Providers (secret hanya disimpan di Supabase); di Supabase › URL Configuration, redirect yang diizinkan hanya `http://127.0.0.1:*/callback**`;
- membuat proyek Supabase (region Singapura) dan memberikan URL + anon key, yang disimpan sebagai konstanta build lewat env `ANCHOA_SUPABASE_URL` dan `ANCHOA_SUPABASE_ANON_KEY` saat `bun tauri build`;
- menjalankan `supabase db push` sekali (atau lewat CI dengan secret `SUPABASE_ACCESS_TOKEN`).

## 9. Keputusan tanpa tanya-jawab (Claude, 2026-10-02)

User sedang pergi. Semua ini bisa diubah sebelum kode dimulai:
1. Konflik memakai LWW per record, bukan per kolom (S8).
2. Ada frasa sandi sync terpisah dari PIN dan dari login (S4/S5). PIN tidak dipakai sebagai kunci karena hanya 4–8 digit. Login OAuth tidak menghasilkan rahasia yang bisa dipakai sebagai kunci, karena token diketahui server.
3. Tanpa Realtime; sync berkala dan setelah tulisan (S10).
4. Satu repo dengan folder `supabase/` (S11).
5. Batas kuota klien 400 MB, tombstone dibersihkan setelah 90 hari, dan batas 256 KB per record (S9).
6. Jurnal ikut disinkron, karena semua isi sudah terenkripsi.
7. Settings tidak disinkron dulu. Preferensi per perangkat (suara, GPU, unduhan) memang berbeda antar-perangkat.

## 10. Risiko dan batasan

- **Metadata terlihat server:** jumlah record, ukuran, waktu ubah, dan id UUIDv7 (yang memuat waktu buat). Isi tetap tertutup. Kompresi sebelum enkripsi membocorkan perkiraan panjang isi; risikonya rendah karena penyerang tidak bisa menyisipkan teks ke record pengguna.
- **Server bisa menahan update** (tidak mengirim versi baru), tapi tidak bisa memalsukan atau menukar isi. Ini batas wajar untuk server yang tidak dipercaya.
- **Jam perangkat yang meleset** memengaruhi LWW. Mitigasi: `changed_at` di klien tidak pernah lebih kecil dari versi terakhir yang diterima ditambah 1 ms.
- **Paket gratis Supabase** dijeda setelah 7 hari tanpa aktivitas. Sync otomatis saat app dibuka menjaga proyek tetap aktif selama app dipakai. Kalau proyek dijeda, sync menampilkan error yang jelas dan data lokal tidak terpengaruh.
- **Perangkat tidak sync lebih dari 90 hari:** reset 90 hari hanya mengulang pull dari awal, bukan menghapus data lokal. Tombstone hanya dibuat untuk baris yang sudah hilang secara lokal tetapi masih di outbox; app tidak pernah melakukan hard delete. Soft delete dikirim sebagai record lengkap dan tidak pernah dipangkas. Jadi perangkat yang kembali setelah lebih dari 90 hari hanya dapat melewatkan tombstone langka untuk baris yang hilang tersebut, jika tombstone sudah dibersihkan server.
- **Backup:** backup SQLite harian lokal tetap jadi cadangan utama. Supabase bukan backup karena isinya hanya versi terakhir.
- **Android:** DEK dan token disimpan di Android Keystore; ini perlu plugin atau implementasi sendiri saat fase Android. Format data dan protokol tidak berubah.

## 11. Model ancaman

Keputusan user 2026-10-02 16:13: login hanya Google dan GitHub, dan data harus aman. Tabel ini menjadi checklist review keamanan sebelum rilis (Task 7).

| Ancaman | Perlindungan | Diuji di |
|---|---|---|
| DB Supabase bocor, atau operator/server jahat membaca data | Semua isi record dan tombstone dienkripsi XChaCha20-Poly1305 dengan DEK yang tidak pernah dikirim. Server hanya melihat id, versi, ukuran, dan `seq`. | Task 1 (`seal`/`open`), Task 7 (payload di server palsu tidak memuat teks) |
| Server memalsukan, menukar, atau me-replay isi | AAD = user ‖ record ‖ `changed_at` ‖ device. Tombstone juga membawa payload terenkripsi, jadi hapus palsu ditolak. Versi lebih lama ditolak oleh LWW di klien. | Task 1, Task 2, Task 4 |
| Server mengirim parameter KDF atau payload raksasa (DoS) | Parameter Argon2 dibatasi sesuai default yang dihasilkan (m ≤ 64 MiB, t ≤ 3, p ≤ 4). Ciphertext ≤ 256 KB, hasil dekompresi ≤ 8 MiB, RPC ≤ 500 baris. | Task 1, Task 2 |
| Server menahan update atau menghapus record | Tidak bisa dicegah oleh klien. Dampaknya terbatas pada keterlambatan sync; data lokal dan backup lokal tetap utuh. | — (batasan yang diterima, §10) |
| Pengguna lain di proyek Supabase yang sama | RLS menolak secara default. Policy `user_id = auth.uid()`, RPC `security invoker`, dan `anon` tidak punya akses. | Task 3 (pgTAP dua pengguna) |
| Token akses atau refresh dicuri | Token hanya disimpan di keyring, tidak di DB, log, atau frontend. Tanpa frasa sandi, token hanya bisa membaca ciphertext. "Matikan sync" selalu membersihkan kredensial lokal (keyring & state DB) dan mencoba mencabut sesi di server (`/auth/v1/logout`), dengan peringatan jika pencabutan remote tidak terkonfirmasi. | Task 4, Task 5 |
| Serangan pada callback OAuth (CSRF, kode dicegat, app lain di port yang sama) | PKCE S256 dengan `code_verifier` acak 32 byte; `state` acak 32 byte yang dicocokkan; listener hanya di `127.0.0.1`, port acak dari OS, hanya menerima satu callback dengan path dan `state` yang benar, dan ditutup setelah 5 menit. Kode ditukar langsung oleh Rust; tidak pernah lewat frontend. | Task 4 |
| Phishing atau redirect terbuka | URL authorize dibangun di Rust dari konstanta proyek. `redirect_to` hanya `http://127.0.0.1:<port>/callback?state=<state>`; Rust memvalidasi port, path, dan query state persis. Callback `error` menghentikan login segera. Daftar redirect di Supabase dibatasi ke `http://127.0.0.1:*/callback**`. | Task 4, langkah user |
| Frasa sandi lemah atau ditebak offline dari `vault` | Minimal 12 karakter. Argon2id m = 64 MiB, t = 3. Recovery key 128-bit acak. | Task 1, Task 5 |
| Laptop atau HP dicuri | DEK dan token ada di keyring sistem (Android: Keystore, di fase Android). Kunci PIN app. DB lokal belum terenkripsi; ini menyusul. | — (§10) |
| Kebocoran lewat log atau error | Tipe rahasia tanpa `Debug` dan di-zeroize. Pesan error generik tanpa byte rahasia, tanpa token, tanpa isi record. | Task 1, review keamanan |
| Frontend (XSS) mencuri kunci | Kunci, token, dan frasa sandi tidak pernah dikirim ke frontend. Pengecualian: recovery key satu kali, saat dibuat. | Task 5 |
| Service role key bocor | Tidak ada di app, repo, maupun CI. Migrasi di-push dengan `SUPABASE_ACCESS_TOKEN` milik user. | Task 3, review keamanan |
