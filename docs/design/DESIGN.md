# Anchoa — Spesifikasi Desain (untuk implementasi)

Dashboard pribadi dengan asisten suara (STT + TTS, pet teri **Ako**). Tema: **Studio Malam** (gelap).
Stack: **Tauri 2 + SvelteKit (Svelte 5) + Rust** — aturan teknis ada di `CLAUDE.md`.
Acuan desktop: **1280×800**.

## 0. Cara memakai paket ini

| Berkas | Isi | Cara pakai |
|---|---|---|
| `DESIGN.md` | Spesifikasi ini | Sumber kebenaran untuk struktur, perilaku, dan aturan |
| `tokens.css` | Warna, font, radius, jarak, animasi | Impor apa adanya, atau salin ke config stack (Tailwind theme, dsb.) |
| `artboards/*.dc.html` | Sumber artboard dari tool desain | Referensi **struktur, inline style, dan logika state**. Sintaks `{{…}}`, `<sc-for>`, `<sc-if>`, `<dc-import>`, `<x-dc>`, `<helmet>`, dan `class Component extends DCLogic` adalah format tool desain, **jangan disalin mentah**. Terjemahkan ke stack proyek |
| `screenshots/*.png` | (ekspor sendiri dari canvas) | Acuan tampilan akhir per halaman |

Semua angka, nama, dan isi (saldo, email, tugas, unduhan) adalah **data contoh**.

## 1. Kerangka aplikasi (dipakai semua halaman)

```
┌──────┬───────────────────────────────────────────────────────────┐
│ Nav  │ [ Cari atau jalankan perintah…            Ctrl K ]  22.48 │  ← tombol pembuka command palette
│ 72px │ Judul halaman + aksi                                      │
│      │ Isi halaman                                               │
│ …    │                                                           │
│ 🔔   │                                           (asisten mini)  │  ← popup/tombol bulat kanan bawah
│ (R)  │                                                           │
│ ⚙    │                                                           │
└──────┴───────────────────────────────────────────────────────────┘
```

**Nav kiri (72px, ikon 20px, tombol 48×48, radius 12, gap 6):**
Dashboard · Jurnal · Email · Jadwal · Habit · Keuangan · Proyek · Berkas · Unduhan — lalu di bawah: Notifikasi (lonceng + titik coral) · Profil (avatar inisial) · Pengaturan (`/pengaturan`).
- Aktif: latar `--surface-2`, ikon `--accent`, `aria-current="page"`.
- Semua ikon wajib punya tooltip (title) dan `aria-label`.
- Badge: Email = angka belum dibaca (pil lime).
- **Inbox sudah dilebur menjadi Jurnal** (route `/jurnal`): semua ide, keluh kesah, dan catatan cepat (termasuk "Catatan suara" dari Dashboard/palette) masuk ke sana.

**Top bar:** tombol lebar bergaya kolom cari (tinggi 42, radius 10) → membuka **command palette**. Di aplikasi asli: shortcut global **Ctrl K**.

**Asisten:**
- **Dashboard:** panel penuh di kanan (380px), avatar dominan.
- **Halaman lain:** asisten mini. Default **tertutup** (tombol bulat 60px kanan bawah, badge mikrofon lime). Bisa menampilkan **gelembung saran** satu baris + titik coral saat ada hal penting. Dibuka → popup 304px.
  - Catatan: artboard Keuangan masih membuka popup sejak awal — samakan jadi tertutup.
- Popup berisi: avatar 44px + cincin teri mini, status (Siap/Mendengarkan…), satu pesan kontekstual per halaman, tombol keyboard (membuka input ketik), tombol mikrofon 44px, tombol "buka asisten penuh", tombol kecilkan.

**Overlay global:**
- **Command palette** (dialog 640px, top 110px, latar redup 80%): input + tombol perintah suara + Esc; grup *Aksi cepat*, *Buka halaman*, *Terbaru*; saat mengetik → filter; baris terakhir "Tanya asisten: “…”". Keyboard: ↑↓ pilih, Enter jalankan, Esc tutup. `role="combobox"` + `listbox`/`option` + `aria-activedescendant`.
- **Panel notifikasi** (400px, muncul dari kiri di samping nav, latar redup 60%): Bacakan (TTS), Tandai semua dibaca, tab Semua/Belum dibaca, sakelar Jangan ganggu, grup Hari ini/Kemarin, tiap item punya tautan aksi ke modulnya, footer "Atur notifikasi" → Profil.

