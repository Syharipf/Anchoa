# Anchoa — Fase 6: Berkas

Tanggal: 2026-10-01
Status: user menyetujui semua usulan jawaban B1–B11 (`2026-10-01-anchoa-fase6-berkas-questions.md`) pada 2026-10-01. Detail lain diputuskan Claude (lihat §2). Mengikuti `docs/design/artboards/Berkas.dc.html` dan `DESIGN.md` §2 "Berkas (mirip Thunar)". Ini versi awal.

## 1. Ringkasan

Pengelola file lokal di dalam Anchoa:
- sidebar **Tempat** dan **Perangkat**;
- tombol kembali, maju, dan naik, serta breadcrumb;
- tampilan ikon atau daftar;
- **panel pratinjau** (320px, hanya kalau tepat satu item dipilih): foto, video, PDF, teks/kode, isi folder, atau "pratinjau belum tersedia";
- **pilih banyak** dengan Ctrl+klik dan Shift+klik, yang memunculkan bar aksi Salin, Pindahkan, dan Hapus dengan total ukuran;
- **Tempel** di folder tujuan, dan **Hapus** yang memindahkan ke Tong Sampah.

## 2. Keputusan

| Kode | Keputusan | Asal |
|---|---|---|
| F1 | Tempat: Home, Dokumen, Unduhan, Gambar, Video, Musik (folder XDG dari `~/.config/user-dirs.dirs`, dengan nama default kalau file itu tidak ada), dan folder data Anchoa. | B1 |
| F2 | Perangkat: mount di bawah `/run/media/$USER`, dibaca dari `/proc/mounts`. Tidak ada format atau eject. | B2 |
| F3 | Akar yang diizinkan hanya home dan perangkat F2. Setiap path dari frontend dinormalkan dengan `canonicalize` (symlink diikuti) lalu dicek prefiksnya. Path di luar akar ditolak dengan `Invalid`. | B3, keamanan |
| F4 | Hapus memindah ke Tong Sampah lewat `gio trash`. Tidak ada hapus permanen. | B4 |
| F5 | Kalau nama sudah ada di tujuan, muncul satu dialog untuk seluruh operasi: Ganti, Lewati, atau Simpan dengan nama baru ("nama (2).ext"). | B5 |
| F6 | PDF memakai penampil bawaan WebKitGTK (2.54 sudah memuat PDF.js) di `<iframe>` lewat protokol aset Tauri. Tanpa dependency baru. | B6 |
| F7 | Thumbnail gambar memakai file aslinya lewat protokol aset dengan `loading="lazy"`, jadi hanya yang terlihat yang dimuat. Video memakai ikon. Cache GNOME tidak dipakai. | B7, YAGNI |
| F8 | File tersembunyi disembunyikan secara default, dengan toggle "Tampilkan tersembunyi" yang diingat di `localStorage`. | B8 |
| F9 | Tombol asisten per jenis berkas nonaktif ("Hadir di Fase 5"). | B9 |
| F10 | Tautan file ke item Anchoa dan lokasi "Laptop" ditunda. | B10, B11 |
| F11 | Salin dan pindah memakai papan klip ala Thunar: Salin atau Pindahkan menyimpan pilihan, lalu tombol "Tempel n item" muncul di toolbar folder mana pun. Tidak perlu dialog pemilih folder. | Claude |
| F12 | Operasi file berjalan di thread latar (`spawn_blocking`). UI menampilkan toast "Menyalin 3 item…", lalu "Selesai", atau daftar yang gagal. Tidak ada bar progres per byte di versi awal. | Claude |
| F13 | Membuka file dengan aplikasi bawaan (dobel klik) lewat `tauri-plugin-opener` `open_path`, setelah path dicek seperti F3. Dobel klik folder membuka folder itu. | Claude |
| F14 | Kartu "Berkas terbaru" di dashboard tetap berisi Catatan terbaru. Berkas terbaru butuh riwayat GNOME (`recently-used.xbel`), dan itu ditunda. | Claude, YAGNI |
| F15 | E2E menjalankan app dengan `HOME` sementara berisi file contoh, sehingga tidak pernah menyentuh file asli user. | Claude, keamanan |

## 3. Backend (`files.rs`)

Tidak ada migrasi.

| Command | Masukan | Keluaran |
|---|---|---|
| `file_places` | - | `{ places: Place[], devices: Place[] }`, dengan `Place { name, path, icon }` |
| `list_dir` | `{ path, hidden }` | `{ path, parent?, crumbs: { name, path }[], entries: Entry[] }` |
| `read_text` | `path` | `{ text, truncated }` (paling banyak 64 KB, UTF-8 lossy) |
| `paste_items` | `{ sources[], dest, mode: copy\|move, onConflict?: replace\|skip\|rename }` | `{ done[], failed: { path, error }[], conflicts[] }` |
| `trash_items` | `paths[]` | `{ done[], failed[] }` |
| `open_file` | `path` | `()` |

