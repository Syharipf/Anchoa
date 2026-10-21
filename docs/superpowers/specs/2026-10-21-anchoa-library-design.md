# Anchoa — Library

Tanggal: 2026-10-21
Status: draft, menunggu persetujuan user sebelum masuk fase rencana implementasi.

## 1. Ringkasan

Modul Library mengelola koleksi hiburan dan bacaan personal pengguna: film, serial TV, anime, buku, dan manga. Setiap entri mencatat status (`want`, `active`, `finished`, `dropped`), progres unit (episode/halaman), rating bintang (1–5), serta catatan atau ulasan pribadi. Modul ini terintegrasi langsung dengan pencarian global Command Palette melalui FTS5 dan dapat dipantau ringkas dari kartu Dashboard utama.

Dua PR untuk implementasi:

| PR | Isi |
|---|---|
| LIB-1 Backend | Migrasi 019 (`media` + trigger sync outbox), model `MediaItem`, command Rust (`library_list`, `library_overview`, `save_media`, `set_media_status`, `delete_media`, `restore_media`), pendaftaran sync record, tool asisten, unit test Rust |
| LIB-2 Frontend | Shell nav `library`, halaman Library (`src/library/`), dialog detail/editor, kartu Dashboard, `itemKindLabel` (`src/palette/results.ts`) memetakan `media` → `"Library"`, ikon `library` di `ICON_PATHS` (`Sidebar.tsx` dan `MobileDock.tsx`), `assistantHint` untuk halaman baru, dan routing `openItem` di `App.tsx`: `type === "media"` membuka halaman Library dengan dialog detail item itu, bukan `ItemPage` generik. E2E smoke test Xvfb `check_library`. | Tanpa routing itu, klik hasil pencarian palette untuk sebuah film membuka editor item generik yang tidak bisa mengubah status/progres. `RecentPanel` tidak ikut: query recent di `dashboard.rs` memang hanya `type = 'note'`. |

## 2. Keputusan