## 2. Halaman

### Loading (saat app dibuka)
Latar `--sidebar`. Logo resmi 280px di tengah: animasi **intro** (2,2 dtk), lalu **loading** (loop) sampai siap, lalu diam. Nama "Anchoa", bar progres 240×3 (scaleX), teks tahap: data lokal → model suara → Ako → sinkron jadwal & email → "Siap.". Setelah siap: animasi berhenti. **Target < 2 detik**: tampilkan Dashboard secepatnya, muat model suara di latar belakang.

### Dashboard (rekap cepat)
- Sapaan + ringkasan satu baris + tombol **Dengarkan rekap** (asisten membacakan rekap di panel kanan).
- Pintasan (pil): Tugas, Transaksi, Catatan suara (→ entri Jurnal), Unduh dari clipboard, Tulis email.
- Bento 3×3: **Hari ini** (2 kolom; checkbox tugas + bar segmen) · **Keuangan** (saldo, keluar bulan ini, chip status tagihan) · **7 hari ke depan** (2 kolom; per hari: nama hari, tanggal, titik warna kategori, item pertama, "+n lagi") · **Email** (3 terbaru) · **Proyek** (2 proyek + progres) · **Unduhan** (2 aktif + progres, kecepatan total) · **Berkas terbaru** (3 item). Setiap kartu = tautan ke modulnya.
- Panel kanan: strip kontribusi kode (heatmap bulanan mini + total + % vs bulan lalu + streak, navigasi bulan ‹ ›) di atas, asisten suara penuh di bawah.

### Jurnal
Tempat menuang ide, keluh kesah (curhat), dan catatan. Chip **Privat · terenkripsi** di header. Tiga kolom:
- **Daftar** (296px): cari (berjalan di perangkat), filter jenis Semua/Ide/Curhat/Catatan, grup Hari ini/Kemarin/Minggu lalu; kartu = ikon jenis, jam, mini-bar suasana hati, judul, 2 baris cuplikan.
- **Editor**: segmented jenis (Ide/Curhat/Catatan), tanggal, judul, isi (15px, line-height 1.7, lebar maks ±620px), tag, pemilih **suasana hati** 1–5 (Berat, Kurang, Biasa, Baik, Senang), footer: jumlah kata + autosave, *Jadikan tugas* (khusus Ide), *Bacakan*, **Minta tanggapan**.
- **Kanan** (272px): *Suasana 30 hari* (batang: tinggi = suasana hati, titik = tidak menulis), *Pemantik* (prompt menulis + "Tulis dari sini"/"Ganti"), *Ide belum ditindaklanjuti*.
- **+ Tulis** membuat draf kosong; **Dikte** → asisten mendengarkan, banner transkrip di editor, "Selesai" menyimpan entri baru.
- **Privasi (wajib):** isi entri dienkripsi di perangkat sebelum dikirim ke Supabase; pencarian hanya lokal. Asisten **tidak** membaca jurnal kecuali pengguna menekan *Minta tanggapan* pada entri itu — hanya entri itu yang dikirim ke `ai-gateway`, dan tanggapannya tidak disimpan di server. Nada tanggapan: suportif tapi jujur, tidak menghakimi, menawarkan satu langkah konkret.

### Email
Tiga kolom: folder (176px; Kotak masuk, Berbintang, Terkirim, Draf, Arsip, Spam + Label berwarna kategori) · daftar (340px; tab Semua/Belum dibaca, titik lime = belum dibaca, bintang) · isi. Isi email: subjek, pengirim, **Ringkasan asisten** (poin-poin + Bacakan + satu aksi kontekstual: Tambahkan ke Jadwal / Tandai lunas / Jadikan tugas), badan email, bar balasan (saran balasan cepat, input, tombol dikte suara, Kirim). Bar balasan diberi padding kanan 88px agar tidak tertutup tombol asisten.

