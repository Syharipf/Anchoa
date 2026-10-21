# Rencana Implementasi Health (H-1 & H-2)

Rencana implementasi modul Health berdasarkan spec `docs/superpowers/specs/2026-10-21-anchoa-health-design.md`.

## H-1 Backend: Data, Command, dan Sinkronisasi

### Scope
- Migrasi DB 020 (`health_metrics`, index, trigger outbox `hm:`).
- Modul Rust `src-tauri/src/health.rs`:
  - Model: `HealthKind` (weight_g, sleep_min, steps, resting_hr), `HealthMetric`, `HealthField`, `HealthToday`, `HealthSeries`, `HealthDayRow`.
  - Fungsi: `save_health_metric`, `delete_health_metric`, `health_today`, `health_series`, `health_history`.
  - Validasi: tanggal `YYYY-MM-DD` waktu lokal ≤ hari ini, `value >= 0`, `value > 0` kecuali `steps`, batas deret 1..=365 hari.
  - Statistik integer tanpa float (avg dibulatkan).
- Integrasi Sync di `src-tauri/src/sync/record.rs`:
  - Parsing prefiks `hm:<kind>:<date>` lewat `health_key`.
  - `HealthData` & `HealthDocument` (kompresi Zstd, ukuran payload).
  - Outbox trigger, enqueue_all SELECT kedua, export tombstone/row, apply upsert & tombstone.
- Pendaftaran command di `src-tauri/src/commands.rs` dan `src-tauri/src/lib.rs`.
- Tanpa tool asisten (H7).
- Unit test Rust di `health.rs` dan `sync/record.rs`.

### Acceptance H-1
- `cd src-tauri && cargo test` lulus 100%.
- `cd src-tauri && cargo clippy --all-targets -- -D warnings` bersih tanpa peringatan.
- Tidak menyentuh file frontend `src/` atau artboard.

---

## H-2 Frontend: Halaman, Grafik, Navigasi, dan Dashboard

### Scope
- Penambahan tipe & API wrapper di `src/api.ts` (`saveHealthMetric`, `deleteHealthMetric`, `healthToday`, `healthSeries`, `healthHistory`).
- Navigasi:
  - `PageId` `'health'` di `src/shell/nav.ts` (posisi setelah `habit`).
  - Path ikon `health` di `Sidebar.tsx` dan `MobileDock.tsx`.
- Halaman Health `src/health/HealthPage.tsx`:
  - Dua kolom responsive (Today cards di kiri + riwayat 14 hari di kanan).
  - Kartu Today: 4 input (weight kg, sleep jam:menit, steps, resting hr bpm) dengan auto-save blur/Enter dan delta vs 7 hari.
  - Grafik tren garis SVG: berat 90 hari, tidur & langkah 30 hari; penanganan titik kosong (`null`) jujur memutus garis.
  - Tabel riwayat 14 hari: ringkasan per tanggal dan catatan.
  - State kosong: pesan `"No data yet"`.
- Kartu Dashboard (opsional):
  - Tampilkan ringkasan berat terakhir, tidur, dan langkah jika ada data; sembunyikan jika kosong.
- E2E smoke test di `scripts/e2e-smoke.sh` (`check_health`).

### Acceptance H-2
- `bun run typecheck` dan `bun run lint` lolos.
- Halaman Health merender input Today, grafik tren SVG, dan riwayat 14 hari sesuai artboard `docs/design/artboards/Health.dc.html`.
- Skrip `scripts/e2e-smoke.sh` berhasil menjalankan pengujian alur Health.