| Kode | Keputusan | Alasan |
|---|---|---|
| L1 | Model: satu media = satu baris `items` dengan `type = 'media'` + tabel ekstensi `media` (migrasi 019). `items.title` = judul; `items.body` = catatan/review pribadi milik user. | Pola konsisten dengan `accounts`, `bills`, `habits`, dan `journal_entries`. Kolom `body` otomatis diindeks `items_fts` sehingga muncul di pencarian palette tanpa overhead tabel FTS terpisah. |
| L2 | `media.kind ∈ film \| series \| anime \| book \| manga`, `status ∈ want \| active \| finished \| dropped`, `rating` 1–5 atau NULL. Semua dijaga CHECK constraint DB dan validasi Rust. | Mencegah state tidak valid di level penyimpanan terendah sekaligus memvalidasi payload sebelum menyentuh DB. |
| L3 | `progress`/`progress_total` bermakna untuk `series`/`anime` (episode) dan `book`/`manga` (halaman). Untuk `film` diabaikan (NULL) dan UI menyembunyikan kontrol progres. | Film adalah konsumsi sekali tuntas; melacak runtime parsial tidak efisien dan membingungkan UI. |
| L4 | `set_media_status(id, status)` idempoten: `active` mengisi `started_at` bila kosong (tanggal lokal hari ini); `finished` mengisi `finished_at` dan `progress = progress_total` bila total diketahui; `want` mengosongkan kedua tanggal; `dropped` mempertahankan `started_at` dan mengosongkan `finished_at`. | Otomasi tanggal mempermudah pengguna tanpa dialog tambahan. Transisi kembali ke `want` membersihkan riwayat tanggal yang belum tuntas. |
| L5 | Hapus = soft delete (`items.deleted_at = epoch_ms`) + toast Urungkan 6 detik memanggil `restore_media`. Tanpa halaman Sampah terpisah. | Konsisten dengan V1 jurnal dan modul lain di Anchoa. Mengurangi kompleksitas layar sementara data tetap aman dari aksi tidak sengaja. |
| L6 | `library_list(filter)` mengembalikan grup status/kind + hitungan. Filter `kind`, `status`, `query` (substring judul case-insensitive) dihitung di Rust, bukan di frontend. | Backend mengendalikan pemfilteran data SQLite; frontend tetap tipis dan hanya bertugas menyajikan state. |
| L7 | `library_overview()` untuk kartu Dashboard: sampai 2 item `active` terbaru, jumlah `finished` bulan berjalan, jumlah `want`. Dihitung di Rust dalam waktu lokal. | Tampilan cepat tanpa memuat daftar keseluruhan media ke memori klien Dashboard. |
| L8 | Validasi ketat di Rust: `0 ≤ progress ≤ progress_total`, `progress_total > 0` bila diisi, `rating ∈ 1..=5` atau NULL, judul tidak kosong dan ≤ 200 karakter. | Invarian integritas domain aplikasi ditegakkan sebelum query SQLite dijalankan. |
| L9 | Tanpa cover art dan tanpa scraping eksternal (TMDB/AniList/Goodreads). Kartu memakai tipografi + ikon per `kind`; badge jenis memakai `--surface-2` dengan teks `--muted`, bukan warna baru. `tokens.css` tidak ditambah. | Zero external API calls, tanpa token desain baru, dan konsisten dengan tema gelap yang ada. |
| L10 | Sync butuh empat perubahan, bukan satu: (a) `"media"` masuk `SYNCED_TYPES`; (b) deskriptor `Extension { kind: "media", table: "media", columns: ["item_id", "kind", "status", "progress", "progress_total", "rating", "started_at", "finished_at", "year", "creator", "tags"], references: [] }` di `EXTENSIONS`; (c) migrasi 019 **men-drop lalu membuat ulang** `sync_items_insert`, `sync_items_update`, dan `sync_items_delete` dengan `'media'` ditambahkan ke daftar `new.type IN (...)` — daftar itu ditulis langsung di SQL, bukan dibaca dari `SYNCED_TYPES`; (d) trigger enqueue `sync_media_*` untuk tulisan di tabel ekstensi. Tanpa child record. | Kalau (c) dilewatkan, perubahan judul/ulasan pada `items` tidak pernah masuk outbox dan sinkronisasi diam-diam kehilangan edit. Pola ini sama dengan penambahan tipe sebelumnya. |
| L11 | Asisten v1 hanya baca: tool `list_library(status?)` mengembalikan judul, kind, status, progress — **tanpa** `body`. Ulasan (`items.body`) dikecualikan dari `search_for_chat` di `search.rs` (tambahkan `'media'` ke daftar `type NOT IN`), jadi provider `custom` tidak pernah menerima tulisan pribadi pengguna. Tanpa tool tulis. | Metadata koleksi boleh dibaca agar asisten bisa memberi rekomendasi; ulasan pribadi diperlakukan seperti jurnal. |
| L12 | PageId baru `library`, label nav `Library`, disisipkan tepat setelah `unduhan` di `PAGES` (`src/shell/nav.ts`). | Urutan rail konsisten dengan navigasi inti aplikasi. |
| L13 | E2E smoke test `check_library` baru di `scripts/e2e-smoke.sh` (tambah item, update status, verifikasi DOM dan verifikasi baris SQLite). | Menjaga kualitas rilis dan mencegah regresi pada pipeline pengujian Xvfb. |

## 3. Data dan command

Migrasi baru `src-tauri/migrations/019_library.sql`:

```sql
-- 1. Tabel ekstensi
CREATE TABLE media (
  item_id        TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('film', 'series', 'anime', 'book', 'manga')),
  status         TEXT NOT NULL DEFAULT 'want' CHECK (status IN ('want', 'active', 'finished', 'dropped')),
  progress       INTEGER,
  progress_total INTEGER,
  rating         INTEGER CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  started_at     INTEGER,
  finished_at    INTEGER,
  year           INTEGER,
  creator        TEXT NOT NULL DEFAULT '',
  tags           TEXT NOT NULL DEFAULT '',
  CHECK (progress IS NULL OR progress >= 0),
  CHECK (progress_total IS NULL OR progress_total > 0),
  CHECK (progress IS NULL OR progress_total IS NULL OR progress <= progress_total)
);

CREATE INDEX idx_media_status_kind ON media(status, kind);

-- 2. sync_items_* di-drop lalu dibuat ulang dengan 'media' di daftar tipe.
--    Isi trigger identik dengan 012_sync.sql; satu-satunya perubahan adalah
--    new.type IN (..., 'media') pada insert, update, dan delete.

-- 3. Enqueue untuk tulisan di tabel ekstensi
CREATE TRIGGER sync_media_insert AFTER INSERT ON media
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES (new.item_id, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;
-- sync_media_update dan sync_media_delete memakai pola yang sama; update hanya
-- menembak saat salah satu kolom ekstensi benar-benar berubah.
```

