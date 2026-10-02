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
| S5 | **Akun.** Supabase Auth dengan email + password, satu pengguna per akun. Refresh token disimpan di keyring. Password Supabase dan frasa sandi sync adalah dua hal berbeda; UI menjelaskan bedanya. | Login sendiri tidak cukup untuk membaca data; tetap perlu frasa sandi. |
| S6 | **Yang disinkron** (dari §3 di bawah): item `task`, `project`, `account`, `transaction`, `bill`, `budget`, `habit`, `note` (Jurnal), dan `page` (Catatan), beserta baris tabel ekstensinya; ditambah `habit_checks`. **Tidak disinkron:** `email`, `activity` (log agen), unduhan, berkas, `contributions`, `github_sync`, `settings`, dan semua rahasia (token GitHub, App Password, hash PIN, DEK). `links` dan `items_fts` dihitung ulang di setiap perangkat. | Data terstruktur saja (keputusan user). Rahasia tidak pernah keluar dari keyring perangkat. |
| S7 | **Deteksi perubahan dengan trigger SQLite**, bukan lewat `updated_at`. Trigger `AFTER INSERT/UPDATE/DELETE` pada `items` dan setiap tabel ekstensi yang disinkron menulis `record_id` dan waktu ubah ke `sync_outbox`. Trigger tidak aktif saat perubahan datang dari sync (flag `sync_state.applying`). | Tidak semua jalur tulis memperbarui `items.updated_at` (contoh: hapus habit di `habits.rs`). Trigger menangkap semua jalur tulis di satu tempat, sekarang maupun nanti. |
| S8 | **Konflik: last-writer-wins per record.** Versi = `(changed_at ms, device_id)`, dibandingkan secara leksikografis, dan berlaku sama di server maupun di klien. Record yang dihapus menjadi tombstone. Mengubah dan menghapus record yang sama di dua perangkat berakhir dengan versi yang lebih baru. | Pemakaian satu orang di dua perangkat jarang bentrok di record yang sama. Merge per kolom ditunda sampai benar-benar dibutuhkan. |
| S9 | **Hemat ruang (cache) supaya Supabase tidak penuh:** satu baris per record (S1); isi dikompresi (deflate, crate `miniz_oxide`) sebelum dienkripsi; batas 256 KB ciphertext per record (halaman Catatan yang lebih besar tetap lokal dan diberi peringatan); tombstone dihapus permanen oleh pg_cron setelah 90 hari; perangkat yang 90 hari tidak sync melakukan sync penuh ulang; batas kuota di klien, default 400 MB dari 500 MB paket gratis. Saat batas tercapai push berhenti, muncul notifikasi, dan pull tetap jalan. Pemakaian tampil di Pengaturan › Sync. | Perkiraan: 10.000 tugas dan 50.000 transaksi setelah kompresi dan enkripsi masih di bawah 50 MB. Batas klien mencegah DB penuh tanpa disadari. |
| S10 | **Transport:** Rust memanggil REST Supabase (GoTrue untuk auth, PostgREST RPC untuk data) lewat `ureq` + rustls yang sudah ada. Tanpa `supabase-js`, karena frontend tetap tidak menyentuh jaringan data (aturan arsitektur). Sync berjalan saat app dibuka, setiap 5 menit selama app terbuka, setelah setiap tulisan (debounce 10 detik), dan dari tombol "Sinkronkan sekarang". Tanpa Realtime di fase ini. | Satu jalur kode, mudah dites, dan cukup untuk dua perangkat. Realtime bisa ditambah nanti. |
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
  - `quota_bytes`.
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
  payload bytea check (octet_length(payload) <= 262144),  -- null when deleted
  seq bigint not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index records_seq on records (user_id, seq);
