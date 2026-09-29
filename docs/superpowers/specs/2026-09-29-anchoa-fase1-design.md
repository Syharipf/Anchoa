# Anchoa — Fase 1: Fondasi + Dashboard

Tanggal: 2026-09-29
Status: draf, menunggu review

## 1. Ringkasan

Anchoa adalah aplikasi desktop untuk mengelola semua hal pribadi di satu tempat, seperti gabungan Notion dan Obsidian: keuangan, project, task, catatan, dan workspace yang saling terhubung. Aplikasi dibangun bertahap. Fase 1 membangun fondasi yang dipakai semua modul berikutnya, ditambah halaman Dashboard sebagai menu pertama.

Target platform Fase 1: Fedora Linux (mesin pengembang). Windows dan Android menyusul di Fase 6.

## 2. Keputusan yang sudah diambil

| Topik | Keputusan | Alasan singkat |
|---|---|---|
| Arsitektur | Modular monolith: satu proses, satu DB lokal | Aplikasi desktop satu pengguna. Microservice memecah data, padahal fitur inti adalah integrasi antar modul. |
| Stack | Tauri 2 (Rust) + React + TypeScript + Vite + Tailwind CSS | Satu codebase untuk Linux, Windows, dan Android. Ringan. UI berbasis web mendukung Live2D/3D untuk AI Assistant. |
| Tooling JS | bun (package manager dan runtime untuk Vite dan Tauri CLI) | Sudah terpasang, dan `node` di mesin ini mengarah ke bun. |
| Penyimpanan | SQLite via `rusqlite` (fitur `bundled`) | Data terstruktur (uang, tanggal, relasi) mudah di-query. Mirip Notion. |
| Layout | Sidebar kiri, konten tengah, kolom AI tetap di kanan (opsi A) | Dipilih lewat mockup. |

### Hasil uji Live2D (Fase 0)

Uji dilakukan dengan app Tauri kosong + model Live2D contoh (pixi-live2d-display) di laptop pengembang (Intel UHD 630 + NVIDIA GTX 1050, X11/i3, NVIDIA sebagai `PrimaryGPU`, driver 580).

- Default: gagal. Muncul `Failed to create GBM buffer of size 900x700: Invalid argument` dan tidak ada frame yang dirender. WebKitGTK mencoba membuat buffer GBM di NVIDIA, dan driver proprietary menolaknya.
- `WEBKIT_WEB_RENDER_DEVICE_FILE=/dev/dri/renderD128` (render di Intel iGPU): jalan, 60 FPS.
- `WEBKIT_DISABLE_DMABUF_RENDERER=1`: jalan, tapi hanya 22.7 FPS.
- Di profil daya `power-saver`, WebKit sengaja membatasi `requestAnimationFrame` ke sekitar 30 FPS. Ini perilaku hemat daya yang wajar dan diterima.

Kesimpulan: Tauri layak dipakai, dengan perbaikan GPU otomatis di Linux (lihat bagian 8).

## 3. Scope Fase 1

**Masuk:**
- App shell: sidebar, area konten, kolom AI (placeholder).
- Fondasi data: SQLite, migrasi, tabel `items`.
- Halaman Dashboard dengan 4 widget: Quick capture, Hari ini, Keuangan bulan ini (keadaan kosong), Item terbaru.
- Halaman Inbox dan halaman item (judul, isi Markdown, tanggal jatuh tempo, hapus).
- Halaman Pengaturan: backup dan lokasi data.
- Backup otomatis dan manual, log ke file, single instance.
- Perbaikan GPU Linux.
- Installer RPM.
- CI GitHub Actions di Linux untuk setiap PR.

**Tidak masuk (ditunda):**
- Modul keuangan, task, project, dan workspace (Fase 2 sampai 4).
- Tabel `links` dan `transactions` (dibuat saat modulnya dibangun).
- Editor blok, preview Markdown, `[[wikilink]]`, pencarian FTS5, command palette.
- Database kustom buatan user.
- AI Assistant (Fase 5) dan sync atau multi-device (Fase 6).
- UI restore backup, export Markdown, tampilan sampah (item terhapus).
- Router, library state (TanStack Query dan sejenisnya), shortcut global di luar app.

