---
description: Bandingkan halaman yang sudah dibuat dengan desain (contoh: /cek-desain jadwal)
argument-hint: <nama halaman>
---

Bandingkan implementasi halaman **$ARGUMENTS** dengan desainnya.

Sumber desain:
- Bagian halaman ini di `docs/design/DESIGN.md`
- Screenshot di `docs/design/screenshots/` (nama file sesuai artboard; Dashboard = `Main.png`)
- Artboard di `docs/design/artboards/` untuk ukuran, warna, dan state yang persis

Periksa dan laporkan dalam tabel (Bagian · Desain · Implementasi · Perlu diperbaiki?):
1. Layout & ukuran (lebar kolom, tinggi, gap, radius).
2. Warna & tipografi — hanya boleh memakai variabel dari `tokens.css`, tidak ada hex lepas.
3. State interaktif (hover, fokus, terpilih, kosong, terlambat, dsb.).
4. Aksesibilitas (elemen asli, aria-label, aria-pressed/checked, fokus keyboard).
5. Aturan performa (animasi hanya transform/opacity, pause saat idle, reduced-motion).

Jangan langsung mengubah kode. Tunjukkan daftar perbaikan dulu, urutkan dari yang paling terlihat.