### Jadwal
Toggle **Kalender | Timeline**, navigasi periode, tombol Hari ini, filter jenis (Proyek/Tagihan/Pribadi).
- Kalender: grid bulan, maksimal 3 chip per sel (2 jika 6 baris) + "+n lagi"; klik tanggal → panel agenda kanan (Terlambat, Tenggat hari itu, 7 hari berikutnya, bisa dicentang).
- Timeline: 8 minggu, 16px/hari, dikelompokkan per proyek; batang penuh = dikerjakan, garis tepi = rencana, belah ketupat = tenggat; bingkai coral = terlambat; garis lime = hari ini.
- Warna = **jenis** (3 kategori), bukan per proyek.

### Habit
Kebiasaan **centang harian**. Header: *Catat lewat suara* + **+ Habit**.
- Kartu ringkas: Hari ini (n/total + bar bersegmen), Streak aktif terpanjang, Konsistensi 30 hari (% hari terjadwal yang selesai).
- **Centang hari ini**: tab Semua/Belum; per baris = tombol centang bulat 36px (`role="checkbox"`), nama, jam pengingat · jadwal, 7 kotak hari terakhir (lime = selesai, abu = terlewat, garis putus = libur, garis lime = hari ini belum), streak (ikon api). Klik nama → detail di kanan.
- **Detail (392px)**: streak sekarang / terpanjang / % bulan ini; **heatmap bulanan** (kalender Sen–Min, sel 36px bernomor, navigasi ‹ › antar bulan); **Pengingat** (jam, sakelar, 7 tombol hari terjadwal); frasa suara untuk habit itu.
- Streak dihitung atas **hari terjadwal** saja (hari libur tidak memutus streak).
- "Tulis jurnal" tercentang otomatis bila ada entri Jurnal hari itu.
- Pengingat muncul di panel notifikasi (dan dibacakan bila belum dicentang). Suara: "Anchoa, aku sudah baca" → habit tercentang + konfirmasi streak.

### Keuangan
Header bulan + Catat lewat suara + Transaksi. 4 kartu (Saldo, Pemasukan, Pengeluaran, Arus bersih). Grafik arus kas 6 bulan (batang masuk/keluar, klik pilih bulan). Transaksi terbaru (filter Semua/Masuk/Keluar, dikelompokkan per bulan). Akun (bar porsi saldo). Tagihan (tombol Tandai lunas).

### Proyek › Agen kode (`ProyekAgen`, `ProyekAgenHubungkan`, `HpAgen`)
- Header proyek: breadcrumb, tab **Kanban | Agen kode**, status agen (titik + "sedang bekerja / menunggu izinmu / dihentikan") + tombol *Hentikan* (outline coral).
- **Aktivitas agen** (kiri): dikelompokkan per sesi (agen, mesin, folder, durasi, pil status). Event bergaris waktu: sesi mulai, rencana (checklist langkah → masuk Kanban), tugas pindah kolom, file diubah (path + baris), tes (lulus/gagal + nama tes gagal), **izin** (kartu kuning dengan perintah, alasan, dampak, *Izinkan sekali* / *Tolak*). Sesi lama diringkas satu paragraf. Filter: Semua / Rencana & tugas / Tes / Izin.
- **Kirim ke agen** (kanan, 356px): pilih agen + folder, mode **Rencana saja** (bawaan) / **Minta izin** / **Edit otomatis** dengan penjelasan satu baris, textarea, chip perintah cepat, dikte, *Kirim* → antrean.
- **Agen terhubung**: daftar agen (kemampuan: hanya mencatat vs bisa menerima perintah) + *Hubungkan agen*.
- **Dialog Hubungkan agen**: 1 token (nama, proyek, sakelar izin; "Terima perintah dari Anchoa" mati secara default; token tampil sekali), 2 perintah `claude mcp add …`, 3 snippet CLAUDE.md/AGENTS.md, 4 hooks opsional, *Cek koneksi*.
- **Mode asisten**: popup asisten punya segmen *Asisten | Agen kode*; di mode agen, ucapan menjadi perintah untuk agen (selalu dikonfirmasi).
- **HP (`HpAgen`)**: kartu izin besar (tombol 50px), progres sesi, event terakhir, perintah cepat (dari HP bawaannya Rencana saja).
- Kanban: kartu dari agen diberi lencana kecil "dari agen".

