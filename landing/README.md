# Anchoa Landing Page

Landing page mengikuti warna, font, tata letak, konten, dan ilustrasi laut dari `Anchoa.html` yang diberikan pengguna. Visi produk mengikuti `Anchoa.md`. Dibangun dengan **Astro, TypeScript strict, dan CSS native**; hasilnya HTML statis tanpa server aplikasi atau runtime framework UI.

## Menjalankan

Gunakan Node.js 22.12+ dan Bun. Dependency terkunci di `bun.lock`.

```sh
bun install --frozen-lockfile
bun run dev
```

Buka `http://localhost:4321`. Untuk hasil produksi:

```sh
bun run build
bun run preview
```

Jika lingkungan membatasi penulisan konfigurasi global, tambahkan `ASTRO_TELEMETRY_DISABLED=1` sebelum perintah Bun.

## Struktur dan maintenance

```text
public/                      Favicon dan kartu berbagi SVG/PNG
src/
  assets/fonts/              Font WOFF2 lokal beserta lisensinya
  components/                Satu komponen per bagian halaman
    dashboard.html           Salinan 1:1 artboard dashboard desktop dan HP dari referensi
    ui/                      Tombol bahasa
  config/site.ts             Metadata, tautan, versi, dan perintah instalasi
  content/translations.ts    Seluruh teks Indonesia/Inggris
  layouts/BaseLayout.astro   HTML, SEO, preload font, stylesheet
  pages/                     Halaman utama, robots.txt, sitemap.xml
  scripts/interactions.ts    Bahasa, clipboard, tugas, kedalaman, reveal
  scripts/ocean.ts           Siklus simulasi dan partikel laut
    ocean/types.ts           Tipe partikel
    ocean/renderers.ts       Gambar spesies dengan Canvas
  styles/global.css          Palette, typography, layout dari referensi
  styles/accessibility.css   Keyboard, skip link, dan reduced motion
scripts/                     Screenshot, audit, perbandingan referensi
tests/                       Pengujian browser desktop/mobile
```

Ubah konten di `src/content/translations.ts`; tipe memastikan setiap kunci Indonesia memiliki terjemahan Inggris. Ubah tautan dan perintah di `src/config/site.ts`. Komponen dirangkai di `src/pages/index.astro`. Warna dan ukuran berada di `src/styles/global.css`. Teks HTML terjemahan hanya berasal dari konten yang dibundel, bukan input pengguna.

Font Space Grotesk, IBM Plex Sans, dan JetBrains Mono memakai delapan subset Latin WOFF2 lokal. Halaman tidak menghubungi Google Fonts atau CDN. Lisensi setiap keluarga font tersedia di `src/assets/fonts/`.

## Performa dan interaksi

- HTML dibuat saat build. Dashboard desktop dan HP adalah salinan 1:1 artboard referensi yang diskalakan dengan CSS `transform`; animasinya berhenti saat di luar layar. Tidak ada hydration, library UI, analytics, atau request API produk.
- Ilustrasi memakai SVG dan Canvas. Laut tetap terlihat di sepanjang halaman seperti referensi: kawanan teri, tuna, ubur-ubur, penyu, pari, dan ikan lentera.
- Simulasi dibatasi 30 fps dan DPR 1.5. Jumlah ikan mengikuti luas layar, dibatasi 60–300, dan berkurang jika rendering melambat. Spatial grid membatasi pencarian tetangga.
- Animasi berhenti saat tab tersembunyi atau pengguna memilih reduced motion. Tombol jeda muncul ketika mendapat fokus keyboard.
- Bahasa ID/EN tersimpan lokal; kegagalan akses storage tidak menghalangi halaman. Preview tugas adalah data contoh tanpa backend.
- FAQ menggunakan `details/summary`. Konten utama, tautan unduh, dan FAQ tersedia tanpa JavaScript. Bahasa dan clipboard menggunakan JavaScript.
- Skip link, focus indicator, checkbox asli, area kode yang bisa di-scroll dengan keyboard, dan live region clipboard tersedia tanpa mengubah tampilan normal referensi.

## Pemeriksaan

```sh
bun run format:check
bun run build
bunx playwright install chromium
bun run test:e2e
bun run inspect
```

Tes menggunakan hasil build. Cakupan: error browser, overflow, anchor, preview tugas, FAQ, bahasa dan persistensinya, clipboard, reduced motion, tanpa JavaScript, dan aksesibilitas struktur. Satu tes toggle keyboard hanya dijalankan di desktop.

Palette referensi dipertahankan sesuai permintaan pengguna. Karena teks sekunder referensi memiliki kontras rendah, tes struktur mengecualikan aturan `color-contrast`. `bun run inspect` tetap menjalankan audit penuh dan menyimpan temuan kontras di `test-results/accessibility-desktop.json` dan `accessibility-mobile.json`; hasil ini bukan klaim kepatuhan WCAG penuh.

Inspeksi juga menyimpan screenshot desktop/mobile, menampilkan ukuran JavaScript/CSS gzip dan request eksternal, serta memperbarui `public/social-card.png` dari SVG. Jalankan build setelah memperbarui kartu berbagi.

Untuk membandingkan dengan HTML asli yang tersedia lokal:

```sh
bun run compare:reference /path/to/Anchoa.html
```

Script memakai font lokal yang sama tanpa mengubah file asli. Perbandingan mencakup posisi, ukuran, font, warna, tinggi halaman, dan overflow pada lebar 1440, 1024, 768, 390, dan 320 px. Screenshot dan pengukuran tersimpan di `test-results/reference-comparison/`. Canvas disembunyikan saat perbandingan agar gerakan partikel tidak memengaruhi hasil.

Jika Chromium sudah terpasang, gunakan `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium` sebelum perintah tes atau inspeksi. `PREVIEW_URL` dapat mengganti alamat preview pada script inspeksi/perbandingan.

## Hosting

Halaman ini tayang di https://syharipf.github.io/Anchoa/, satu situs GitHub Pages dengan repo dnf (`anchoa.repo`, `rpm/`). Setiap deploy Pages mengganti seluruh situs, jadi `.github/workflows/dnf-repo.yml` di root repo selalu membangun keduanya. Workflow berjalan saat push ke `main` yang mengubah `landing/**`, saat rilis dipublikasikan, atau manual.

Untuk build lokal dengan path yang sama:

```env
SITE_URL=https://syharipf.github.io
BASE_PATH=/Anchoa/
```

Untuk root domain, gunakan `BASE_PATH=/`. `SITE_URL` dipakai canonical URL, Open Graph, robots.txt, dan sitemap.

Konten produk mengikuti visi `Anchoa.md`, termasuk asisten suara, Supabase, Tailscale, dan model keamanan. Copr/Flatpak ditampilkan sebagai rencana seperti referensi. Saat memperbarui halaman, cocokkan status produk dan tautan rilis di `src/config/site.ts`; tautan LinkedIn masih memakai alamat umum dari referensi.
