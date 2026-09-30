# Anchoa — Spesifikasi Desain (untuk implementasi)

Dashboard pribadi dengan asisten suara (STT + TTS, avatar Live2D). Tema: **Studio Malam** (gelap).
Stack: **Tauri 2 + React + Tailwind + Rust**, data di SQLite lokal. Aturan teknis ada di `CLAUDE.md`.

> Berasal dari paket `anchoa-final` (lihat `docs/reference/anchoa-final/`). Paket itu memakai SvelteKit dan Supabase; bagian yang menyangkut stack dan data sudah disesuaikan dengan repo ini.
Acuan desktop: **1280×800**.

## 0. Cara memakai paket ini

| Berkas | Isi | Cara pakai |
|---|---|---|
| `DESIGN.md` | Spesifikasi ini | Sumber kebenaran untuk struktur, perilaku, dan aturan |
| `tokens.css` | Warna, font, radius, jarak, animasi | Salin nilainya ke `@theme` di `src/index.css`. Font dibundel lewat `@fontsource/*`; `@import` Google Fonts di file ini tidak dipakai karena CSP melarang CDN |
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
Dashboard · Inbox · Email · Jadwal · Keuangan · Proyek · Berkas · Unduhan — lalu di bawah: Notifikasi (lonceng + titik coral) · Profil (avatar inisial) · Pengaturan.
- Aktif: latar `--surface-2`, ikon `--accent`, `aria-current="page"`.
- Semua ikon wajib punya tooltip (title) dan `aria-label`.
- Badge: Inbox = titik lime; Email = angka belum dibaca (pil lime).
- **Inbox diimplementasikan sebagai "Catatan"** (route `/catatan`): isinya ide/catatan cepat, bukan email. Label di artboard masih "Inbox".

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
Latar `--sidebar`. Tempat logo 96px di tengah, dikelilingi cincin kawanan teri (≈26 ikan) yang berputar 7s. Nama "Anchoa", bar progres 240×3 (scaleX), teks tahap: data lokal → model suara → avatar Live2D → sinkron jadwal & email → "Siap.". Setelah siap: cincin berhenti & meredup. **Target < 2 detik**: tampilkan Dashboard secepatnya, muat Live2D & model suara di latar belakang.

### Dashboard (rekap cepat)
- Sapaan + ringkasan satu baris + tombol **Dengarkan rekap** (asisten membacakan rekap di panel kanan).
- Pintasan (pil): Tugas, Transaksi, Catatan suara, Unduh dari clipboard, Tulis email.
- Bento 3×3: **Hari ini** (2 kolom; checkbox tugas + bar segmen) · **Keuangan** (saldo, keluar bulan ini, chip status tagihan) · **7 hari ke depan** (2 kolom; per hari: nama hari, tanggal, titik warna kategori, item pertama, "+n lagi") · **Email** (3 terbaru) · **Proyek** (2 proyek + progres) · **Unduhan** (2 aktif + progres, kecepatan total) · **Berkas terbaru** (3 item). Setiap kartu = tautan ke modulnya.
- Panel kanan: strip kontribusi kode (heatmap bulanan mini + total + % vs bulan lalu + streak, navigasi bulan ‹ ›) di atas, asisten suara penuh di bawah.

### Email
Tiga kolom: folder (176px; Kotak masuk, Berbintang, Terkirim, Draf, Arsip, Spam + Label berwarna kategori) · daftar (340px; tab Semua/Belum dibaca, titik lime = belum dibaca, bintang) · isi. Isi email: subjek, pengirim, **Ringkasan asisten** (poin-poin + Bacakan + satu aksi kontekstual: Tambahkan ke Jadwal / Tandai lunas / Jadikan tugas), badan email, bar balasan (saran balasan cepat, input, tombol dikte suara, Kirim). Bar balasan diberi padding kanan 88px agar tidak tertutup tombol asisten.

### Jadwal
Toggle **Kalender | Timeline**, navigasi periode, tombol Hari ini, filter jenis (Proyek/Tagihan/Pribadi).
- Kalender: grid bulan, maksimal 3 chip per sel (2 jika 6 baris) + "+n lagi"; klik tanggal → panel agenda kanan (Terlambat, Tenggat hari itu, 7 hari berikutnya, bisa dicentang).
- Timeline: 8 minggu, 16px/hari, dikelompokkan per proyek; batang penuh = dikerjakan, garis tepi = rencana, belah ketupat = tenggat; bingkai coral = terlambat; garis lime = hari ini.
- Warna = **jenis** (3 kategori), bukan per proyek.

### Keuangan
Header bulan + Catat lewat suara + Transaksi. 4 kartu (Saldo, Pemasukan, Pengeluaran, Arus bersih). Grafik arus kas 6 bulan (batang masuk/keluar, klik pilih bulan). Transaksi terbaru (filter Semua/Masuk/Keluar, dikelompokkan per bulan). Akun (bar porsi saldo). Tagihan (tombol Tandai lunas).

### Proyek
Daftar proyek (kartu progres, klik pilih) + Tenggat terdekat. Header proyek (persen, deadline, status repo). Kanban 3 kolom (Rencana / Dikerjakan / Selesai); tombol → memindah kartu ke kolom berikutnya; progres ikut diperbarui.