### Proyek
Daftar proyek (kartu progres, klik pilih) + Tenggat terdekat. Header proyek (persen, deadline, status repo). Kanban 3 kolom (Rencana / Dikerjakan / Selesai); tombol → memindah kartu ke kolom berikutnya; progres ikut diperbarui.

### Berkas (mirip Thunar)
Sidebar Tempat/Perangkat, tombol kembali/maju/naik, breadcrumb, tampilan ikon/daftar. **Panel pratinjau kanan (320px) hanya muncul jika tepat satu item dipilih**: foto, video (play/progres), PDF (navigasi halaman), teks/kode, isi folder, atau "pratinjau belum tersedia". Ctrl+klik = pilih banyak → panel hilang, muncul bar Salin/Pindahkan/Hapus + total ukuran. Tombol asisten kontekstual per jenis berkas.
- Performa: thumbnail dibuat hanya untuk item yang terlihat + cache; PDF render per halaman (mis. pdf.js); video tidak autoplay.

### Unduhan
Kotak tautan dengan deteksi jenis: media (yt-dlp) · file langsung (aria2) · magnet/.torrent. Opsi media: Video/Audio saja, resolusi atau bitrate, format, subtitle. Antrean dengan tab Semua/Aktif/Selesai/Torrent/Gagal; status: Mengunduh, Dijeda, Menunggu, Memproses (ffmpeg), Membagikan, Selesai, Gagal. Panel mesin (yt-dlp + Perbarui, ffmpeg, aria2, **Torrent opsional**) dan pengaturan (folder, unduhan bersamaan, batas kecepatan, pantau clipboard, rasio seeding).
- yt-dlp perlu pembaruan berkala (cek otomatis). ffmpeg wajib untuk menggabungkan video+audio resolusi tinggi. Torrent **mati secara default** (IP terlihat oleh peer); aria2 sudah mendukung BitTorrent, libtorrent jika butuh fitur lebih.
- **Progress kawanan teri** (artboard `ProgressKawanan`, komponen `FishProgress.svelte`). Dipakai di semua bar unduhan/transfer: Unduhan (desktop & HP), kartu Unduhan di Dashboard, *Simpan ke HP* di File laptop. **Tidak** dipakai untuk progres proyek dan scrubber video.
  - Tinggi 12 px (10 px di kartu Dashboard), radius penuh, jalur `#1A1E25`.
  - Isi dipotong tepat di persen (`overflow: hidden`, transisi lebar 0,3 s) dengan rona lime 14 %; di dalamnya pola SVG 72×12 px berisi 7 teri (ukuran & transparansi beragam) diulang horizontal. Pola digeser `translateX(-72px → 0)` tanpa henti.
  - Laju = kecepatan unduh: durasi satu putaran `clamp(0.9s, 9 / (MB/s + 0.5), 4s)`.
  - Ikan pemimpin (21×12 px, sedikit lebih besar, garis tepi gelap) di ujung depan isi; ekor bergoyang ±6° per 0,45 s.
  - Status → tampilan: Mengunduh = lime, berenang; Dijeda = abu-abu, diam; Menunggu = 3 teri abu-abu menjelajah jalur kosong; Memproses = penuh, `#86B33A`, pelan; Membagikan = penuh, pola dibalik dan berenang ke kiri (mengunggah); Selesai = penuh, `#4E6A26`, diam; Gagal = jalur coral 12 % tanpa ikan.
  - Hanya `transform` yang beranimasi; satu pola dipakai ulang; hentikan saat halaman/jendela tidak terlihat. `prefers-reduced-motion` → pola tetap tampil tapi diam.
  - Aksesibilitas: kontainer `role="progressbar"` + `aria-valuenow/min/max` + `aria-valuetext` ("63 %, 19 detik lagi"); teks persen tetap tampil di bawah bar.