## 4. Arsitektur

```
Anchoa/
  src-tauri/
    migrations/001_init.sql
    src/
      main.rs        startup: perbaikan GPU Linux, plugin, daftar command
      db.rs          buka SQLite, pragma, migrasi, backup
      error.rs       AppError
      items.rs       command item: capture, get, open, update, delete, list
      dashboard.rs   query ringkasan untuk widget
  src/
    main.tsx
    api.ts           satu-satunya tempat yang memanggil invoke()
    shell/           sidebar, area konten, kolom AI
    dashboard/       4 widget
    inbox/
    item/
    settings/
```

**Alur data:** React → `api.ts` → command Rust → SQLite.

- Frontend tidak pernah mengakses DB secara langsung.
- Semua aksi adalah command Rust. AI Assistant di Fase 5 akan memanggil command yang sama, jadi tidak perlu API kedua.
- Setiap modul adalah satu file Rust di satu crate. Pecah jadi crate terpisah kalau sudah terasa besar.

**Navigasi:** state sederhana di React (`{ page, itemId? }`), plus tombol "Kembali" di halaman item yang kembali ke halaman sebelumnya. Router ditambah kalau butuh riwayat yang lebih kompleks.

**Plugin Tauri:** `tauri-plugin-single-instance`, `tauri-plugin-log`, `tauri-plugin-opener`.

**Crate Rust:** `rusqlite` (bundled), `uuid` (fitur v7), `jiff` (zona waktu lokal), `serde`, `thiserror`.

**Identifier app:** `io.github.syharipf.anchoa`. Folder data mengikuti `app_data_dir()` Tauri, yaitu `~/.local/share/io.github.syharipf.anchoa/`. Folder `~/.local/share/anchoa/` milik versi Anchoa lama tidak disentuh.

**Keamanan:** CSP ketat. Semua aset (font, ikon, script) dibundel lokal, tanpa CDN, supaya app jalan offline. Hanya command milik app yang diizinkan.

## 5. Model data

**Prinsip:** semua hal adalah item. Catatan, task, transaksi, dan project adalah baris di tabel `items`. Field khusus sebuah modul disimpan di tabel tambahan yang memakai `id` yang sama (`item_id`).

### Migrasi `001_init.sql`

```sql
CREATE TABLE items (
  id          TEXT PRIMARY KEY,          -- UUIDv7
  type        TEXT NOT NULL,             -- Fase 1: hanya 'note'
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',  -- Markdown
  parent_id   TEXT REFERENCES items(id), -- NULL = Inbox
  due_at      INTEGER,                   -- epoch ms UTC
  created_at  INTEGER NOT NULL,          -- epoch ms UTC
  updated_at  INTEGER NOT NULL,
  opened_at   INTEGER,
  deleted_at  INTEGER                    -- soft delete
);

CREATE INDEX items_due    ON items(due_at)    WHERE deleted_at IS NULL AND due_at IS NOT NULL;
CREATE INDEX items_parent ON items(parent_id) WHERE deleted_at IS NULL;
```

### Aturan

- **ID** memakai UUIDv7, yang bisa diurutkan menurut waktu. Bersama `updated_at` dan soft delete, ini fondasi supaya sync di Fase 6 tidak butuh migrasi besar.
- **Waktu** disimpan sebagai epoch ms UTC. Batas hari dihitung di Rust memakai zona waktu lokal sistem.
- **Jatuh tempo** di Fase 1 hanya berupa tanggal, disimpan sebagai pukul 00:00 waktu lokal pada tanggal tersebut. Jam jatuh tempo menyusul bersama modul task.
- **Semua query** mengabaikan baris yang `deleted_at IS NOT NULL`.
- **`updated_at`** hanya berubah saat judul, isi, atau jatuh tempo berubah. Membuka item hanya mengubah `opened_at`.

### Tabel yang direncanakan (bukan Fase 1)

