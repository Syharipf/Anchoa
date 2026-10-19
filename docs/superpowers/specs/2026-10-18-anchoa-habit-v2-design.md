# Anchoa — Habit v2: Toleransi Centang, Kategori & Target, serta Visual Motivasi

Tanggal: 2026-10-19
Status: Disetujui user untuk peningkatan pengalaman pelacakan kebiasaan.

## 1. Ringkasan

Modul Habit ditingkatkan dengan fitur motivasi, fleksibilitas pelacakan, dan visualisasi:
1. **Toleransi Lupa Centang (Centang Kemarin):**
   - Mengizinkan pengguna mencentang habit untuk hari kemarin jika lupa membuka aplikasi malam sebelumnya.
   - Validasi ketat di Rust: hanya tanggal `hari ini` dan `kemarin` yang dapat dicentang/dibatalkan.
2. **Kategori & Ikon Habit:**
   - 5 Kategori bawaan: Kesehatan (🏃), Belajar (📚), Produktivitas (⚡), Keuangan (💰), Mindfulness (🧘).
   - Ikon emoji custom untuk setiap habit.
3. **Target / Goal Periodik (30-Day Challenge):**
   - Pengguna dapat menetapkan target hari beruntun (misal: 30 hari, 66 hari, 100 hari).
   - Menampilkan bar progres pencapaian target dan lencana keberhasilan.
4. **Arsip Habit:**
   - Menyembunyikan habit yang sudah selesai atau dijeda tanpa menghapus riwayat heatmap dan statistiknya.
5. **Daily Motivational Quotes & Delightful Animations:**
   - Kartu kutipan inspiratif harian di atas daftar habit (James Clear, Marcus Aurelius, Seneca, dll.).
   - Efek animasi perayaan (*particle spark*) saat semua habit hari ini selesai dicentang.

## 2. Keputusan Arsitektur Data

| Kode | Keputusan | Alasan |
|---|---|---|
| HB1 | Metadata (`category`, `icon`, `targetDays`, `archived`) disimpan dalam format JSON terstruktur di kolom `items.body`. | Kolom `body` pada item tipe `habit` sebelumnya kosong. Menyimpan metadata di `body` tidak memerlukan migrasi tabel baru dan otomatis kompatibel dengan sinkronisasi outbox (`sync_items_update`). |
| HB2 | `check_habit_date(conn, id, target_date, done, now, tz)` memvalidasi `target_date == today || target_date == yesterday`. | Memberikan toleransi manusiawi jika lupa mencentang kemarin tanpa merusak integritas riwayat masa lalu. |
| HB3 | Habit berstatus `archived: true` tidak dihitung dalam `todayTotal` dan `todayDone` pada kartu ringkasan harian. | Menjaga fokus pengguna pada kebiasaan aktif yang sedang dijalankan. |
| HB4 | Kutipan harian di-seed secara deterministik berdasarkan tanggal hari ini (`YYYY-MM-DD`). | Memberikan kutipan segar setiap hari dengan opsi rotasi acak. |
