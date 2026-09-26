# Cari Nama — Desain

Tanggal: 2026-09-25. PRD: §4.4, R9.

## Scope

Masuk: filter nama di folder aktif (mulai mengetik) dan cari rekursif by nama/glob (Ctrl+F) di worker, bisa dibatalkan (Esc). Hanya nama, tidak pernah isi file.

Tidak masuk: cari isi file (di luar scope PRD), indeks/cache, hasil bertahap selama pencarian (hasil muncul sekaligus saat selesai — ponytail: kirim per batch bila pencarian besar terasa lambat), kolom "Lokasi" terpisah.

## Perilaku

Satu `gtk::SearchBar` + `gtk::SearchEntry` di atas list file, dengan dua mode:

- **Filter (mulai mengetik di list):** key capture dari list membuka search bar. Setiap perubahan teks memfilter entry folder aktif di UI thread (data sudah ada di memori) lewat filter kedua di `TypedColumnView`, memakai `search::matches`. Esc: kosongkan, tutup bar, filter mati, fokus kembali ke list.
- **Rekursif (Ctrl+F):** bar terbuka dengan placeholder `Search in <folder> and below`. Enter menjalankan `search::walk` di worker dari folder aktif; spinner/label "Searching…" selama berjalan. Hasil menggantikan isi list; tiap entry bernama path relatif terhadap folder asal (`sub/a.jpg`), jadi lokasinya terbaca tanpa kolom baru. Enter/aktivasi pada hasil folder membuka folder itu (navigasi biasa, keluar dari mode hasil); pada file: tidak ada aksi (sama seperti list biasa).
- Esc saat pencarian berjalan: set flag batal, hasil diabaikan. Esc saat menampilkan hasil: kembali ke listing folder aktif. Pencarian baru membatalkan yang lama.
- Hasil mengikuti toggle file tersembunyi (Ctrl+H) saat pencarian dimulai.
- Operasi file (Delete, F2, command panel, dst.) di mode hasil memakai `Entry.path`, bukan `name`, sehingga tetap benar. Rename memakai nama file dari `path`, bukan path relatif.

## Unit baru: `anchoa::search` (`src/search.rs`)

- `matches(query: &str, name: &str) -> bool`: case-insensitive. `query` berisi `*` atau `?` → glob utuh (`planner::glob_match`, dijadikan `pub`) terhadap nama lowercase; selain itu substring. `query` kosong/spasi saja → `true`.
- `walk(root: &Path, query: &str, hidden: bool, cancel: &AtomicBool) -> Vec<Entry>`: blocking, worker.
  - Menelusuri `root` rekursif (tidak termasuk `root` sendiri). Entry yang namanya cocok ikut hasil, folder tetap ditelusuri meski namanya tidak cocok.
  - `hidden = false`: nama berawalan `.` tidak dicocokkan dan folder tersembunyi tidak dimasuki.
  - Symlink ke folder tidak diikuti (hindari loop); symlink sendiri tetap bisa cocok.
  - Folder yang tidak bisa dibaca dilewati diam-diam.
  - `Entry.name` = path relatif terhadap `root`; field lain seperti `fs::list_dir`.
  - Dicek `cancel` sebelum membaca tiap folder; `true` → berhenti dan kembalikan `Vec` kosong.
  - Urutan hasil: path relatif, case-insensitive (deterministik).

## Test (ditulis dulu, pelaksana tidak boleh mengubah)

`tests/search.rs`: `matches` (substring, case-insensitive, glob, glob tidak parsial, query kosong); `walk` (rekursif + nama relatif + urutan, folder tidak cocok tetap ditelusuri, hidden off/on, symlink folder tidak diikuti, folder tak terbaca dilewati, cancel → kosong).

UI (key capture, Ctrl+F, Esc, spinner) diuji manual oleh pengguna.
