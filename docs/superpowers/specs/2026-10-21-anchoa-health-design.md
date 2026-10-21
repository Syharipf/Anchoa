# Anchoa — Health
Tanggal: 2026-10-21
Status: draft, menunggu persetujuan user sebelum masuk fase rencana implementasi.

## 1. Ringkasan

Modul **Health** mencatat metrik kebugaran harian (berat badan, durasi tidur, langkah kaki, detak jantung istirahat) disertai visualisasi tren dan riwayat entri. Penyimpanan memakai tabel terdedikasi tanpa relasi ke `items`.

| PR | Isi |
|---|---|
| H-1 Backend | Migrasi 020, command Rust (`save`, `delete`, `today`, `series`, `history`), record sync komposit `hm:` mengikuti pola `habit_checks`, unit test Rust |
| H-2 Frontend | Halaman Health (Today 4 metrik, grafik SVG tren, riwayat 14 hari), kartu Dashboard opsional, integrasi nav, E2E smoke test |

## 2. Keputusan

| Kode | Keputusan | Alasan |
|---|---|---|
| H1 | Bukan item. Tabel `health_metrics(kind, date, value, note, created_at, updated_at, deleted_at, PRIMARY KEY(kind, date))` (migrasi 020). | Satu baris per hari per metrik bukan objek berjudul. Jika masuk `items`, data harian mengotori command palette, pencarian FTS, dan daftar Terbaru. Preseden: `habit_checks`. |
| H2 | `kind ∈ weight_g \| sleep_min \| steps \| resting_hr`. Nilai integer kanonik: gram, menit, langkah, bpm. Tanpa float di DB maupun payload wire. | Memperluas aturan uang integer Anchoa untuk akurasi data pengukuran tanpa presisi melayang. |
| H3 | Satu baris per `(kind, date)`; `save_health_metric` bertindak sebagai upsert dan **mengosongkan `deleted_at`** (menyimpan ulang metrik yang pernah dihapus menghidupkannya kembali). Format `date` berupa `"YYYY-MM-DD"` waktu lokal, divalidasi Rust, tidak boleh melebihi tanggal hari ini. | Mencegah pencatatan tanggal masa depan, menjaga integritas kalender lokal user, dan menghindari baris "hantu" yang tetap terhapus padahal baru disimpan. |
| H3a | Nilai per jenis: `steps` boleh `0` (hari tanpa langkah itu sah), `weight_g`, `sleep_min`, dan `resting_hr` harus `> 0`. CHECK di SQL hanya `value >= 0`; batas per jenis divalidasi Rust. | CHECK tunggal `value > 0` akan menolak data nyata (0 langkah) dan memaksa aturan domain masuk ke skema. |
| H4 | `health_series(kind, days)` menghasilkan deret harian berurutan. Hari tanpa rekaman diisi `null` agar grafik tidak menyambung palsu, dilengkapi kalkulasi min/max/avg. | Batas hari dan kalkulasi statistik dihitung di Rust. Garis grafik terputus jujur mencerminkan data kosong. |
| H5 | `health_today()` mengembalikan rekaman metrik hari ini beserta delta terhadap rata-rata 7 hari sebelumnya. | Perhitungan ringkasan harian dan delta perbandingan dipusatkan di Rust. |
| H6 | UI dua kolom: kiri berisi kartu Today (4 input angka, simpan saat blur/Enter) dan grafik garis tren SVG (berat 90 hari, tidur/langkah 30 hari); kanan riwayat 14 hari terakhir (tanggal, 4 metrik, catatan). | Tampilan memakai token bawaan (`--surface`, `--border`, `--accent`). Artboard: `docs/design/artboards/Health.dc.html`. |
| H7 | Privasi: data health bersifat sensitif. Provider LLM `custom` (remote) dilarang menerima konteks health, dan tidak ada tool asisten untuk health di v1. | Selaras dengan kebijakan proteksi privasi modul Jurnal di `assistant/roles.rs`. |
| H8 | Sync baris non-item butuh lima titik sentuh, semuanya mengikuti preseden `habit_checks`: (a) tiga trigger `sync_health_metrics_*` dengan `record_id = 'hm:' \|\| kind \|\| ':' \|\| date`; (b) `enqueue_all` mendapat `SELECT` kedua untuk `health_metrics` memakai `MAX(updated_at, COALESCE(deleted_at, 0))` seperti query `items`; (c) `export` mendapat cabang ber-prefix `hm:` (sejajar `check_key` untuk `hc:`) yang mengirim `HealthDocument`; (d) `apply` mendapat cabang yang sama; (e) cabang tombstone `if record.deleted` juga harus mengenali `hm:` dan menjalankan `UPDATE health_metrics SET deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE kind = ? AND date = ?` — tanpa ini, record terhapus jatuh ke cabang `items` dan tidak berefek. `SYNCED_TYPES` **tidak** diubah. | Menyalin pola `habit_checks` membuat LWW, tombstone, dan kuota bekerja tanpa mengubah skema `items`. Cabang tombstone adalah bagian yang paling mudah terlewat: `apply` versi sekarang hanya punya cabang `hc:` dan `items`. |
| H9 | Tidak ada centang habit otomatis yang dipicu dari pencatatan metrik health di v1. | Menghindari keterikatan implisit antar modul; menjaga kesederhanaan alur kerja. |
| H10 | Tanpa saran medis otomatis, target/kalkulasi kalori, integrasi wearable/Health Connect, atau impor CSV. | YAGNI; fokus pencatatan mandiri yang cepat dan andal secara lokal. |
| H11 | Kartu Dashboard opsional pada PR-2: menampilkan berat terakhir, tidur semalam, dan langkah hari ini; kartu disembunyikan bila belum ada data. | Memberikan ikhtisar cepat di beranda tanpa mengacaukan layout jika modul tidak dipakai. |
| H12 | Penambahan uji E2E `check_health` pada `scripts/e2e-smoke.sh`. | Menjamin verifikasi alur UI dan persistensi DB di lingkungan headless Xvfb. |
| H13 | PageId baru `health`, label navigasi `Health`, disisipkan tepat setelah `habit` pada `PAGES` di `src/shell/nav.ts`, plus path ikon `health` di `ICON_PATHS` pada `Sidebar.tsx` **dan** `MobileDock.tsx` (keduanya punya tabel ikon sendiri; tanpa entri, ikon nav kosong). | Hierarki menu konsisten dengan modul pelacakan rutinitas harian, dan roda nav tidak merender ikon tanpa path. |

