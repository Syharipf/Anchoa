# Anchoa — Pengaturan

Tanggal: 2026-10-01
Status: dikerjakan semalam atas izin user ("lanjut terus sampai pagi"). Semua keputusan di §2 diambil Claude tanpa tanya-jawab dan bisa diubah nanti.

## 1. Ringkasan

Halaman Pengaturan sekarang hanya berisi satu panel Data dan satu panel GitHub. Artboard baru (`docs/design/artboards/Pengaturan.dc.html`, `PengaturanAvatar`, `PengaturanSinkron`, serta DESIGN.md §2 "Pengaturan") memakai sub-nav kiri dengan enam bagian. Fase ini membangun kerangka itu dan mengisi bagian yang bisa berjalan tanpa kredensial atau pilihan LLM.

## 2. Keputusan

| Kode | Keputusan | Alasan |
|---|---|---|
| P1 | Sub-nav kiri 212px dengan enam bagian, masing-masing dengan status kecil di bawah labelnya: **Asisten & AI**, **Avatar Live2D**, **Suara**, **Sinkron & data**, **Integrasi**, **Tentang**. | Mengikuti artboard. "Laptop (SFTP)" diganti "Integrasi" karena SFTP baru berguna saat versi HP ada (Fase 9). GitHub sudah berjalan dan cocok di Integrasi. |
| P2 | Asisten & AI, Avatar Live2D, dan Suara menampilkan panel "Menyusul": satu paragraf tentang isi bagian itu nanti, dan tanpa kontrol. Status kecilnya "Menyusul". | Bagian ini butuh pilihan LLM, STT/TTS, dan lisensi Live2D (Fase 5), yang masih menunggu keputusan user. |
| P3 | **Sinkron & data** versi lokal: lokasi data, ukuran DB (file utama + WAL), jumlah item per jenis, jumlah item di Sampah (soft delete), dan daftar backup (nama, ukuran, waktu) dengan Backup sekarang, Buka folder backup, dan Buka folder data. Ada catatan "Sinkron antarperangkat menyusul (Fase 9)". | Tidak ada Supabase di stack ini. Tidak ada aksi yang menghapus data. |
| P4 | **Integrasi**: panel GitHub yang sudah ada dipindah ke sini apa adanya. Di bawahnya ada kartu "Laptop dari HP (SFTP) — menyusul". | Tanpa perubahan perilaku. |
| P5 | **Tentang**: versi, tombol **Cek pembaruan**, tautan repo dan rilis, perintah `sudo dnf upgrade anchoa`, dan daftar lisensi pihak ketiga (statis). | Mengikuti artboard. |
| P6 | Cek pembaruan memanggil `https://api.github.com/repos/Syharipf/Anchoa/releases/latest` lewat `ureq` yang sudah ada, tanpa token dan dengan timeout 10 detik. Versi dibandingkan sebagai `major.minor.patch` numerik, ditulis tangan tanpa dependency baru. Hasilnya: `Terbaru`, `Versi x tersedia` dengan tautan rilis, atau error yang bisa dibaca. Hanya dari klik, tidak pernah otomatis. | Repo publik, sehingga tidak ada kredensial. Klik eksplisit berarti tidak ada lalu lintas jaringan tanpa izin. |
| P7 | Bagian yang dibuka diingat di URL state halaman (`page.intent` / `section`), sehingga palette dan tautan "Buka Pengaturan" bisa menuju bagian tertentu. Status kecil Integrasi dan Tentang diisi dari data yang sudah ada (GitHub terhubung atau tidak, versi). | Tautan seperti "Buka Pengaturan" di ComingSoon tetap berguna. |

## 3. Backend

```rust
// src-tauri/src/settings.rs
pub struct DataOverview {
    data_dir: String,
    db_bytes: u64,            // anchoa.db
    wal_bytes: u64,           // anchoa.db-wal (0 kalau tidak ada)
    counts: Vec<TypeCount>,   // { kind, count } item tidak terhapus per items.type, urut count turun
    trashed: i64,             // items dengan deleted_at tidak null
    backups: Vec<BackupFile>, // { name, bytes, modified_at (epoch ms) }, terbaru dulu
}
pub fn data_overview(conn, data_dir, backup_dir) -> Result<DataOverview, AppError>

pub struct UpdateCheck { current: String, latest: String, newer: bool, url: String }
pub fn parse_release(current, json) -> Result<UpdateCheck, AppError>   // murni, bisa diuji
pub fn check_update(current) -> Result<UpdateCheck, AppError>          // HTTP + parse_release
fn version_tuple(v: &str) -> Option<(u64, u64, u64)>                   // "v0.10.0" / "0.10.0"
```

Command: `data_overview()` dan `check_update()`. `current` diambil dari `app.package_info().version`.

## 4. UI

- `src/settings/Settings.tsx` menjadi tata letak dua kolom: sub-nav dan isi bagian. Setiap bagian adalah komponen di `src/settings/`.
- Sub-nav berupa daftar tombol (`aria-current` pada bagian aktif), dengan ↑/↓ untuk berpindah.
- Ukuran byte diformat sebagai KB/MB (`format.ts`, fungsi baru `formatBytes` bila belum ada). Waktu backup memakai `relativeTime`.
- Daftar lisensi sebagai tabel sederhana: nama, lisensi, tautan.

## 5. Testing

- **Rust:** `data_overview` (jumlah per jenis, Sampah, ukuran DB, urutan backup), `version_tuple`, `parse_release` (lebih baru, sama, lebih lama, JSON rusak, tag tanpa `v`).
- **Frontend:** `formatBytes`, pemilihan bagian, dan status kecil.
- **E2E (`check_settings`):** buka Pengaturan, pindah ke Sinkron & data, cek angka item sama dengan DB, klik Backup sekarang lalu cek berkas backup bertambah, buka Tentang, lalu screenshot. Cek pembaruan tidak diklik di E2E (butuh jaringan).

## 6. Rencana PR

| PR | Isi |
|---|---|
| P-1 (#96) | `settings.rs`, command `data_overview` dan `check_update`, wrapper `api.ts`, test |
| P-2 (#97) | UI sub-nav dan enam bagian, E2E `check_settings`, versi 0.11.0 |