### Pengaturan (3 artboard: `Pengaturan`, `PengaturanAvatar`, `PengaturanSinkron`)
Sub-nav kiri 212px (6 bagian, tiap item punya status kecil): Asisten & AI · Avatar · Suara · Sinkron & data · Laptop (SFTP) · Tentang. Ketiga artboard adalah file yang sama dengan bagian awal berbeda.
- **Asisten & AI**: 5 tile penyedia (Anthropic, OpenAI, Google Gemini, OpenRouter, Ollama lokal; titik = status kunci). Kolom kunci API tampil **termasking** (hanya 4 karakter terakhir) + *Tes koneksi* / *Ganti*. Hasil tes dalam kotak status: valid (lime), kuota habis 429 (kuning), ditolak 401 (coral), belum ada kunci (abu), sedang menguji. **Model per tugas**: perintah suara, ringkasan email, tanggapan jurnal, rekap harian — tombol yang mengganti model; daftar model diambil dari API penyedia setelah kunci valid. Kanan: pemakaian bulan ini (dari `ai_usage`) dan *Privasi AI* (jurnal hanya ke model lokal, sertakan konteks jadwal, simpan riwayat).
- **Ako (pet)**: pratinjau dengan tombol status, *Tampil di* (panel asisten, tombol asisten mini, melayang di desktop: mati bawaan, di i3 perlu picom), *Mood harian* (hanya naik), *Gerak* Penuh/Hemat/Diam + gerak mulut ikut suara, *Tidur saat tidak dipakai* (2 menit), *Mata mengikuti kursor*.
- **Suara**: STT di perangkat (whisper.cpp tiny/base/small + ukuran) atau cloud; pilih mikrofon + meter level; TTS Piper lokal atau cloud, pilihan suara + contoh; kata pemanggil; selalu tampilkan teks.
- **Sinkron & data**: status Supabase (region, latensi, sinkron terakhir, antrean offline), ukuran DB vs 500 MB, cache di perangkat + *Bersihkan*, perangkat terdaftar + *Cabut akses*, backup terenkripsi terakhir, aturan pembersihan otomatis.
- **Laptop (SFTP)**: host Tailscale, pengguna, folder akar, kunci SSH (fingerprint, salin kunci publik), *Tes koneksi*, sakelar izinkan HP mengunggah (default mati), daftar cek keamanan laptop.
- **Tentang**: versi, cek pembaruan, lisensi pihak ketiga (yt-dlp, ffmpeg, whisper.cpp, Piper, Tauri).

### Masuk & penyiapan pertama (`Login`, `Onboarding`)
- **Masuk** (tanpa nav): panel merek kiri 560px (logo resmi, animasi idle), form kanan 380px: email, kata sandi, *Masuk*, *Kirim tautan masuk ke email* (magic link), *Masuk dengan GitHub*. Error = kotak coral di atas form; tautan terkirim = kotak lime. **Pendaftaran ditutup** (Supabase: matikan sign-up), sesi di keyring.
- **Penyiapan pertama** (5 langkah, kolom langkah kiri 300px, tombol Kembali/Lewati/Lanjut di bawah): 1 Asisten AI (penyedia + kunci + Tes, atau Ollama lokal, atau Nanti), 2 Suara & mikrofon (izin, uji "Hai Anchoa", pilih suara), 3 Avatar (pilih model + *Uji performa* → memilih avatar 3D penuh atau gambar diam), 4 Laptop opsional (langkah Tailscale + SFTP, *Hubungkan*), 5 Ringkasan → *Buka Dashboard*.

### Versi HP (390×844, 19 artboard di dua halaman canvas: *HP · Utama* dan *HP · Modul*)
Semua menu desktop ada di HP. Daftar: `HpMasuk`, `HpBeranda`, `HpBerandaRoda`, `HpAsisten`, `HpCari`, `HpNotif`, `HpJurnal`, `HpHabit`, `HpJadwal`, `HpKeuangan`, `HpProyek`, `HpAgen`, `HpEmail`, `HpEmailBaca`, `HpBerkas`, `HpUnduhan`, `HpPengaturan`, `HpPengaturanAI`, `HpProfil`.

