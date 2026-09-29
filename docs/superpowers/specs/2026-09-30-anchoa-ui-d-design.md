# Anchoa — Redesign UI arah D (Studio Malam + avatar suara)

Tanggal: 2026-09-30
Status: disetujui user (2026-09-30).

- **Acuan visual:** `docs/design/DESIGN.md` dan `docs/design/anchoa-dashboard-d.dc.html`.
- **Isi dokumen ini:** keputusan implementasi yang tidak tertulis di sana.

## Keputusan

| Topik | Keputusan |
|---|---|
| Tema | Gelap saja. Ini menggantikan "tema mengikuti sistem" di spec Fase 1 §7. |
| Token warna | Token `DESIGN.md` menjadi token Tailwind v4 (`@theme`): `canvas` (bg), `sidebar`, `surface`, `surface-2`, `stage`, `stage-disc`, `line` (border), `ink` (text), `muted`, `done`, `disabled`, `accent`, `accent-hover`, `danger`, `danger-row`, `field-focus`, `heat-0`…`heat-4`. |
| Font | Space Grotesk, IBM Plex Sans, dan JetBrains Mono dibundel lewat `@fontsource/*`. Google Fonts tidak dipakai karena CSP melarang CDN. |
| Layout | Nav rail 72px, main, dan aside 380px. Logo memakai placeholder "A" sampai file logo asli ada. |
| Bilah perintah | `Ctrl K` memfokuskan bilah (`Ctrl N` tetap berlaku sebagai alias). Enter menyimpan teks sebagai catatan di Inbox. Fungsi cari dan perintah menyusul. |
| Tugas selesai | Kolom baru `items.completed_at` (migrasi 002) dan command `complete_item(id, done)`. |
| Daftar "Hari ini" | Berisi: jatuh tempo hari ini (selesai maupun belum), terlambat yang belum selesai, dan item berjatuh tempo yang diselesaikan hari ini. KPI "Tugas hari ini" dihitung dari daftar yang sama. |
| KPI keuangan | Tampil "Belum aktif" sampai Fase 2 (migrasi keuangan bergeser ke nomor berikutnya yang kosong). |
| Indikator Inbox | `get_dashboard` mendapat `inboxCount`. Nav rail menampilkan titik aksen kalau nilainya > 0. |
| Kontribusi GitHub | Diambil dari Rust lewat GraphQL `viewer { contributionsCollection(from, to) … }` dengan crate `ureq`. Token tidak pernah dikirim ke webview (lihat bawah). Rentangnya 6 bulan kalender terakhir. Hasil di-cache di tabel SQLite `contributions` dan diambil ulang paling sering sekali per hari lokal, atau saat user menekan "Muat ulang". Grid bulan, total, persentase vs bulan lalu, dan streak terpanjang dihitung di frontend (fungsi murni dengan test). |
| Token GitHub | Diisi di Pengaturan dan disimpan di file `github-token` di `app_config_dir()` dengan izin `0600`, di luar database, jadi tidak ikut backup. Frontend hanya menerima status `{ connected, login }`. |
| Asisten | Untuk sekarang hanya UI. Status `idle` (Siap, default), `listening` (Mendengarkan…), dan `speaking` (Berbicara) bisa berpindah lewat tombol mic dan keyboard. Tidak ada chip aksi atau balasan palsu: keterangan menyebut bahwa asisten suara aktif di Fase 5. Tombol riwayat dan kirim dinonaktifkan. |
| Performa animasi | Mengikuti `DESIGN.md` §6: hanya `transform`/`opacity`, pause saat `idle` dan saat `document.visibilityState` bukan `visible`, serta tanpa animasi di bawah `prefers-reduced-motion`. |

## Pembagian PR

| PR | Isi |
|---|---|
| UI-1 | Token, font, nav rail, kerangka aside, restyle semua halaman, commit `docs/design/` dan dokumen ini |
| UI-2 | `completed_at` + `complete_item`, `inboxCount`, dashboard D (bilah perintah, jam, KPI, Hari ini dengan checkbox, Item terbaru dengan ikon) |
| UI-3 | Stage asisten (state, kawanan teri, gelombang, denyut mic, aturan performa) |
| UI-4 | Integrasi GitHub (token, fetch, cache, heatmap + navigasi 6 bulan, bagian GitHub di Pengaturan) |

## Testing

- **Rust:** semantik daftar Hari ini dan `complete_item`, `inboxCount`, parsing respons GraphQL, cache harian, dan izin file token.
- **Frontend (`bun test`):** grid heatmap (hari pertama, kolom minggu, level warna), total, persentase vs bulan lalu, streak, dan format jam.
- **E2E:** koordinat klik disesuaikan dengan layout baru; checkbox tugas harus mengisi `completed_at`, dan stage asisten berpindah status. Fetch GitHub sungguhan tidak diuji otomatis karena butuh token, jadi user yang mengeceknya.
