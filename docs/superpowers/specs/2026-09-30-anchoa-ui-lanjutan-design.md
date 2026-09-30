# Anchoa — UI lanjutan: kerangka global

Tanggal: 2026-09-30
Status: **DRAF**. User meminta pekerjaan dilanjutkan tanpa sesi tanya-jawab. Karena itu, keputusan yang belum disetujui ditandai **[Ux]**.

- **Acuan visual:** `docs/design/DESIGN.md` §1–2, dengan artboard `Main`, `CommandPalette`, dan `NotifPanel`, serta asisten mini di artboard modul (misalnya `Keuangan`).
- **Dasar kode:** redesign D (`2026-09-30-anchoa-ui-d-design.md`, PR UI-1 sampai UI-4).
- **Isi dokumen ini:** keputusan implementasi yang tidak tertulis di `DESIGN.md`.

## 1. Tujuan

Kerangka aplikasi disamakan dengan paket desain lengkap sebelum modul baru dibangun. Dengan begitu, setiap fase berikutnya cukup mengisi halamannya sendiri.

Yang masuk:
- nav rail dengan 8 modul, ditambah Notifikasi, Profil, dan Pengaturan;
- top bar di semua halaman, yang membuka command palette;
- panel notifikasi;
- asisten mini di halaman selain Dashboard;
- dashboard bento.

Yang tidak masuk: isi modul Email, Jadwal, Keuangan, Proyek, Berkas, dan Unduhan (masing-masing ikut fasenya), suara sungguhan (Fase 5), dan layar loading (lihat U8).

## 2. Keputusan