```sql
links (from_id, to_id, PRIMARY KEY (from_id, to_id))   -- Fase 3: relasi bebas antar item

transactions (                                         -- Fase 2
  item_id     TEXT PRIMARY KEY REFERENCES items(id),
  account_id  TEXT NOT NULL REFERENCES items(id),
  amount      INTEGER NOT NULL,                         -- satuan terkecil mata uang, negatif = pengeluaran
  currency    TEXT NOT NULL DEFAULT 'IDR',
  category    TEXT,
  occurred_at INTEGER NOT NULL
)
```

Uang selalu disimpan sebagai integer, tidak pernah float.

## 6. Command (API backend)

Semua command mengembalikan `Result<T, AppError>`.

| Command | Masukan | Keluaran | Efek |
|---|---|---|---|
| `capture_note` | `text` | `Item` | Membuat item `note` dengan judul = teks yang sudah di-trim dan `parent_id` NULL. Teks kosong ditolak (`code: "empty"`). |
| `open_item` | `id` | `Item` | Mengisi `opened_at = now` lalu mengembalikan item. |
| `update_item` | `id`, `title?`, `body?`, `due_at?` (boleh `null` untuk menghapus) | `Item` | Mengubah field yang dikirim dan mengisi `updated_at = now`. |
| `delete_item` | `id` | `()` | Soft delete: `deleted_at = now`. |
| `list_inbox` | - | `ItemSummary[]` | Item dengan `parent_id IS NULL`, diurutkan `created_at` terbaru dulu. |
| `get_dashboard` | - | `Dashboard` | Lihat di bawah. |
| `backup_now` | - | `path` | Membuat backup manual. |
| `data_paths` | - | `{ data_dir, backup_dir, log_dir }` | Untuk halaman Pengaturan. Folder dibuka lewat plugin opener. |

```
Dashboard {
  today:   { due_today: ItemSummary[], overdue: ItemSummary[] },
  recent:  ItemSummary[],   // maksimal 8
  finance: null             // Fase 2 mengisi { balance, income, expense }
}
ItemSummary { id, type, title, due_at, last_activity_at }
```

- `due_today`: `start_of_today <= due_at < start_of_tomorrow` (waktu lokal).
- `overdue`: `due_at < start_of_today`.
- `due_today` dan `overdue` diurutkan menurut `due_at` naik, lalu `title`.
- `recent`: diurutkan menurut `last_activity_at = MAX(created_at, updated_at, COALESCE(opened_at, 0))`, terbaru dulu.

`AppError` diserialisasi ke frontend sebagai `{ code, message }`.

## 7. UI

### Shell

- **Jendela:** ukuran awal 1280×800, minimum 1100×680.
- **Tema:** mengikuti tema sistem (gelap atau terang).
- **Sidebar kiri:** Dashboard, Inbox, dan Pengaturan (di bawah). Hanya menu yang sudah berfungsi yang ditampilkan.
- **Kolom AI:** tetap di kanan, lebar 240px. Isinya placeholder "AI Assistant — segera".

### Dashboard

1. **Quick capture** (baris paling atas)
   - Input satu baris. Enter menyimpan lewat `capture_note`.
   - Kalau berhasil: input dikosongkan, muncul toast "Tersimpan ke Inbox", dan dashboard dimuat ulang.
   - Kalau gagal: teks tetap di input dan muncul toast error.
   - `Ctrl+N` dari halaman mana pun membuka Dashboard dan memfokuskan input. `Ctrl+N` dipilih karena `Ctrl+Space` sering bentrok dengan pengalih input method (IBus/fcitx) di Linux.
2. **Hari ini**
   - Tanggal lengkap, misalnya "Selasa, 29 September", dan sapaan sesuai jam lokal:
     - pagi 04:00–10:59
     - siang 11:00–14:59
     - sore 15:00–17:59
     - malam 18:00–03:59
   - Bagian "Terlambat" (kalau ada), lalu daftar jatuh tempo hari ini. Klik item untuk membukanya.
   - Kalau kosong: "Tidak ada jatuh tempo hari ini".
3. **Keuangan bulan ini**
   - Fase 1 selalu menampilkan "Modul keuangan belum aktif".
   - Di Fase 2 isinya: saldo total, pemasukan, dan pengeluaran bulan berjalan.
