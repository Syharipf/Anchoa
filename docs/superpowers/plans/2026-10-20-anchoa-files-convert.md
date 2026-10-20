# Konverter format di menu Berkas

Tanggal: 2026-10-20

## Tujuan

Satu berkas bisa dikonversi ke format lain dari menu klik kanan Berkas, tanpa
membuka aplikasi lain atau situs web. Semua konversi berjalan lokal.

## Matriks

| Sumber | Target | Tool |
|---|---|---|
| png, jpg/jpeg, webp, avif, bmp, gif, tif/tiff, ico, svg, heic/heif | png, jpg, webp, avif, tif, bmp, gif, ico, pdf | `magick` |
| pdf | png, jpg, tif (halaman pertama), txt | `pdftoppm`, `pdftotext` |
| mp3, wav, ogg/oga, opus, flac, m4a, aac | mp3, m4a, ogg, opus, flac, wav | `ffmpeg` |
| mp4, m4v, mov, webm, mkv, avi, ogv | mp4, webm, mkv + target audio | `ffmpeg` |

Format tujuan yang sama dengan sumber (termasuk sinonim `jpeg`/`jpg`,
`tiff`/`tif`, `oga`/`ogg`, `m4v`/`mp4`) tidak ditawarkan.

## Backend

`src-tauri/src/convert.rs`:

- Deteksi tool lewat `PATH` (cache `LazyLock`), `capabilities()` mengembalikan
  baris format yang tool-nya tersedia.
- `convert_file(path, target, roots)`: `files::guard`, normalisasi target,
  cek rule, cap gambar 512 MB, klaim nama output dengan `create_new`
  (`berkas.jpg`, `berkas (2).jpg`, …), jalankan CLI dengan `OsString` terpisah,
  lalu pastikan hasil ada dan tidak kosong. Output parsial dihapus lewat `Drop`.
- Command: `convert_capabilities`, `convert_file`. Tanpa migrasi DB dan tanpa
  crate baru.

Batas yang diketahui: tidak ada progress/cancel per proses, dokumen kantor
(docx/odt/xlsx) belum didukung karena LibreOffice tidak terpasang, dan PDF hanya
halaman pertama.

## UI

- Item menu `Konversi…` muncul untuk berkas lokal non-folder yang punya target.
- `ConvertDialog`: pilih format, pratinjau nama output, catatan tidak menimpa,
  dan catatan "hanya halaman pertama" untuk PDF.
- Pilihan folder (dialog ekstrak/pindah dan form proyek agen) memakai
  `FolderPicker` dari Berkas, bukan lagi dialog sistem.

## Test

- Rust: capabilities deterministik dengan `Tools` palsu, penolakan pasangan
  tidak valid, argv tanpa shell, klaim nama unik, cleanup, guard, dan satu
  konversi PNG→JPG nyata bila `magick` ada.
- Frontend: `fileExtension`, `convertedName`, `targetsFor`, render
  `ConvertDialog`, visibilitas item menu (lokal vs rclone).
- E2E Xvfb: konversi PNG→JPG lewat menu dan cek berkas hasil di disk.