Command `save_media` menulis `items` (title, body, updated_at) lalu UPSERT `media` di satu transaksi; karena keduanya memicu outbox, satu simpanan menghasilkan satu record (outbox memakai `ON CONFLICT ... DO UPDATE`).

Daftar command baru (seluruhnya mengembalikan `Result<T, AppError>`, dipanggil via `src/api.ts`):

| Command | Parameter | Output | Deskripsi |
|---|---|---|---|
| `library_list` | `filter: LibraryFilter` (`kind?`, `status?`, `query?`) | `LibraryListResponse` | Daftar media yang tidak terhapus beserta ringkasan jumlah per tab status. |
| `library_overview` | *kosong* | `LibraryOverview` | Agregasi dashboard: item aktif terbaru, jumlah selesai bulan ini, total daftar tunggu. |
| `save_media` | `input: SaveMediaInput` | `MediaItem` | Membuat baru (UUIDv7) atau memperbarui media dan `items` (`title`, `body`). |
| `set_media_status` | `id: String`, `status: String` | `MediaItem` | Mengubah status secara idempoten sekaligus memutasi tanggal/progres sesuai L4. |
| `delete_media` | `id: String` | `()` | Soft delete: mengatur `deleted_at = epoch_ms` pada tabel `items`. |
| `restore_media` | `id: String` | `()` | Mengembalikan item yang dihapus (`deleted_at = NULL`) jika dipanggil saat toast aktif. |

## 4. UI

Layout halaman mengadopsi kerangka kerja Anchoa (`docs/design/DESIGN.md` §1) dengan rail 72px, top bar responsif, dan asisten mini. Artboard: `docs/design/artboards/Library.dc.html`.
- Navigasi: halaman masuk roda nav (rail menampilkan 5 ikon pada satu waktu, jadi posisi 11 tidak menambah lebar), `MobileDock` (`grid-cols-4`), dan command palette. Tidak ada perubahan tata letak rail.

### Wireframe ASCII

```text
+-----------------------------------------------------------------------------------------+
| Library            [Search media...       ] [All kinds v]                  [+ Add]     |
+-----------------------------------------------------------------------------------------+
| ( All 24 )  ( Want 10 )  [ Watching 4 ]  ( Finished 9 )  ( Dropped 1 )                  |
+-----------------------------------------------------------------------------------------+
| +-------------------------+ +-------------------------+ +-------------------------+     |
| | [SERIES]         ***..  | | [BOOK]            ****. | | [FILM]            ***** |     |
| | Severance (S2)          | | Designing Data Systems  | | Past Lives (2023)       |     |
| | Dan Erickson            | | Martin Kleppmann        | | Celine Song             |     |
| | [========>     ] 6/10 ep| | [===>        ] p.120/550| | [Finished]              |     |
| | Status: Watching        | | Status: Reading         | | Rating: 5/5             |     |
| +-------------------------+ +-------------------------+ +-------------------------+     |
| +-------------------------+                                                             |
| | [MANGA]                 |                                                             |
| | Frieren: Beyond Journey |                                                             |
| | Kanehito Yamada         |                                                             |
| | Want to read            |                                                             |
| +-------------------------+                                                             |
+-----------------------------------------------------------------------------------------+
```