4. **Item terbaru**
   - 8 item dengan judul dan waktu relatif.
   - Klik item untuk membukanya.
   - Kalau kosong: "Belum ada item".

**Format waktu relatif:**
- kurang dari 1 menit: "baru saja"
- kurang dari 1 jam: "N menit lalu"
- kurang dari 24 jam: "N jam lalu"
- hari sebelumnya: "kemarin"
- kurang dari 7 hari: "N hari lalu"
- lebih dari itu: tanggal, misalnya "12 Sep"

Data dashboard dimuat saat halaman dibuka dan setelah setiap aksi. Tidak ada pembaruan realtime.

### Inbox

- Daftar hasil `list_inbox`: judul, jatuh tempo (kalau ada), dan waktu relatif.
- Klik item untuk membukanya.
- Kalau kosong: "Inbox kosong".

### Halaman item

- **Field:** judul (input), jatuh tempo (`<input type="date">` dengan tombol hapus tanggal), dan isi (textarea Markdown).
- **Autosave:** 500 ms setelah berhenti mengetik dan saat fokus pindah. Status tampil sebagai "Menyimpan…", "Tersimpan", atau "Gagal menyimpan".
- **Kalau simpan gagal:** isi editor tidak diubah, dan penyimpanan dicoba lagi pada perubahan berikutnya.
- **Tombol Hapus:** meminta konfirmasi, lalu soft delete dan kembali ke halaman sebelumnya.
- **Tombol Kembali:** kembali ke halaman sebelumnya.

### Pengaturan

- Menampilkan path folder data.
- Tombol "Backup sekarang", "Buka folder backup", dan "Buka folder data".
- Versi app.

## 8. Perbaikan GPU Linux

Dijalankan di baris pertama `main()`, sebelum thread atau webview apa pun dibuat:

1. Lewati kalau bukan Linux, atau kalau `WEBKIT_WEB_RENDER_DEVICE_FILE` sudah di-set.
2. Baca `/dev/dri/renderD*` dan cari driver masing-masing lewat `/sys/class/drm/<node>/device/driver`.
3. Kalau ada node dengan driver `nvidia` **dan** ada node dengan driver lain, set `WEBKIT_WEB_RENDER_DEVICE_FILE` ke node non-NVIDIA yang pertama.
4. Catat keputusan itu di log.

`std::env::set_var` bersifat `unsafe` di Rust edition 2024. Pemanggilan ini aman karena dilakukan sebelum ada thread lain. Mesin tanpa NVIDIA tidak terpengaruh.

## 9. Error handling