**Dok + roda menu (pengganti nav bawah)** — dipakai di 11 layar utama; layar detail (`HpAsisten`, `HpEmailBaca`, `HpPengaturanAI`, `HpProfil`, `HpNotif`, `HpCari`, `HpMasuk`) memakai tombol kembali dan tanpa dok. Artboard `HpBerandaRoda` = keadaan roda terbuka.
- **Tertutup (bawaan), ±100px:** tiga tombol — *Cari* 52px (kiri, → `HpCari`), **tombol menu 60px di tengah** berisi ikon halaman aktif + label di bawahnya, dikelilingi kawanan teri kecil, dan *Mikrofon* 52px lime (kanan, → Asisten). Konten diberi `padding-bottom: 120px`; gradien pudar 136px di belakang dok.
- **Tap tombol menu → roda terbuka:** scrim gelap (rgba 5,7,10,.76) menutup layar; roda tumbuh dari tombol (scale .3 → 1, 0,4 s). Pusat roda (195, 780), radius 112px, 11 item 52px; hanya item dalam ±72° dari puncak yang tampil (5 item). Tombol tengah berubah jadi **×**; Cari & Mikrofon diganti tombol **‹ ›** 44px.
- **Memutar:** geser horizontal di area roda (0,6° per px, `touch-action: none`, pointer capture setelah gerak > 6px) lalu *snap* ke item terdekat; atau tap item / tombol ‹ ›. Transisi 0,45 s `cubic-bezier(.2,.8,.2,1)` kecuali saat diseret (tanpa transisi). Ikon diputar balik supaya tetap tegak.
- Item di puncak = terpilih (lime, skala 1,12) + label di atas pusat + pil **Buka [menu] ›** bila bukan halaman aktif. Halaman aktif tetap ditandai (ikon & border hijau).
- **Menutup:** ×, tap scrim, atau tombol Back Android → roda kembali ke halaman aktif. Membuka menu lain menutup roda.
- **Di aplikasi:** tap item = putar lalu buka setelah ±300 ms (prototipe canvas hanya memutar; buka lewat pil).
- **Kawanan teri:** 22 ekor melingkar, kepala searah jarum jam. Tertutup: cincin kecil (skala .58) di sekitar tombol menu. Terbuka: membesar ke radius ±70px dan ikut terseret 1,6× sudut roda (transisi 0,7 s). Putaran ambien 16 s/putaran **berhenti setelah 6 s tanpa sentuhan** (aturan performa §6) dan mati saat `prefers-reduced-motion`.
- Lapisan: gradien z2 · scrim z3 · dok z4 · bottom sheet z5 (sheet menutupi dok).
- Aksesibilitas: `<nav aria-label="Menu utama">`; tombol menu `aria-expanded`, label "Menu: Beranda. Buka roda menu"; item tersembunyi `tabindex -1`; label terpilih `aria-live="polite"`; panah kiri/kanan untuk TalkBack/keyboard.

**Layar**
- **Beranda**: sapaan + tombol Cari (→ `HpCari`) & lonceng (→ `HpNotif`); kartu asisten, Hari ini, Habit & Saldo, File laptop, Email.
- **Asisten**: layar penuh, avatar besar + kawanan, transkrip, mikrofon 76px.
- **Cari & perintah** (`HpCari`): versi HP dari command palette — kolom cari, tahan-untuk-bicara, Aksi cepat, Buka, Terbaru.
- **Notifikasi**: segmented Semua/Belum dibaca, dikelompokkan per hari, tiap item membuka menu terkait.
- **Jurnal / Habit**: seperti sebelumnya (tulis cepat; centang bulat 48px).
- **Jadwal**: segmented *Minggu ini* (7 kolom hari, titik kategori) / *Bulan* (grid 7×5); agenda hari terpilih dengan checkbox 28px; terlambat = baris coral.
- **Keuangan**: saldo + masuk/keluar bulan ini, grafik arus kas 6 bulan (tap batang → keterangan), Tagihan dengan *Lunas*, transaksi terbaru.
- **Proyek**: chip proyek (geser horizontal), kartu ringkasan + progres, pita *Agen kode menunggu izin* (→ `HpAgen`), segmented Rencana/Dikerjakan/Selesai (Kanban jadi tab), tombol pindah kolom per kartu, label *dari agen*.
- **Email**: segmented, tombol *Ringkas 3 email belum dibaca*, daftar; **Baca** (`HpEmailBaca`): ringkasan asisten + *Tambahkan ke Jadwal*, isi email, balasan cepat, dikte, kirim.
- **File laptop**: breadcrumb + latensi, daftar; pratinjau bottom sheet + *Simpan ke HP*.
- **Unduhan**: tempel tautan (deteksi dari clipboard), Video/Audio saja, antrean dengan jeda/lanjut. Di Android memakai youtubedl-android; torrent mati bawaan.
- **Pengaturan**: kartu profil (→ `HpProfil`), daftar bagian; **Asisten & AI** (`HpPengaturanAI`): pilih penyedia (radio), kunci tersamar, *Tes koneksi* dengan hasil ok/429/kosong, model per tugas, sakelar *Jurnal hanya ke model lokal*.
- **Profil**: avatar + cincin teri, statistik, sakelar PIN/Jangan ganggu/Kata pemanggil, akun terhubung, *Keluar dari HP ini*.
- **Masuk**: email + kata sandi, tautan masuk, GitHub; sesi di Android Keystore.
- Sakelar di HP 50×30 (bukan 40×22) supaya target sentuh cukup.

