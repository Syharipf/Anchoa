# Anchoa — Fase 6: Berkas (daftar pertanyaan)

Tanggal: 2026-10-01
Status: **belum dimulai**. Claude menyusun daftar ini saat user tidur, tapi tidak mengimplementasikan Fase 6, karena modul ini membaca, menyalin, memindah, dan menghapus file asli di disk dan butuh keputusan user. Setiap pertanyaan diberi usulan jawaban. Jawab singkat, misalnya "B1 ya, B4 pakai trash". Setelah itu spec dan rencana bisa ditulis.

Acuan: `docs/design/artboards/Berkas.dc.html`, dan `DESIGN.md` §2 "Berkas (mirip Thunar)".

| # | Pertanyaan | Usulan |
|---|---|---|
| B1 | Folder apa saja di sidebar "Tempat"? | Home, Dokumen, Unduhan, Gambar, Video, Musik (folder XDG), ditambah folder data Anchoa. |
| B2 | "Perangkat": tampilkan drive yang ter-mount (USB, partisi lain)? | Ya, hanya baca daftar mount dari `/proc/mounts` yang ada di bawah `/run/media/$USER`. Tidak ada format atau eject. |
| B3 | Boleh keluar dari home (misalnya `/etc`)? | Tidak. Hanya home dan perangkat di B2, supaya salah klik tidak menyentuh file sistem. |
| B4 | "Hapus" memindah ke Tong Sampah atau menghapus permanen? | Pindah ke Tong Sampah (`gio trash`), jadi bisa dipulihkan. Tidak ada hapus permanen di versi awal. |
| B5 | Salin dan pindah: kalau nama sudah ada? | Tanya lewat dialog: Ganti, Lewati, atau Simpan dengan nama baru ("nama (2).ext"). |
| B6 | Pratinjau PDF: tambah dependency `pdfjs-dist` (±2 MB) atau pakai penampil PDF bawaan WebKit? | Coba penampil bawaan WebKitGTK dulu lewat protokol aset Tauri. Kalau tidak jalan, pakai `pdfjs-dist`. |
| B7 | Thumbnail gambar dan video: dibuat Anchoa, atau pakai cache thumbnail GNOME (`~/.cache/thumbnails`)? | Pakai cache GNOME kalau ada. Kalau tidak ada, gambar ditampilkan diperkecil lewat protokol aset; video tanpa thumbnail. |
| B8 | File tersembunyi (awalan titik)? | Disembunyikan secara default, dengan toggle "Tampilkan tersembunyi". |
| B9 | Tombol asisten kontekstual per jenis berkas (ringkas PDF, dan lain-lain)? | Nonaktif sampai Fase 5. |
| B10 | Tautan file ke item Anchoa (misalnya lampiran di tugas)? | Ditunda. Versi awal hanya pengelola file. |
| B11 | Lokasi "Laptop" lewat Tailscale + SFTP? | Tetap di Fase 9 sesuai roadmap. |

Keamanan (berlaku apa pun jawabannya):
- Frontend tidak pernah mengirim path mentah. Backend hanya menerima path yang berada di bawah akar yang diizinkan (B1–B3), setelah path dinormalkan dan symlink diikuti.
- Operasi file berjalan di thread latar, dan UI menampilkan progres. Kalau gagal di tengah, file yang sudah tersalin tetap ada dan dilaporkan.
- Tidak ada akses jaringan.