| Kode | Keputusan | Alasan |
|---|---|---|
| U1 | Nav memuat semua item `DESIGN.md` §1 dengan urutan: Dashboard, Inbox, Email, Jadwal, Keuangan, Proyek, Berkas, Unduhan; di bawahnya Notifikasi, Profil, Pengaturan. Modul yang belum dibangun membuka halaman "menyusul" berisi nama modul, satu kalimat dari `DESIGN.md` §2, dan fasenya (Email 8, Jadwal 3, Keuangan 2, Proyek 3, Berkas 6, Unduhan 7). Ikon diambil dari nav di `Main.dc.html`. | Kerangka tidak perlu diubah lagi saat modul datang, dan user bisa melihat roadmap dari aplikasi. |
| U2 | Aside 380px (kontribusi + stage asisten) hanya tampil di Dashboard. Halaman lain memakai asisten mini. | Sesuai `DESIGN.md` §1. Halaman modul butuh lebar penuh. |
| U3 | Top bar ada di semua halaman: tombol bergaya kolom cari (tinggi 42, radius 10, teks "Cari atau jalankan perintah…", `kbd` Ctrl K) dan jam. Input `CommandBar` di dashboard dihapus. | `DESIGN.md` §1: top bar adalah pembuka palette, bukan input. |
| U4 | Isi palette: grup **Buka halaman** (10 halaman: semua target nav selain Notifikasi) dan **Terbaru** (5 item pertama dari `recent`). Saat kolom tidak kosong, hasil difilter (substring, tanpa beda huruf besar-kecil, pada label + keterangan) lalu ditutup grup **Inbox** berisi satu opsi "Simpan ke Inbox: “…”". Aksi cepat modul yang belum ada, tombol suara, "Tahan Spasi", dan "Tanya asisten" belum ditampilkan. | Tidak ada tombol yang tidak berfungsi. Quick capture tetap jalan: kalau teks tidak cocok dengan apa pun, opsi yang tersorot adalah "Simpan ke Inbox", jadi Enter menyimpan seperti sebelumnya. Pencarian penuh menunggu FTS5 (Fase 4). |
| U5 | `Ctrl K` dan `Ctrl N` membuka palette di atas halaman yang sedang terbuka. Tidak lagi pindah ke Dashboard. | Palette sekarang ada di semua halaman. |
| U6 | Panel notifikasi berisi **pengingat** yang diturunkan dari data yang sudah ada: tugas terlambat yang belum selesai (grup "Terlambat") dan tugas jatuh tempo hari ini yang belum selesai (grup "Hari ini"). Sumbernya `get_dashboard().today`. Tidak ada status dibaca, tab, sakelar Jangan ganggu, Bacakan, atau tautan "Atur notifikasi". Lonceng di nav diberi titik coral kalau ada pengingat. Tabel `notifications` baru dibuat saat modul pertama butuh notifikasi yang disimpan. | Tanpa sumber notifikasi lain, status dibaca tidak berarti apa-apa. Pengingat tugas sudah berguna sekarang. |
| U7 | Asisten mini: tombol bulat 60px di kanan bawah (badge mikrofon lime), tertutup secara default. Kalau dibuka, muncul popup 304px berisi avatar 44px dengan cincin teri mini (putaran 12s), status, satu pesan per halaman, tombol keyboard (memunculkan kolom ketik yang nonaktif), tombol mikrofon 44px (idle ↔ listening, sama dengan stage), "Buka asisten penuh" (ke Dashboard), dan tombol kecilkan. State-nya lokal: pindah halaman membuat status kembali idle. Gelembung saran belum ada. | Sama dengan aturan stage di UI-3. Gelembung saran butuh logika saran, yang lebih cocok ikut Fase 5. |
| U8 | Layar loading ditunda ke Fase 5. | Saat ini aplikasi siap dalam kurang dari 100 ms, dan tidak ada model suara atau Live2D yang perlu dimuat. Layar loading sekarang hanya akan berkedip. |
| U9 | Dashboard memakai bento 3 kolom dari `Main.dc.html`: Hari ini (2 kolom) dan Keuangan; 7 hari ke depan (2 kolom) dan Email; Proyek, Unduhan, dan slot Berkas terbaru. Isinya: <br>• Kartu modul yang belum ada ringkas saja: judul, "Hadir di Fase N", dan tautan ke halaman menyusul. <br>• Slot Berkas terbaru menampilkan **Catatan terbaru** (3 item) sampai Fase 6. <br>• Kartu KPI dihapus; bar segmen dan hitungan tugas pindah ke header kartu Hari ini. <br>• Di atas bento: sapaan, ringkasan satu baris ("3 tugas hari ini · 1 terlambat · 2 catatan di Inbox"), dan tombol "Dengarkan rekap" yang nonaktif (title "Hadir di Fase 5"). <br>• Baris pintasan belum ditampilkan. | Mengikuti desain tanpa angka palsu. Semua pintasan di desain menunggu modul lain. |
| U10 | `get_dashboard` mendapat `upcoming`: 7 hari mulai besok. Setiap hari berbentuk `{ date: "YYYY-MM-DD", tasks: DayTask[] }` dan hanya berisi tugas yang belum selesai. Batas hari dan tanggal lokal dihitung di Rust. Kartu menampilkan per hari: nama hari, tanggal, titik aksen per tugas, judul tugas pertama, dan "+n lagi". Warna kategori menunggu Jadwal (Fase 3). | Aturan CLAUDE.md: batas hari dihitung di Rust. Frontend cukup memformat nama hari. |
| U11 | Profil sementara berupa halaman menyusul, dengan tombol ke Pengaturan (tempat GitHub dan backup berada). Tombol Profil di nav memakai ikon orang, bukan inisial, karena nama user belum disimpan. | Isi Profil tumbuh bersama modulnya (roadmap §13). |

## 3. Komponen

| Unit | Isi | Bergantung pada |
|---|---|---|
| `shell/nav.ts` | Daftar halaman: id, label, ikon, fase (untuk halaman menyusul) | — |
| `shell/Sidebar.tsx` | Nav rail memakai `nav.ts`, lonceng dengan titik coral, titik Inbox | `nav.ts` |
| `shell/ComingSoon.tsx` | Halaman menyusul | `nav.ts` |
| `shell/TopBar.tsx` | Tombol pembuka palette + `Clock` (dipindah dari `dashboard/`) | — |
| `palette/results.ts` | Fungsi murni `paletteResults(query, recent)` → grup dan daftar datar opsi | `nav.ts` |
| `palette/CommandPalette.tsx` | Dialog, keyboard, ARIA combobox/listbox, menjalankan opsi | `results.ts`, `api` |
| `notifications/reminders.ts` | Fungsi murni `reminders(today)` → grup Terlambat dan Hari ini | `api` types |
| `notifications/NotifPanel.tsx` | Panel 400px di samping nav | `reminders.ts` |
| `assistant/AssistantMini.tsx` | Tombol bulat + popup | `School`, `usePageVisible` |
| `assistant/School.tsx` | Diberi prop ukuran dan durasi putaran supaya bisa dipakai stage (300px, 48s) dan popup mini | — |
| `dashboard/*` | Bento: `TodayPanel` (dengan bar segmen), `UpcomingCard`, `ModuleCard`, `RecentPanel` (Catatan terbaru), `summary.ts` | `api`, `nav.ts` |
| Rust `dashboard.rs` | `upcoming` + test | `time.rs` |