### State kosong, offline, error (`State`)
Galeri acuan. Aturan: jelaskan apa yang terjadi, apa yang masih bisa dipakai, dan satu langkah berikutnya. Kuning (`--warning`) = bisa dipulihkan/menunggu, coral = butuh tindakan pengguna, abu-abu = informasi. Mencakup: kosong (Jurnal, Habit, Proyek, Email), bilah offline + toast tersambung lagi, laptop tidak terjangkau, Supabase dijeda (paket gratis), sinkron tertunda, kunci API 401, kuota 429 (tawarkan Ollama lokal), izin mikrofon ditolak, avatar dialihkan ke statis, yt-dlp perlu diperbarui, konflik sinkron (pilih versi HP/laptop), kerangka memuat (hanya saat cache kosong, tanpa shimmer).

### Profil
Kartu profil (avatar + cincin teri, statistik), Keamanan (PIN, enkripsi data lokal, keluar), Akun terhubung (repo kode, email IMAP, kalender), Asisten suara (jenis suara + contoh, kecepatan, kata pemanggil "Hai Anchoa", proses suara di perangkat, bahasa), Notifikasi (sakelar per jenis + jam tenang).

## 3. Asisten suara — state

| State | Label | Warna aksen | Animasi |
|---|---|---|---|
| `speaking` | Berbicara | `--accent` | kawanan berputar, gelombang bergerak |
| `listening` | Mendengarkan… | `--danger` | kawanan berputar, gelombang + denyut mikrofon |
| `idle` | Siap | `--accent` (redup) / `--muted` | **semua berhenti** (pause), cincin opacity turun |

Tap mikrofon: `listening` ↔ `idle`. Teks balasan TTS selalu tampil sebagai caption (aksesibilitas + lingkungan bising).

### Pet Ako
Ako adalah teri dari logo yang jadi hidup (canvas halaman **Maskot**, `artboards/PetAko.dc.html`; komponen `src/lib/pet/AnchoaPet.svelte`): badan ramping lime, moncong menjorok, mata besar di depan, tutup insang, sirip punggung dan dubur, ekor bercabang dalam, celah gelap seperti logo, headset putih, dan kawanan kecil (gradasi perak → lime) yang ikut bereaksi. Di panel asisten, Asisten HP, dan Pengaturan Ako berenang di depan latar bawah laut (`LautAko.svelte`: sinar cahaya, gelembung, partikel, rumput laut, dasar pasir; `<AnchoaPet shadow={false}>`). Ukuran: panel 290 px (desktop) / 300 px (HP), 96 px ke bawah tanpa kawanan dan efek, avatar bulat 44–60 px memakai potongan kepala.

