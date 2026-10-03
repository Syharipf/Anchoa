# Anchoa — Proyek v2

Tanggal: 2026-10-03
Status: user memilih keempat paket (Dasar, Struktur, Terhubung, Waktu) dan menyetujui ringkasan desain di chat pada 2026-10-03. Keputusan detail di §2 diambil Claude dan bisa diubah. Spec dasar: `2026-09-30-anchoa-fase3a-proyek-design.md` (P1–P14 tetap berlaku kecuali disebut di sini). Desain visual tetap `docs/design/artboards/Proyek.dc.html`; fitur baru mengikuti token dan pola komponen yang sudah ada.

## 1. Ringkasan

Menu kedua dalam seri "poles per menu", setelah Jurnal v2. Empat PR, masing-masing dikerjakan di sesi Claude Code terpisah, setelah J-4:

| PR | Isi |
|---|---|
| P-1 Dasar (#145) | Drag-and-drop kartu, prioritas, cari dan filter kanban, hapus tugas + Urungkan, menu klik kanan, tool asisten `update_task` |
| P-2 Struktur (#146) | Tampilan Daftar, tugas berulang, arsip proyek, banyak tag |
| P-3 Terhubung (#147) | Transaksi dan anggaran per proyek, status repo GitHub, tautan `[[...]]` dari catatan tugas |
| P-4 Waktu (#148) | Timer per tugas, pengingat tenggat harian, laporan mingguan proyek oleh asisten lokal |

Rilis setelah P-4: "Anchoa v0.20.0 — Proyek lebih lengkap" (nomor menyesuaikan rilis terakhir di `main`; judul tanpa kata "Fase").

## 2. Keputusan

| Kode | Keputusan | Alasan |
|---|---|---|
| R1 | Drag-and-drop memakai HTML5 drag-and-drop bawaan (`draggable`, `onDragStart`, `onDragOver`, `onDrop`), tanpa library. Melepas kartu di kolom lain memanggil `update_task { status }` yang sama dengan tombol →, lalu memuat ulang board. Urutan dalam kolom tetap otomatis (R3); tidak ada urutan manual. Tombol → dan ↺ tetap ada untuk keyboard dan pembaca layar. Gagal → toast, kartu kembali ke kolom asal. Berlaku untuk proyek biasa dan proyek agen. | Tanpa dependency; satu jalur ubah status. |
| R2 | `tasks.priority INTEGER` (NULL = tanpa prioritas, 1 = Tinggi, 2 = Sedang, 3 = Rendah), migrasi baru. `TaskCard.priority`, `TaskPatch.priority` (`null` mengosongkan). Nilai di luar 1–3 → `AppError::Invalid`. Kolom ikut daftar kolom record sync. Chip di kartu: Tinggi coral, Sedang kuning (`--warning`), Rendah abu-abu; tanpa prioritas tanpa chip. Halaman item tugas mendapat select Prioritas. | Integer agar mudah diurutkan. |
| R3 | Urutan kolom kanban: prioritas (Tinggi dulu, tanpa prioritas terakhir), lalu tenggat (tanpa tenggat terakhir), lalu `created_at`, `id`. | Yang penting di atas. |
| R4 | `project_board` mendapat argumen `filter: BoardFilter { query?, tag?, priority?, due? }`, dengan `due` = `overdue` \| `week` (tenggat dalam 7 hari lokal ke depan, termasuk hari ini) \| `none` (tanpa tenggat). `query` mencocokkan judul dan catatan tugas (`LIKE`, karakter `%`/`_` di-escape), tidak peka huruf besar (ASCII saja, sifat `LIKE` SQLite). `overdue` hanya tugas yang belum selesai (definisi P-3A); `week` dan `none` mencakup semua status. Pilihan tag diambil dari `Board.tags` (semua tag tugas induk board itu tanpa filter). Semua dihitung di Rust; frontend tidak menyaring. Bar filter di atas kanban: kotak cari, select tag (dari tag yang ada di board), select prioritas, select tenggat, dan tombol "Reset" saat ada filter aktif. Berganti proyek mengosongkan filter. | Satu jalur query, sama seperti Jurnal V4. |
| R5 | Hapus tugas: tombol "Hapus" di halaman item tugas (konfirmasi yang ada tetap dipakai) dan item "Hapus" di menu kartu (tombol ⋯ atau klik kanan, R19; tanpa konfirmasi, karena ada Urungkan). Setelah `delete_task`, toast "Tugas dihapus" dengan Urungkan selama 6 detik memanggil `restore_task(id)`. `restore_task` memulihkan induk dan sub-tugas yang `deleted_at`-nya sama persis dengan induk (yang dihapus bersamanya), dan mengisi `updated_at`. `delete_task` juga mulai mengisi `updated_at` untuk sub-tugas. Tugas yang tidak terhapus → tanpa efek. Tidak ada halaman Sampah. | Soft delete; sama dengan Jurnal V1. |
| R6 | Tool asisten `update_task` (butuh persetujuan): `{ id, status?, priority?, dueAt?, tag? }`. Asisten tidak mendapat tool hapus tugas. `list_tasks` ikut mengembalikan prioritas. | Tindakan merusak tetap di tangan user. |
| R7 | Toggle "Kanban \| Daftar" di header board. Daftar = tabel tugas induk dikelompokkan per status (urutan kolom kanban), kolom: judul, prioritas, tag, tenggat, sub-tugas. Klik header kolom mengurutkan (judul, prioritas, tenggat) naik/turun; pengurutan dilakukan di frontend atas data board yang sudah tersaring (presentasi saja). Filter R4 berlaku sama. Pilihan tampilan disimpan di `localStorage` per perangkat (dibungkus `try/catch`). Tab Agen kode tetap ada untuk proyek agen. | Daftar untuk banyak tugas; kanban tetap bawaan. |
| R8 | Tugas berulang: `tasks.recur TEXT` (`daily` \| `weekly` \| `monthly`, NULL = tidak berulang), migrasi baru, ikut record sync. Hanya tugas induk yang punya tenggat boleh berulang (`AppError::Invalid` kalau tanpa tenggat atau sub-tugas). Saat tugas berulang pindah ke `done` (dari mana pun: kanban, item, asisten, CLI agen), dalam transaksi yang sama Rust membuat tugas baru: judul, catatan, proyek, tag, prioritas, `recur` sama; status `plan`; tenggat maju 1 hari / 7 hari / 1 bulan dari tenggat lama (tanggal 29–31 → hari terakhir bulan tujuan kalau tidak ada); `start_at` ikut bergeser dengan selisih yang sama. Sub-tugas tidak disalin. Membuka lagi tugas yang sudah selesai tidak menghapus tugas baru. Kartu berulang menampilkan ikon ↻ dengan tooltip "Berulang harian/mingguan/bulanan". Halaman item: select Ulangi (Tidak, Harian, Mingguan, Bulanan). | Pola tugas berulang yang paling sederhana dan bisa diprediksi. |
| R9 | Arsip proyek: `projects.archived_at INTEGER` (NULL = aktif), migrasi baru, ikut record sync. `archive_project(id)` / `unarchive_project(id)`. Proyek arsip tidak tampil di daftar proyek, tidak dihitung di "n aktif", tidak tampil di dashboard dan Tenggat terdekat di halaman Proyek. Di bawah daftar proyek ada lipatan "Arsip (n)" yang menampilkannya; membuka proyek arsip menampilkan banner "Proyek diarsipkan" dengan tombol "Pulihkan". Tugas proyek arsip tetap tampil di Hari ini, 7 hari ke depan, dan Jadwal. Tombol "Arsipkan" ada di formulir proyek. | Arsip menyembunyikan, tidak menghapus. |
| R10 | Banyak tag: `tasks.tag` menyimpan beberapa tag dipisah spasi (seperti `journal_entries.tags`). Input di halaman item: teks "tag dipisah spasi"; disimpan ter-trim, huruf kecil, tanpa duplikat. Kartu menampilkan maksimal 2 chip tag + "+n". Filter tag R4 mencocokkan satu tag utuh. Data lama (satu tag) tetap valid tanpa migrasi; tag lama yang berisi spasi akan terbaca sebagai beberapa tag (diterima). | Satu pola tag untuk seluruh app. |
| R11 | Uang per proyek: `transactions.project_id TEXT REFERENCES items(id)` dan `projects.budget INTEGER` (minor units, NULL = tanpa anggaran), migrasi baru, keduanya ikut record sync (`project_id` sebagai referensi). Formulir transaksi mendapat select Proyek (opsional, hanya proyek tidak terarsip). Header proyek menampilkan chip "Terpakai Rp X" atau "Terpakai Rp X dari Rp Y" (coral kalau X > Y), dengan X = jumlah pengeluaran (bukan transfer, bukan pemasukan) yang hidup di proyek itu. Formulir proyek mendapat field Anggaran. Menghapus proyek mengosongkan `project_id` transaksinya. "Terpakai" menghitung semua pengeluaran hidup, termasuk bertanggal masa depan; chip disembunyikan kalau tanpa anggaran dan X = 0. Tool asisten `add_transaction` mendapat `projectId` opsional. | Integer minor units; data uang tetap di Keuangan. |
| R12 | Status repo GitHub: `repo_status(projectId, force)` memanggil REST API GitHub untuk repo di `repo_url`: commit terakhir di branch bawaan (pesan baris pertama, waktu), jumlah issue terbuka (tanpa PR), jumlah PR terbuka. Memakai token GitHub yang sudah tersimpan (`github::load_token`) kalau ada; tanpa token tetap jalan untuk repo publik. Hasil di-cache di tabel lokal `repo_status (project_id, fetched_at, json)` yang tidak ikut sync; di-refresh saat proyek dibuka kalau umurnya lebih dari 15 menit, atau lewat tombol refresh. Chip header: "Repo · commit 2 jam lalu · 3 issue · 1 PR" seperti artboard; klik tetap membuka repo (`open_repo`). Gagal jaringan / 404 / rate limit → chip "Repo" biasa dengan tooltip penyebab, tanpa toast berulang. Timeout HTTP 10 detik. Hasil gagal juga di-cache 15 menit. Jumlah PR dibatasi satu halaman (100). Pemanggilan jaringan di thread terpisah, tidak memegang kunci DB selama request. | Desain artboard; tidak mengganggu kalau offline. |
| R13 | Tautan `[[Judul]]` di catatan tugas memakai `links::parse`/`links::refresh` (dipanggil saat `body` tugas disimpan, seperti Catatan). Halaman item tugas menampilkan "Tautan" (keluar) dan "Disebut di" (backlink) yang bisa diklik; judul tidak ditemukan tampil redup. Mengetik `[[` membuka autocomplete dari helper yang sudah ada di Catatan. | Satu parser untuk seluruh app (sama dengan Jurnal V14). |
| R14 | Timer per tugas: tabel `task_time (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES items(id), started_at INTEGER NOT NULL, ended_at INTEGER, created_at, updated_at, deleted_at)` dengan id UUIDv7, migrasi baru, ikut sync sebagai record sendiri. Hanya satu timer aktif di seluruh app: `timer_start(taskId)` menghentikan timer lain dulu dalam transaksi yang sama. `timer_stop()`; timer aktif `{ taskId, title, startedAt } \| null` ikut field `timer` di `get_dashboard` (tanpa command terpisah). Durasi < 1 menit dibuang (soft delete). Kartu dan halaman item: tombol ▶/■; timer aktif tampil di header shell sebagai pil "■ <judul> 12:34" yang bisa diklik untuk berhenti. `TaskCard.spentMs` (total entri yang sudah berhenti) dan header proyek "n j m menit minggu ini" (minggu = Senin 00:00 lokal, dihitung di Rust). Menyelesaikan tugas yang timernya aktif menghentikan timer itu. | Stopwatch sederhana; data ikut sync. |
| R15 | Pengingat tenggat: `NotifyPrefs` mendapat `taskAt: "HH:MM"` (bawaan `08:00`, validasi format). Kalau `task` aktif, sekali per hari lokal setelah jam itu muncul notifikasi sistem "n tugas jatuh tempo hari ini, m terlambat", hanya kalau n + m > 0. Notifikasi sistem memakai `tauri-plugin-notification` (plugin resmi Tauri; dipakai ulang kalau J-2 sudah menambahkannya). Di Linux plugin tidak punya callback klik, jadi klik tidak membuka halaman. Diatur di Profil › Notifikasi. Penjadwal memakai mekanisme J-2 `journalAt` kalau ada, kalau tidak thread 60 detik. Panel notifikasi di app tidak berubah. | Satu notifikasi per hari, tidak berisik. |
| R16 | Laporan mingguan: tombol "Laporan minggu ini" di header proyek (bukan otomatis). Asisten lokal dengan peran `recap` membaca 7 hari terakhir proyek itu: aktivitas status tugas, tugas selesai, tugas terlambat, waktu tercatat (R14), dan judul tugas (catatan tugas dipotong 500 karakter per tugas). Hasil tampil di dialog dengan tombol "Simpan ke Catatan", yang membuat halaman Catatan "Laporan <proyek> <tgl awal>–<tgl akhir>". Ollama tidak jalan → error jelas, tidak ada yang dibuat. Tool asisten `project_report(projectId)` mengembalikan fakta yang sama (baca saja, tanpa persetujuan); model chat yang merangkum. | User yang memutuskan kapan data dibaca; data tetap di perangkat. |
| R17 | Tool asisten `start_timer(taskId)` dan `stop_timer()` (butuh persetujuan). | AI bisa mengendalikan fitur baru. |
| R18 | Setiap PR ditutup dengan E2E Xvfb untuk fiturnya (`check_projects_*` di `scripts/e2e-smoke.sh`) dan cek DB di disk. Drag-and-drop di E2E boleh diganti dengan tombol → kalau xdotool tidak bisa memicu drag HTML5; logika drop dites di unit test frontend. | Aturan proyek. |
| R19 | Klik kanan (user, 2026-10-03): komponen bersama `ContextMenu` di `src/shell/ContextMenu.tsx`, dibuka di posisi kursor lewat `onContextMenu` (event dari tombol Menu / Shift+F10 yang tidak punya koordinat memakai posisi elemen). Tertutup lewat Esc, klik di luar, atau memilih item; panah atas/bawah memindah fokus; fokus kembali ke pemicu saat tertutup. Gaya sama dengan menu ⋯ Catatan (`PageTree.tsx`). Kartu proyek di daftar kiri: Ubah, Hapus (dialog konfirmasi "Tugasnya pindah ke Tugas lepas"); P-2 menambah Arsipkan/Pulihkan. Kartu tugas (kanban, dan Daftar di P-2): Buka, Pindah ke <kolom lain>, Prioritas Tinggi/Sedang/Rendah/Tanpa (yang aktif bertanda ✓), Hapus (+ Urungkan). Menu yang sama terbuka dari tombol ⋯ di kartu (tampil saat hover atau fokus), jadi tidak ada fitur yang hanya bisa lewat klik kanan. Tombol "Ubah" di header proyek menjadi tombol sekunder berikon pensil di kanan, sejajar persen. Halaman lain memakai `ContextMenu` yang sama lewat plan poles UI berikutnya. | Akses cepat; tombol yang jelas. |

## 3. Data dan command

Migrasi baru memakai nomor berikutnya di `main` saat PR dibuat (setelah migrasi Jurnal v2). Satu migrasi per PR:

```sql
-- P-1
ALTER TABLE tasks ADD COLUMN priority INTEGER;
-- P-2
ALTER TABLE tasks ADD COLUMN recur TEXT;
ALTER TABLE projects ADD COLUMN archived_at INTEGER;
-- P-3
ALTER TABLE transactions ADD COLUMN project_id TEXT REFERENCES items(id);
ALTER TABLE projects ADD COLUMN budget INTEGER;
CREATE TABLE repo_status (project_id TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL, json TEXT NOT NULL);
-- P-4
CREATE TABLE task_time (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES items(id),
  started_at INTEGER NOT NULL, ended_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE INDEX task_time_task ON task_time(task_id);
```

Setiap kolom baru di `tasks`, `projects`, `transactions` masuk daftar kolom `EXTENSIONS` di `src-tauri/src/sync/record.rs`. Migrasi yang sama juga `DROP` lalu membuat ulang trigger update sync tabel itu (`sync_tasks_update`, `sync_projects_update`, `sync_transactions_update` dari `012_sync.sql`, atau versi terbarunya) dengan kolom baru di daftar `AFTER UPDATE OF` (kalau ada) dan di kondisi `WHEN`. Tanpa itu perubahan kolom baru tidak masuk `sync_outbox`, karena `sync_items_update` mengabaikan `updated_at`. Setiap PR menambah test Rust bahwa mengubah kolom baru menulis baris `sync_outbox`. `task_time` mendapat jenis record sync sendiri mengikuti pola tabel non-item yang ada (kalau tidak ada pola itu, plan P-4 memutuskan cara paling kecil yang tetap membawa data ke sync). `repo_status` adalah cache lokal dan tidak ikut sync.

Command baru atau berubah (semua `Result<T, AppError>`, lewat `src/api.ts`):

| Command | PR | Catatan |
|---|---|---|
| `update_task` patch `priority` | P-1 | 1–3 atau `null`. |
| `project_board(id, filter)` | P-1 | `BoardFilter`; urutan R3; `Board.tags`. |
| `restore_task(id)` | P-1 | R5. |
| `update_task` patch `recur` | P-2 | R8. |
| `archive_project(id)`, `unarchive_project(id)` | P-2 | `projects_overview` + `archived: ProjectSummary[]`. |
| `save_project` + `budget` | P-3 | `ProjectDetail.budget`, `ProjectDetail.spent`. |
| transaksi + `projectId` | P-3 | Command simpan transaksi yang ada. |
| `repo_status(projectId, force)` | P-3 | R12. |
| `timer_start(taskId)`, `timer_stop()`, `get_dashboard` + `timer` | P-4 | R14. |
| `get/set_notify_prefs` + `taskAt` | P-4 | R15. |
| `project_report(projectId)` | P-4 | Mengembalikan teks laporan (LLM lokal). |
| `save_report_note(projectId, text)` | P-4 | Mengembalikan id halaman Catatan baru. |

## 4. Asisten dan agen

- Tool baru: `update_task` (P-1), `start_timer`, `stop_timer`, `project_report` (P-4). `add_transaction` mendapat `projectId` (P-3). Semua yang mengubah data butuh persetujuan.
- Asisten tidak mendapat tool hapus tugas atau arsip proyek.
- CLI `anchoa agent` tidak berubah; agen kode tetap memindah kartu lewat `task status`. Tugas berulang (R8) juga berlaku saat agen memindah kartu ke `done`.

## 5. Di luar cakupan

Urutan manual kartu dalam kolom, sub-tugas lebih dari satu tingkat, template proyek, Gantt / timeline per proyek, kolaborasi, pomodoro, laporan otomatis terjadwal, webhook GitHub, halaman Sampah lintas modul.