## 3. Data dan command

Migrasi baru `src-tauri/migrations/020_health.sql`:

```sql
CREATE TABLE health_metrics (
  kind       TEXT NOT NULL CHECK (kind IN ('weight_g', 'sleep_min', 'steps', 'resting_hr')),
  date       TEXT NOT NULL,
  value      INTEGER NOT NULL CHECK (value >= 0),
  note       TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (kind, date)
);

CREATE INDEX idx_health_metrics_date ON health_metrics(date);

CREATE TRIGGER sync_health_metrics_insert AFTER INSERT ON health_metrics
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES ('hm:' || new.kind || ':' || new.date, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_health_metrics_update AFTER UPDATE ON health_metrics
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
  AND (old.value IS NOT new.value OR old.note IS NOT new.note OR old.deleted_at IS NOT new.deleted_at)
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES ('hm:' || new.kind || ':' || new.date, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;

CREATE TRIGGER sync_health_metrics_delete AFTER DELETE ON health_metrics
WHEN (SELECT value FROM sync_state WHERE key = 'applying') = '0'
BEGIN
  INSERT INTO sync_outbox (record_id, changed_at)
  VALUES ('hm:' || old.kind || ':' || old.date, CAST(unixepoch('subsec') * 1000 AS INTEGER))
  ON CONFLICT(record_id) DO UPDATE SET changed_at = excluded.changed_at;
END;
```

Daftar command Rust (`Result<T, AppError>`, dipanggil via `src/api.ts`):

| Command | Parameter | Output | Deskripsi |
|---|---|---|---|
| `save_health_metric` | `kind: String, date: String, value: i64, note: Option<String>` | `HealthMetric` | Upsert metrik harian (menghidupkan baris terhapus). Validasi format tanggal, batas masa depan, `value >= 0`, dan `value > 0` untuk semua jenis selain `steps`. |
| `delete_health_metric` | `kind: String, date: String` | `()` | Soft delete: `deleted_at` dan `updated_at` diisi epoch ms yang sama. |
| `health_today` | - | `HealthTodaySummary` | 4 metrik hari ini + delta vs rata-rata 7 hari sebelumnya. |
| `health_series` | `kind: String, days: u32` | `HealthSeriesResult` | Daftar titik harian (`value: Option<i64>`) berurutan + statistik min/max/avg. |
| `health_history` | `days: u32` | `Vec<HealthDayRow>` | Riwayat multi-metrik per tanggal untuk tabel ringkasan. |

## 4. UI

Wireframe tampilan halaman `health` (artboard: `docs/design/artboards/Health.dc.html`):

- Navigasi: halaman masuk roda nav (rail menampilkan 5 ikon sekaligus), `MobileDock`, dan palette; tidak ada perubahan tata letak rail.