| Status | Animasi |
|---|---|
| `idle` | kedip, napas, ekor bergoyang; tidur setelah 2 menit tanpa interaksi |
| `listening` | mata membesar, gelombang suara |
| `thinking` | melirik ke atas, gelembung titik |
| `speaking` | mulut mengikuti volume TTS |
| `happy` | melompat + kilau (habit dicentang, tugas selesai) |
| `surprised` | melonjak, tanda seru (jatuh tempo, email penting) |
| `sad` | hanya untuk error sistem, bukan untuk kebiasaan pengguna |

Mood harian hanya naik (biasa → cerah → berbinar), tidak pernah turun di bawah biasa. Di ≤ 48 px tanpa kawanan dan efek.

## 4. Komponen (ringkas)
- **Tombol:** primer (lime, teks `--on-accent`, 600), sekunder (surface + border), hantu, bahaya (outline coral), ikon 32–38px, mikrofon 64 (penuh) / 44 (mini).
- **Input:** tinggi 40–44, radius 10, border `--border`; fokus → border `--done`.
- **Kontrol:** segmented (latar `--surface`, item aktif `--surface-2`), chip pilihan (aktif: border `--done`), sakelar 40×22 (on: lime + knob gelap), checkbox native `accent-color: var(--accent)`.
- **Status:** titik 6px + label; progres 4px; progres bersegmen (selesai lime / terlambat coral / belum border).
- **Kartu:** radius 14, border 1px, tanpa bayangan. Bayangan hanya untuk popup/overlay.
- **Teks di atas warna data** selalu memakai token teks, bukan warna kategori.

## 5. Motif teri
Satu bentuk (badan lensa + ekor bercabang), path SVG: `M-7 0C-3-2.4 3-2.6 7 0C3 2.6-3 2.4-7 0ZM-6 0L-10.5-2.8L-9.2 0L-10.5 2.8Z`.
Dipakai sebagai **kawanan melingkar** di sekitar avatar (dashboard, popup mini, loading, profil) dan di **roda menu HP** — bukan logo. Bagian depan kawanan lebih rapat/terang. Warna = warna state. Logo resmi memakai berkas logo pemilik.

## 5a. Logo
Logo resmi: `static/logo/`, `src/lib/brand/AnchoaLogo.svelte`, canvas halaman **Logo**. Latar ikon #10303A, teri #C6F36B, kawanan kecil gradasi #CFE3EA → #C6F36B, titik tujuan #FFFFFF. ≤ 32 px pakai versi kecil (tanpa kawanan kecil). Animasi: intro 2,2 dtk sekali, loading loop 2,4 dtk, idle 3,6 dtk; tidak ada animasi di ≤ 48 px. Jangan mengubah warna, memberi outline/bayangan, atau memutar logo (titik putih selalu di kanan).

## 6. Aturan performa (wajib)
1. Animasi hanya `transform` dan `opacity`.
2. Semua animasi berulang **pause saat idle** dan saat tab/jendela tidak terlihat (`document.visibilityState`).
3. Render loop avatar berhenti 6 detik setelah idle (hanya bangun untuk berkedip), FPS maks 30; di popup mini pakai gambar diam `ako-diam.png`, bukan 3D.
4. `prefers-reduced-motion` → matikan semua animasi.
5. Tanpa `backdrop-filter`/blur, partikel, atau animasi hitung-naik angka.

## 7. Aksesibilitas
- Elemen interaktif = `<button>`, `<a href>`, `<input>` asli; tombol ikon wajib `aria-label`.
- Sakelar: `role="switch"` + `aria-checked`. Tombol toggle: `aria-pressed`.
- Status asisten, label periode, dan hasil palette: `aria-live="polite"`.
- Kontras teks ≥ 4.5:1 (palet di atas sudah memenuhi pada `--bg`/`--surface`).
- Warna bukan satu-satunya penanda (terlambat juga bertuliskan "terlambat", dsb.).

## 8. Integrasi & data
Lihat `docs/ARCHITECTURE.md` — data di Supabase (Postgres + RLS), file di laptop via Tailscale + SFTP, email & unduhan di perangkat, AI lewat Edge Function `ai-gateway`.

## 9. Urutan pengerjaan
Lihat `docs/ROADMAP.md` (Fase 0 = uji coba animasi & performa sebagai gerbang keputusan).