- Command tidak boleh panic di jalur yang dipicu user. `unwrap` hanya dipakai untuk invariant internal.
- Error dari command tampil sebagai toast.
- **DB gagal dibuka** (file rusak atau masalah izin): tampil layar error berisi path file dan tombol "Buka folder data". App tidak pernah membuat DB kosong baru untuk menggantikan file yang gagal dibuka.
- **Pragma saat koneksi dibuka:** `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- **Migrasi:** setiap migrasi berjalan di dalam transaksi. Kalau gagal, transaksi di-rollback dan layar error ditampilkan.
- **Single instance:** membuka app untuk kedua kalinya memfokuskan jendela yang sudah ada.
- **Log:** ditulis ke file di folder log app lewat `tauri-plugin-log`, ditambah stderr saat development.

## 10. Backup

- **Sebelum migrasi:** kalau DB sudah ada dan `user_version` lebih rendah dari versi terbaru, file disalin dulu ke `anchoa.db.bak-v{versi_lama}`.
- **Harian:**
  - Saat start, kalau belum ada `backups/anchoa-YYYY-MM-DD.db` untuk tanggal hari ini, jalankan `VACUUM INTO` ke file tersebut.
  - Hanya 7 file terbaru yang disimpan.
  - Pengecekan hanya terjadi saat start. Kalau app terbuka berhari-hari, backup berikutnya dibuat saat app dibuka lagi.
  - Kalau backup gagal: tulis ke log dan tampilkan toast, tapi jangan hentikan app.
- **Manual:** tombol "Backup sekarang" di Pengaturan membuat `backups/anchoa-YYYY-MM-DD-HHMMSS.db`. Backup manual ikut dalam rotasi 7 file.
- **Restore Fase 1:** manual. Tutup app, lalu salin file backup menjadi `anchoa.db`. Langkahnya ditulis di README.

## 11. Testing

- **Rust** (`cargo test`, SQLite in-memory):
  - migrasi dari DB kosong;
  - `capture_note` (termasuk menolak teks kosong);
  - `update_item` (termasuk menghapus `due_at`);
  - soft delete tidak muncul di query;
  - `open_item` tidak mengubah `updated_at`;
  - batas "hari ini" dan "terlambat" dengan zona waktu tetap (misalnya `Asia/Jakarta`);
  - urutan dan batas 8 item di `recent`;
  - rotasi backup menyisakan 7 file;
  - pemilihan render node di perbaikan GPU, diuji dengan daftar node palsu.
- **Frontend:**
  - `tsc --noEmit`;
  - Vitest untuk fungsi murni: sapaan per jam dan format waktu relatif.
- **End-to-end:** app dijalankan di Xvfb dan dikendalikan dengan xdotool, hasilnya dicek lewat screenshot dan isi DB di disk. Pengembang hanya menguji manual hal yang tidak bisa diotomatisasi, misalnya rendering di GPU asli.
- **CI:** GitHub Actions di Linux, berjalan di setiap PR: `cargo test`, `cargo clippy -- -D warnings`, `tsc --noEmit`, dan Vitest. CI hijau adalah syarat merge. Build Windows dan Android menyusul di Fase 6.

## 12. Kriteria selesai Fase 1

1. App terinstal dari RPM hasil `tauri build` di Fedora pengembang, dan jendela tampil normal di setup NVIDIA-primary.
2. Quick capture menyimpan item ke Inbox, dan item itu langsung muncul di "Item terbaru".
3. Item bisa dibuka, diedit (judul, isi, jatuh tempo), dan dihapus. Perubahan tersimpan otomatis.
4. Widget "Hari ini" menampilkan item yang jatuh tempo hari ini dan yang terlambat dengan benar.
5. Semua widget dan halaman punya keadaan kosong yang jelas.
6. Data tetap ada setelah app ditutup dan dibuka lagi. Backup harian terbentuk.
7. Semua test di bagian 11 lulus, termasuk di CI.

## 13. Roadmap

| Fase | Isi |
|---|---|
| 0 ✓ | Uji Live2D di Tauri |
| 1 | Fondasi + Dashboard (dokumen ini) |
| 2 | Keuangan: akun, transaksi, kategori, ringkasan bulanan. Widget keuangan aktif. |
| 3 | Task & Project: status, jatuh tempo, list/kanban, tabel `links`, link transaksi ke project. |
| 4 | Workspace/Catatan: pohon halaman, editor blok (BlockNote), `[[wikilink]]` + backlink, FTS5, command palette, export Markdown, UI restore. |
| 5 | AI Assistant: avatar Live2D di kolom kanan, chat, LLM memanggil command. |
| 6 | Multi-device: server sync, build Windows dan Android, CI multi-platform. |
| Nanti | Database kustom, plugin, avatar 3D. |

Fase 5 boleh dimajukan setelah Fase 3 kalau AI Assistant menjadi prioritas.

Setiap fase punya spec, rencana implementasi, dan siklus implementasinya sendiri.

## 14. Risiko dan catatan

- **WebKitGTK di Linux dengan NVIDIA** rawan bermasalah. Perbaikan di bagian 8 menangani setup pengembang. Setup Linux lain mungkin butuh penyesuaian. Windows (WebView2) dan Android (Android WebView) memakai Chromium, jadi tidak terkena masalah ini.
- **Batas 30 FPS di `power-saver`** adalah perilaku WebKit dan diterima.
- **Live2D Cubism Core** berlisensi proprietary. Syarat lisensinya harus dicek sebelum Fase 5.
- **Uji Fase 0 memuat aset dari CDN.** Aplikasi sebenarnya membundel semua aset secara lokal (lihat bagian 4).