### Berkas (mirip Thunar)
Sidebar Tempat/Perangkat, tombol kembali/maju/naik, breadcrumb, tampilan ikon/daftar. **Panel pratinjau kanan (320px) hanya muncul jika tepat satu item dipilih**: foto, video (play/progres), PDF (navigasi halaman), teks/kode, isi folder, atau "pratinjau belum tersedia". Ctrl+klik = pilih banyak → panel hilang, muncul bar Salin/Pindahkan/Hapus + total ukuran. Tombol asisten kontekstual per jenis berkas.
- Performa: thumbnail dibuat hanya untuk item yang terlihat + cache; PDF render per halaman (mis. pdf.js); video tidak autoplay.

### Unduhan
Kotak tautan dengan deteksi jenis: media (yt-dlp) · file langsung (aria2) · magnet/.torrent. Opsi media: Video/Audio saja, resolusi atau bitrate, format, subtitle. Antrean dengan tab Semua/Aktif/Selesai/Torrent/Gagal; status: Mengunduh, Dijeda, Menunggu, Memproses (ffmpeg), Membagikan, Selesai, Gagal. Panel mesin (yt-dlp + Perbarui, ffmpeg, aria2, **Torrent opsional**) dan pengaturan (folder, unduhan bersamaan, batas kecepatan, pantau clipboard, rasio seeding).
- yt-dlp perlu pembaruan berkala (cek otomatis). ffmpeg wajib untuk menggabungkan video+audio resolusi tinggi. Torrent **mati secara default** (IP terlihat oleh peer); aria2 sudah mendukung BitTorrent, libtorrent jika butuh fitur lebih.

### Profil
Kartu profil (avatar + cincin teri, statistik), Keamanan (PIN, enkripsi data lokal, keluar), Akun terhubung (repo kode, email IMAP, kalender), Asisten suara (jenis suara + contoh, kecepatan, kata pemanggil "Hai Anchoa", proses suara di perangkat, bahasa), Notifikasi (sakelar per jenis + jam tenang).

## 3. Asisten suara — state

| State | Label | Warna aksen | Animasi |
|---|---|---|---|
| `speaking` | Berbicara | `--accent` | kawanan berputar, gelombang bergerak |
| `listening` | Mendengarkan… | `--danger` | kawanan berputar, gelombang + denyut mikrofon |
| `idle` | Siap | `--accent` (redup) / `--muted` | **semua berhenti** (pause), cincin opacity turun |

Tap mikrofon: `listening` ↔ `idle`. Teks balasan TTS selalu tampil sebagai caption (aksesibilitas + lingkungan bising).

## 4. Komponen (ringkas)
- **Tombol:** primer (lime, teks `--on-accent`, 600), sekunder (surface + border), hantu, bahaya (outline coral), ikon 32–38px, mikrofon 64 (penuh) / 44 (mini).
- **Input:** tinggi 40–44, radius 10, border `--border`; fokus → border `--done`.
- **Kontrol:** segmented (latar `--surface`, item aktif `--surface-2`), chip pilihan (aktif: border `--done`), sakelar 40×22 (on: lime + knob gelap), checkbox native `accent-color: var(--accent)`.
- **Status:** titik 6px + label; progres 4px; progres bersegmen (selesai lime / terlambat coral / belum border).
- **Kartu:** radius 14, border 1px, tanpa bayangan. Bayangan hanya untuk popup/overlay.
- **Teks di atas warna data** selalu memakai token teks, bukan warna kategori.

## 5. Motif teri
Satu bentuk (badan lensa + ekor bercabang), path SVG: `M-7 0C-3-2.4 3-2.6 7 0C3 2.6-3 2.4-7 0ZM-6 0L-10.5-2.8L-9.2 0L-10.5 2.8Z`.
Dipakai sebagai **kawanan melingkar** di sekitar avatar (dashboard, popup mini, loading, profil) — bukan logo. Bagian depan kawanan lebih rapat/terang. Warna = warna state. Logo resmi memakai berkas logo pemilik.

## 6. Aturan performa (wajib)
1. Animasi hanya `transform` dan `opacity`.
2. Semua animasi berulang **pause saat idle** dan saat tab/jendela tidak terlihat (`document.visibilityState`).
3. Render loop Live2D ikut berhenti / turun FPS saat idle; di popup mini pakai gambar statis, bukan Live2D.
4. `prefers-reduced-motion` → matikan semua animasi.
5. Tanpa `backdrop-filter`/blur, partikel, atau animasi hitung-naik angka.

## 7. Aksesibilitas
- Elemen interaktif = `<button>`, `<a href>`, `<input>` asli; tombol ikon wajib `aria-label`.
- Sakelar: `role="switch"` + `aria-checked`. Tombol toggle: `aria-pressed`.
- Status asisten, label periode, dan hasil palette: `aria-live="polite"`.
- Kontras teks ≥ 4.5:1 (palet di atas sudah memenuhi pada `--bg`/`--surface`).
- Warna bukan satu-satunya penanda (terlambat juga bertuliskan "terlambat", dsb.).

## 8. Integrasi & data
Data di SQLite lokal lewat command Rust (spec Fase 1 §4–6). Email dan unduhan berjalan di perangkat. Rencana sync lintas perangkat (data ke cloud, file di laptop lewat Tailscale + SFTP) ada di `docs/reference/anchoa-final/ARCHITECTURE.md`, untuk fase Multi-device.

## 9. Urutan pengerjaan
Lihat roadmap di `docs/superpowers/specs/2026-09-29-anchoa-fase1-design.md` §13.