### Spesifikasi Tampilan & Token
- Header: judul halaman, input filter substring judul instan, dropdown filter `kind`, dan tombol primer `+ Add`.
- Label status di UI (Bahasa Inggris, mengikuti bahasa aplikasi): `want` → *Want*, `active` → *Watching* untuk `film`/`series`/`anime` dan *Reading* untuk `book`/`manga`, `finished` → *Finished*, `dropped` → *Dropped*. Teks ini hidup di `src/library/view.ts`, bukan di Rust.
- Baris Chip Filter Status: tombol pill dinamis dengan jumlah badge (`want` muted, `active` accent, `finished` accent-deep/done, `dropped` danger).
- Grid Kartu: kartu responsif 3–4 kolom berbasis token `--surface`, border `--border`, dan efek hover halus. Header kartu menampilkan badge jenis (`--surface-2`, teks `--muted`) dengan ikon per `kind`, plus rating bintang mini (★).
- Detail & Editor Modal: panel modal untuk mengubah judul, pembuat/pengarang, tahun rilis, input progres (`progress` / `progress_total`), rating interaktif 1–5 bintang, tag comma-separated, dan textarea ulasan (`body`).
- State Kosong: pesan terpusat saat tidak ada media yang cocok dengan filter, dengan tautan cepat untuk membersihkan filter atau menambah media baru.

## 5. Sinkronisasi dan privasi

Data media ikut sinkronisasi multi-perangkat yang sudah ada (relay Supabase, terenkripsi ujung ke ujung; server hanya menyimpan ciphertext) melalui outbox:
- Pendaftaran Sync: tipe `"media"` masuk `SYNCED_TYPES`, dan `EXTENSIONS` mendapat deskriptor `Extension { kind: "media", table: "media", columns: ["item_id", "kind", "status", "progress", "progress_total", "rating", "started_at", "finished_at", "year", "creator", "tags"], references: [] }`.
- Trigger `items` harus dibuat ulang dengan `'media'` (L10c); tanpa itu edit judul/ulasan tidak terkirim.
- Privasi Data: metadata Library bukan data konfidensial seperti Jurnal. Asisten lokal maupun provider `custom` diizinkan membaca judul, kategori, status, dan progres untuk percakapan harian (L11). Isi `body` (ulasan) tetap berada di disk lokal kecuali sinkronisasi aktif, dan tidak pernah dikirim ke provider AI kecuali user membuka obrolan yang menyertakannya.

## 6. Testing

Strategi pengujian menyeluruh pada dua layer:
- Unit & Integrasi Rust (`src-tauri/src/library.rs`):
  - Uji transisi status L4: pembaruan otomatis `started_at` saat masuk status `active`, pengisian `finished_at` dan pemenuhan `progress = progress_total` saat `finished`, pembersihan saat kembali ke `want`.
  - Uji validasi L8: penolakan progress negatif, progress melebihi total, rating di luar rentang 1–5, dan judul kosong/terlalu panjang.
  - Uji kalkulasi agregat `library_overview` terhadap variasi data tanggal lokal.
  - Uji sync di `sync/record.rs`: menyimpan ulasan baru pada `items` memicu outbox (memastikan trigger `sync_items_update` sudah memuat `'media'`), round-trip export/apply satu media dengan semua kolom ekstensi, dan soft delete menjadi tombstone. Array `SYNCED_TYPES` yang dikunci `assert_eq!` di test modul itu harus diperbarui, begitu pula daftar `EXTENSIONS`.
  - Uji `search_for_chat` tidak mengembalikan `media` (L11).
- Pengujian E2E Smoke (`scripts/e2e-smoke.sh` via Xvfb):
  - Fungsi `check_library`: navigasi ke `/library`, membuat entri serial anime baru, memverifikasi kemunculan kartu di UI, menaikkan progres, mengubah status menjadi `finished`, memastikan soft delete memunculkan toast dengan tombol **Undo**, serta verifikasi keutuhan baris SQLite melalui binary sqlite3 CLI.

## 7. Di luar cakupan

- Integrasi API metadata eksternal, web scraping, atau unduhan sampul otomatis (TMDB, AniList, MyAnimeList, OpenLibrary, Goodreads).
- Pelacak file lokal atau integrasi pemutar video/media player embedded di dalam aplikasi.
- Halaman Sampah mandiri khusus Library (tetap memakai pola toast Urungkan 6 detik).
- Sub-item riwayat per-episode atau pembagian bab bertingkat (cukup pelacak numerik skalar `progress`).