```

- **RLS aktif** di kedua tabel dan menolak secara default. Policy: `user_id = auth.uid()` untuk select, insert, dan update. Tanpa policy delete; penghapusan hanya lewat RPC.
- **`push_records(rows jsonb)`** (`security invoker`):
  - menerima paling banyak 500 baris per panggilan;
  - upsert hanya kalau `(changed_at, device_id)` lebih baru dari yang tersimpan;
  - mengisi `seq` dari sequence global;
  - mengembalikan id yang ditolak beserta versi server-nya.
- **`pull_records(after bigint, max int)`:** record dengan `seq > after`, diurutkan menurut `seq`, paling banyak 500.
- **`usage()`:** jumlah baris dan `sum(octet_length(payload))` milik pengguna.
- **`delete_my_data()`:** menghapus `records` dan `vault` milik pengguna.
- **pg_cron harian:** menghapus tombstone yang `updated_at`-nya lebih dari 90 hari.
- **Batas server:** `payload` paling besar 256 KB, `id` paling panjang 80 karakter, batas laju bawaan Supabase, dan pemeriksaan JWT bawaan PostgREST.
- **Key di app:** hanya URL proyek dan publishable/anon key, yang memang publik. Service role key tidak ada di app, di repo, maupun di CI.

## 6. Alur

1. **Nyalakan sync** (Pengaturan › Sync):
   - daftar atau login (email + password Supabase);
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
- langkah awal dengan penjelasan singkat tentang password akun, frasa sandi sync, dan recovery key.

Tampil juga sebagai baris status di Profil. Semuanya dengan token tema dan mengikuti aturan SonarCloud. Belum ada artboard untuk ini: tata letak mengikuti kartu Integrasi yang sudah ada.

## 8. Rencana PR

| PR | Isi | Versi |
|---|---|---|
| S-1 | `sync/crypto.rs` (DEK, KEK Argon2id, recovery key, AEAD + AAD), `sync/record.rs` (serialisasi item ↔ record, kompresi, batas ukuran), migrasi 012 (state, outbox, trigger, `habit_checks.updated_at`). Unit test: round trip, AAD diubah gagal, frasa sandi salah gagal, trigger menangkap setiap jalur tulis, termasuk hapus habit. | — |
| S-2 | Folder `supabase/` (migrasi, RLS, RPC, pg_cron) dan test pgTAP: milik sendiri boleh, milik orang lain ditolak, LWW di RPC, batas ukuran. Job CI `supabase start` + `supabase test db`. | — |
| S-3 | `sync/engine.rs`, trait `SyncServer`, klien HTTP (`ureq`), server palsu memori dan file, LWW, `sync_pending`, kuota, jadwal latar, command `sync_*`, wrapper `src/api.ts`. Test dua klien di server palsu: konflik, hapus vs ubah, induk datang belakangan, kuota habis, offline lalu online. | — |
| S-4 | UI Pengaturan › Sync + Profil, E2E `check_sync`: dua instance di Xvfb dengan `ANCHOA_FAKE_SYNC` (buat tugas di A → muncul di B; ubah di B → kembali ke A; hapus). Versi 0.18.0, status di CLAUDE.md, dan README/MANUAL. | 0.18.0 |

**Langkah user** (tidak bisa diotomatiskan):
- membuat proyek Supabase (region Singapura) dan memberikan URL + anon key, yang disimpan sebagai konstanta build lewat env `ANCHOA_SUPABASE_URL` dan `ANCHOA_SUPABASE_ANON_KEY` saat `bun tauri build`;
- menjalankan `supabase db push` sekali (atau lewat CI dengan secret `SUPABASE_ACCESS_TOKEN`).

## 9. Keputusan tanpa tanya-jawab (Claude, 2026-10-02)

User sedang pergi. Semua ini bisa diubah sebelum kode dimulai:
1. Konflik memakai LWW per record, bukan per kolom (S8).
2. Ada frasa sandi sync terpisah dari PIN dan dari password Supabase (S4/S5). PIN tidak dipakai sebagai kunci karena hanya 4–8 digit.
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
- **Backup:** backup SQLite harian lokal tetap jadi cadangan utama. Supabase bukan backup karena isinya hanya versi terakhir.