```
Entry { name, path, kind: folder|image|video|pdf|text|other, size (byte; folder: jumlah item),
        modified (epoch ms), hidden }
```

- **Jenis** ditentukan dari ekstensi:
  - image: png jpg jpeg gif webp svg bmp avif;
  - video: mp4 webm mkv mov;
  - pdf;
  - text: txt md json toml yaml yml rs ts tsx js css html sh py csv log.
- **Urutan:** folder dulu, lalu nama (tidak membedakan huruf besar-kecil).
- **Konflik:** `paste_items` tanpa `onConflict` hanya mengembalikan `conflicts` kalau ada nama yang bentrok, dan tidak menyalin apa pun. Frontend lalu bertanya dan memanggil lagi dengan pilihan user.
- **Rekursif:** salin folder dilakukan secara rekursif. Pindah memakai `rename` kalau masih di sistem file yang sama, dan salin-lalu-hapus kalau beda.
- **Folder ke dalam dirinya sendiri** ditolak `Invalid`.
- **`tauri.conf.json`:**
  - `app.security.assetProtocol` aktif dengan scope `$HOME/**` dan `/run/media/**` (butuh fitur Cargo `protocol-asset` pada `tauri`);
  - CSP: `img-src 'self' data: asset: http://asset.localhost`, `media-src asset: http://asset.localhost`, `frame-src asset: http://asset.localhost`.

## 4. UI

Mengikuti `Berkas.dc.html`. Halaman Berkas menggantikan halaman "menyusul".

- **Sidebar (200px):** Tempat dan Perangkat. Bagian Perangkat tidak ditampilkan kalau tidak ada perangkat.
- **Toolbar:**
  - ‹ › ↑ (`aria-label` lengkap) dan breadcrumb yang bisa diklik;
  - toggle ikon/daftar dan "Tampilkan tersembunyi";
  - "Tempel n item" kalau papan klip tidak kosong (dengan × untuk mengosongkan).
- **Isi folder:**
  - grid ikon (thumbnail gambar, ikon per jenis) atau daftar (nama, ukuran, diubah);
  - klik memilih, Ctrl+klik menambah atau mengurangi, Shift+klik memilih rentang;
  - dobel klik membuka; Enter membuka; Backspace naik satu folder;
  - kosong: "Folder kosong".
- **Panel pratinjau (320px):** hanya kalau tepat satu item dipilih. Isinya:
  - nama dan info (jenis, ukuran, diubah);
  - pratinjau: gambar; video dengan kontrol tanpa autoplay; PDF di iframe; teks dengan font mono; daftar isi folder; atau "pratinjau belum tersedia";
  - tombol asisten nonaktif.
- **Bar aksi (bawah)** kalau ada item terpilih: "n item · 12,4 MB", Salin, Pindahkan, Hapus (dengan konfirmasi "Pindahkan n item ke Tong Sampah?"). Bar ini diberi padding kanan 88px supaya tidak tertutup asisten mini.
- **Dialog konflik:** "n nama sudah ada di folder ini" dengan Ganti, Lewati, dan Simpan dengan nama baru.

## 5. Testing

- **Rust** (direktori sementara sebagai akar):
  - XDG parsing;
  - `list_dir` (urutan, jenis, tersembunyi, crumbs);
  - path di luar akar dan symlink keluar akar ditolak;
  - salin file dan folder, pindah, rename;
  - konflik ganti, lewati, dan nama baru;
  - folder ke dalam dirinya sendiri ditolak;
  - `read_text` terpotong;
  - mount parsing dari teks contoh.
  - `gio trash` diuji lewat fungsi yang command-nya bisa disuntikkan, supaya test tidak benar-benar menghapus file.
- **Frontend:** seleksi (klik, Ctrl, Shift), format ukuran ("12,4 MB"), dan label jenis.
- **E2E** (`check_files`, dengan `HOME` sementara berisi folder Dokumen, gambar PNG, file teks, dan PDF kecil):
  - buka Berkas;
  - pilih gambar, lalu screenshot pratinjau;
  - Ctrl+klik dua file, lalu Salin, masuk folder, Tempel, dan cek file ada di disk;
  - Hapus satu file, lalu cek file pindah ke Tong Sampah `HOME` sementara (`$HOME/.local/share/Trash/files`).

## 6. Rencana PR

Rinciannya ada di `docs/superpowers/plans/2026-10-01-anchoa-fase6-berkas.md`.

| PR | Isi |
|---|---|
| 6-1 | `files.rs`, command, protokol aset dan CSP, tipe API |
| 6-2 | Halaman Berkas, pratinjau, seleksi, papan klip, dialog konflik, E2E dengan `HOME` sementara, versi 0.7.0, rilis "Anchoa v0.7.0 — Berkas" |