```text
+-----------------------------------------------------------------------------------+
| Health                                                      [ 2026-10-21 ]        |
+-------------------------------------------------+---------------------------------+
| Today                                           | Last 14 days                    |
| +-------------+-------------+                 | Date   Weight  Sleep  Steps  RHR |
| | Weight      | Sleep       |                 | 10-21  68.4 kg 7h 30m 8,420   62 |
| | [ 68.4 ] kg | [ 7:30 ]    |                 | 10-20  68.6 kg 6h 45m 10,150  64 |
| | (-0.2 kg 7d)| (+15m 7d)   |                 | 10-19    --    8h 10m 6,200   61 |
| +-------------+-------------+                 | ...                              |
| | Steps       | RHR         |                 |                                  |
| | [ 8420 ]    | [ 62 ] bpm  |                 | Empty state:                     |
| | (+310 7d)   | (-1 bpm 7d) |                 | "No data yet"                    |
| +-------------+-------------+                 |                                  |
|                                                 |                                  |
| Weight trend (90 days)                          |                                  |
| [ Min: 67.8 kg | Avg: 68.5 kg | Max: 69.2 kg ]                                    |
| ~~~~\______/\______/~~~~~ (thin SVG line, stroke var(--accent))                    |
|                                                                                   |
| Sleep & steps trend (30 days)                                                     |
| ~~~~~/\______/\~~~~~~~~~~ (thin SVG line, stroke var(--muted))                     |
+-------------------------------------------------+---------------------------------+
```

Format unit dan konversi:
- **Tampilan**: berat `kg` satu desimal (`68.4`), tidur `7h 30m`, langkah dengan pemisah ribuan (`8,420`), RHR `62 bpm`. Semua label UI Bahasa Inggris (mengikuti bahasa aplikasi).
- **Penyimpanan**: parse dilakukan di frontend (`kg × 1000 → weight_g`, `jam × 60 + menit → sleep_min`). DB dan wire hanya menerima integer; tidak ada float di JSON.
- **State kosong**: bila belum ada data, area riwayat dan metrik menampilkan `"No data yet"` tanpa merusak grid.

## 5. Sinkronisasi dan privasi

- `SYNCED_TYPES` **tidak berubah**. Baris health bukan item, jadi ia memakai jalur record komposit seperti `habit_checks`:
  - `enqueue_all` (`sync/record.rs`) mendapat `SELECT` kedua: `'hm:' || kind || ':' || date, MAX(updated_at, COALESCE(deleted_at, 0)) FROM health_metrics`.
  - `delete_health_metric` mengisi `deleted_at` **dan** `updated_at` dengan epoch ms yang sama; kalau hanya `deleted_at` yang diisi, record yang dihapus bisa terkirim dengan timestamp basi.
  - `export` mendapat cabang `hm:` sebelum cabang item; payload `HealthDocument { schema, kind, date, value, note, created_at, updated_at, deleted_at }`; baris yang hilang tapi masih di outbox menjadi tombstone.
  - Cabang tombstone `if record.deleted` mengenali `hm:` dan menandai `deleted_at` di peer; tanpa itu record terhapus jatuh ke `UPDATE items` yang tidak mengenai apa pun.
  - `apply` (non-tombstone) meng-upsert berdasarkan `(kind, date)` dan menolak dokumen yang kunci internalnya tidak cocok dengan id record.
- Konflik diselesaikan Last-Write-Wins memakai `updated_at`, sama seperti tipe lain. Karena tidak ada baris `items`, judul record untuk batas ukuran memakai `health:<kind>:<date>`.
- Privasi: metrik kesehatan diklasifikasikan sensitif. Konteks health tidak dikirim ke provider `custom` (remote) dan tidak ada tool asisten untuk health di v1 — sejalan dengan aturan jurnal di `assistant/roles.rs`.

## 6. Testing

- **Rust unit test**:
  - `save_health_metric`: validasi upsert, penolakan tanggal masa depan, penolakan nilai negatif, penolakan `0` untuk `weight_g`/`sleep_min`/`resting_hr` sementara `steps = 0` diterima, dan penyimpanan ulang menghidupkan baris yang sebelumnya dihapus (`deleted_at` kembali NULL).
  - `health_series`: verifikasi pengisian slot hari kosong bernilai `null` tanpa pemotongan deret, akurasi min/max/avg.
  - `health_today`: verifikasi delta vs 7 hari terakhir pada berbagai kombinasi data parsial.
  - `sync`: trigger outbox memakai id `hm:<kind>:<date>`, `enqueue_all` memasukkan baris health dengan timestamp `MAX(updated_at, deleted_at)`, round-trip export/apply, **apply tombstone `record.deleted` menandai `deleted_at` di baris health** (bukan jatuh ke `items`), dan id yang tidak cocok ditolak `invalid_record`.
- **Frontend / E2E**:
  - Test skrip `check_health` di `scripts/e2e-smoke.sh`: navigasi menu Health, input form Today, blur/Enter simpan, verifikasi pembaruan baris riwayat dan DB SQLite di disk.

## 7. Di luar cakupan

- Integrasi otomatis Google Health Connect, Apple Health, atau API perangkat wearable.
- Estimasi pembakaran kalori, target diet nutrisi, dan kalkulator BMI.
- Diagnostik kesehatan atau rekomendasi medis berbasis AI.
- Impor/ekspor file format CSV, XML, atau FIT.