**Aliran data.** `App` menyimpan satu salinan `Dashboard`. Salinan ini dimuat saat app mulai, setelah quick capture dari palette, setelah tugas dicentang, dan saat Dashboard atau Inbox dibuka. `Dashboard`, lonceng, panel notifikasi, dan grup "Terbaru" di palette membaca salinan yang sama. `inboxCount` untuk titik Inbox juga diambil dari sini.

## 4. Perilaku penting

- **Palette:**
  - dialog 640px, top 110px, latar redup `#05070ACC`, border `#2E3440`, radius 16;
  - input fokus saat dibuka; ↑↓ memindah sorotan tanpa berputar; Enter menjalankan; Esc atau klik latar menutup;
  - saat ditutup, fokus kembali ke elemen yang tadinya aktif;
  - `role="combobox"` + `aria-activedescendant`, `role="listbox"`/`option`, dan hasil diumumkan lewat `aria-live="polite"`.
- **Simpan ke Inbox:**
  - Berhasil: palette tertutup dan toast "Tersimpan ke Inbox" muncul.
  - Gagal: palette tetap terbuka dan teks tetap ada, sama dengan `CommandBar` sekarang.
- **Panel notifikasi:**
  - `role="dialog"` + `aria-modal`, dan Esc menutup;
  - "Buka ›" membuka item lalu menutup panel;
  - kalau kosong, tampil "Tidak ada pengingat.";
  - footer: "Pengingat dari tugas berjatuh tempo. Notifikasi lain menyusul bersama modulnya."
- **Overlay:** hanya satu overlay terbuka pada satu waktu. Membuka palette menutup panel, begitu juga sebaliknya.
- **Animasi:** muncul dengan `anchoa-pop` dan `anchoa-slide` dari `tokens.css`. Aturan `DESIGN.md` §6 berlaku; cincin mini ikut berhenti saat idle atau saat jendela tersembunyi.

## 5. Pembagian PR

| PR | Isi |
|---|---|
| UI-5 | `nav.ts`, nav 11 item, halaman menyusul (termasuk Profil), aside hanya di Dashboard, asisten mini, prop ukuran di `School` |
| UI-6 | Top bar di semua halaman, command palette, `Ctrl K`/`Ctrl N` membuka palette, `CommandBar` dihapus, `Dashboard` data diangkat ke `App` |
| UI-7 | Panel notifikasi dan lonceng |
| UI-8 | `upcoming` di Rust, dashboard bento, kartu KPI dihapus |

## 6. Testing

- **Rust:** `upcoming` berisi tepat 7 hari mulai besok (termasuk hari tanpa tugas); tidak memuat tugas hari ini, tugas yang selesai, tugas yang dihapus, atau tugas setelah hari ke-7; mengikuti offset zona waktu.
- **Frontend (`bun test`):**
  - `paletteResults`: tanpa query ada 2 grup; filter tidak membedakan huruf besar-kecil; opsi Inbox hanya muncul saat query tidak kosong dan selalu di akhir; kalau tidak ada yang cocok, opsi Inbox satu-satunya hasil; "Terbaru" paling banyak 5.
  - `reminders`: tugas selesai tidak masuk; tugas terlambat dan hari ini terpisah.
- **E2E (Xvfb):**
  - klik setiap item nav baru → halaman menyusul tampil;
  - `Ctrl N` + teks + Enter tetap menyimpan catatan (cek di DB);
  - `Ctrl K` + "keu" + Enter membuka halaman Keuangan;
  - lonceng membuka panel yang berisi tugas terlambat;
  - asisten mini buka/tutup di Inbox;
  - bento tampil dengan tugas besok di "7 hari ke depan".
  - Koordinat klik disesuaikan dengan layout baru.
