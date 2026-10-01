# Anchoa — Profil

Tanggal: 2026-10-01
Status: dikerjakan semalam atas izin user ("lanjut terus sampai pagi"). Keputusan di §2 diambil Claude tanpa tanya-jawab dan bisa diubah nanti.

## 1. Ringkasan

Menu Profil sekarang masih halaman "Segera". Artboard `docs/design/artboards/Profil.dc.html` (DESIGN.md §2 "Profil") berisi:
- kartu profil;
- Keamanan;
- Akun terhubung;
- Asisten suara;
- Notifikasi.

Fase ini mengisi bagian yang bisa berjalan tanpa kredensial dan tanpa pilihan model suara.

## 2. Keputusan

| Kode | Keputusan | Alasan |
|---|---|---|
| R1 | **Kartu profil:** nama tampilan yang bisa diubah (disimpan di tabel `settings`, kunci `profile.name`, default "Kamu"), avatar inisial, dan "Memakai Anchoa sejak <bulan tahun>" (dari `MIN(created_at)` item). Statistiknya: streak habit terpanjang yang sedang berjalan, jumlah tugas selesai, entri jurnal, dan halaman Catatan. | Semua datanya sudah ada di DB. Tidak ada email atau akun, karena belum ada login. |
| R2 | **Notifikasi:** satu sakelar per jenis pengingat (Tugas, Tagihan, Batas anggaran, Habit), disimpan di `settings` (`notify.task`, `notify.bill`, `notify.budget`, `notify.habit`, default nyala). Jenis yang dimatikan tidak muncul di panel notifikasi dan tidak dihitung di badge. | Panel notifikasi dan badge sudah dibangun dari `reminders.ts`, jadi filternya cukup di satu tempat. |
| R3 | **Jam tenang ditunda:** belum ada notifikasi OS atau suara, sehingga jam tenang belum berpengaruh apa-apa. Kartunya menulis "Menyusul bersama notifikasi desktop". | Tidak membuat kontrol yang tidak berefek. |
| R4 | **Akun terhubung:** GitHub (status dari `github_status`, tombol "Atur" yang membuka Pengaturan › Integrasi), Email IMAP (Menyusul, Fase 8), dan Kalender (Menyusul). | GitHub sudah berjalan, sedangkan yang lain butuh kredensial. |
| R5 | **Keamanan dan Asisten suara:** kartu "Menyusul" yang menjelaskan isinya nanti (PIN dan enkripsi lokal; suara, kecepatan, kata pemanggil). Tanpa kontrol. | PIN dan enkripsi butuh dependency kripto baru dan keputusan desain keamanan, jadi tidak dikerjakan semalam. Suara butuh Fase 5. |
| R6 | Nama tampilan dipakai juga di sapaan Dashboard kalau sapaannya sudah memakai nama. Kalau sapaannya tidak memakai nama, bagian ini dilewati. | Satu sumber nama. |

## 3. Backend

```rust
// src-tauri/src/profile.rs
pub struct Profile { name: String, since: Option<i64>, stats: ProfileStats }
pub struct ProfileStats { habit_streak: i64, tasks_done: i64, journal_entries: i64, notes: i64 }
pub struct NotifyPrefs { task: bool, bill: bool, budget: bool, habit: bool }
pub fn profile(conn, today, tz) -> Result<Profile, AppError>
pub fn set_name(conn, name) -> Result<Profile, AppError>      // trim, 1..=40 karakter, kosong = "Kamu"
pub fn notify_prefs(conn) -> Result<NotifyPrefs, AppError>
pub fn set_notify_prefs(conn, prefs) -> Result<NotifyPrefs, AppError>
```

- `habit_streak`: nilai `streak` tertinggi dari habit yang tidak terhapus, memakai fungsi streak di `habits.rs` yang sudah ada.
- `tasks_done`: tugas yang tidak terhapus dengan `completed_at` tidak null.
- `journal_entries`: entri jurnal yang tidak terhapus.
- `notes`: item `type = 'page'` yang tidak terhapus.
- Command: `get_profile`, `set_profile_name`, `get_notify_prefs`, `set_notify_prefs`.

## 4. UI

- `src/profile/ProfilePage.tsx` menggantikan ComingSoon untuk `profil`. Tata letaknya mengikuti artboard: kartu profil lebar di atas, lalu kartu-kartu dalam grid.
- `reminders()` dan `reminderCount()` menerima `NotifyPrefs` (opsional, default semua nyala) dan membuang jenis yang dimatikan. `App.tsx` memuat prefs sekali dan memuat ulang setelah prefs diubah.
- Dashboard: sapaan memakai nama bila R6 berlaku.

## 5. Testing

- **Rust:** `profile` (statistik dan "sejak"), `set_name` (trim, batas panjang, kosong menjadi default), `notify_prefs` (default dan round-trip).
- **Frontend:** `reminders` dengan prefs (setiap jenis bisa dimatikan, dan badge ikut berubah).
- **E2E (`check_profile`):** buka Profil, ganti nama lalu cek tersimpan di DB, matikan "Tugas" lalu cek `notify.task = 0` di DB, lalu screenshot.

## 6. Rencana PR

| PR | Isi |
|---|---|
| R-1 (#100) | `profile.rs`, command, `api.ts`, test |
| R-2 (#101) | Halaman Profil, filter pengingat, E2E `check_profile`, versi 0.12.0 |
