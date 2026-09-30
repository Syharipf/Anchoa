# Anchoa — Fase 3A: Proyek dan tugas

Tanggal: 2026-09-30
Status: disetujui lewat tanya-jawab 2026-09-30 (bagian 1). Bagian 2 dan detail lain diputuskan Claude saat user tidur (lihat bagian 2). Ini versi awal; tampilan dan detail boleh diubah setelah dipakai.

## 1. Ringkasan

Fase 3 dipecah dua. 3A (dokumen ini) membangun model tugas dan halaman Proyek dari `docs/design/artboards/Proyek.dc.html`. 3B membangun halaman Jadwal dari data yang sama.

Isi 3A:
- proyek: nama, jenis, deadline, deskripsi, URL repo GitHub;
- tugas dengan status Rencana, Dikerjakan, atau Selesai, dengan tanggal mulai, tenggat, dan tag, di dalam proyek atau sebagai tugas lepas;
- sub-tugas satu tingkat, dengan progres "3/5" di kartu;
- kanban 3 kolom dengan tombol → untuk memindah kartu ke kolom berikutnya;
- catatan lama yang punya tenggat menjadi tugas;
- kartu Proyek di dashboard, dan aksi palette "Buat tugas".

## 2. Keputusan

| Kode | Keputusan | Asal |
|---|---|---|
| P1 | Catatan yang punya tenggat dimigrasi menjadi tugas lepas: status `done` kalau sudah dicentang, `plan` kalau belum. Catatan tanpa tenggat tetap catatan. | Tanya-jawab |
| P2 | Sub-tugas adalah tugas dengan `items.parent_id` berisi tugas induk. Hanya satu tingkat, dan proyeknya selalu sama dengan induknya. | Tanya-jawab |
| P3 | Repo hanya berupa URL `https://github.com/<owner>/<repo>`. Header menampilkan chip "Repo" yang membuka browser lewat command, jadi frontend tidak pernah mengirim URL. | Tanya-jawab |
| P4 | Link transaksi ke proyek ditunda. | Tanya-jawab |
| P5 | Status tugas disimpan sebagai enum (`plan`, `doing`, `done`) dan selalu sinkron dengan `items.completed_at`. Pindah ke `done` mengisi `completed_at`, keluar dari `done` mengosongkannya. | Tanya-jawab (bagian 1) |
| P6 | Tugas tanpa proyek tampil di entri "Tugas lepas" di daftar proyek, dengan kanban yang sama. | Tanya-jawab (bagian 1) |
| P7 | Ctrl+N tetap membuat catatan. Halaman catatan kehilangan field tenggat dan mendapat tombol "Jadikan tugas". | Tanya-jawab (bagian 1) |
| P8 | `set`/`update` status tugas menggantikan command `complete_item`, karena yang dicentang di "Hari ini" sekarang selalu tugas. | Tanpa tanya-jawab |
| P9 | Menghapus proyek memindahkan tugasnya ke Tugas lepas, jadi tugas tidak ikut hilang. Menghapus tugas induk ikut menghapus sub-tugasnya. | Tanpa tanya-jawab |
| P10 | Progres proyek = tugas induk yang `done` ÷ semua tugas induk. Sub-tugas hanya menentukan "3/5" di kartu induknya. | Tanpa tanya-jawab |
| P11 | Status proyek dihitung di Rust: `done` (ada tugas dan semuanya selesai), `late` (deadline sebelum hari ini dan belum selesai), selain itu `active`. | Tanpa tanya-jawab |
| P12 | Menambah tugas dari kanban: "+ Tugas" di bawah judul kolom, ketik judul, Enter. Semua field lain diubah di halaman item. | Tanpa tanya-jawab |
| P13 | Tugas yang selesai tidak otomatis mengubah status induknya. | Tanpa tanya-jawab |
| P14 | Palette mendapat opsi "Buat tugas: “…”" di bawah "Simpan ke Inbox". Tugas itu masuk Tugas lepas dengan status Rencana. | Tanpa tanya-jawab |

**Tidak masuk 3A:** halaman Jadwal (3B), link transaksi ke proyek, status repo dari GitHub API, drag-and-drop kanban, sub-tugas lebih dari satu tingkat, dan "Tambah lewat suara" (nonaktif sampai Fase 5).

## 3. Model data

### Migrasi `005_projects.sql`

```sql
CREATE TABLE projects (
  item_id     TEXT PRIMARY KEY REFERENCES items(id),  -- type='project', title=nama, body=deskripsi
  kind        TEXT NOT NULL,     -- app | document | research | personal
  deadline_at INTEGER,           -- 00:00 lokal, opsional
  repo_url    TEXT               -- opsional, sudah divalidasi
);

CREATE TABLE tasks (
  item_id    TEXT PRIMARY KEY REFERENCES items(id),   -- type='task'
  status     TEXT NOT NULL,      -- plan | doing | done
  project_id TEXT REFERENCES items(id),               -- NULL = tugas lepas
  start_at   INTEGER,            -- rencana mulai, 00:00 lokal
  tag        TEXT                -- teks bebas
);

CREATE INDEX tasks_project ON tasks(project_id);

-- Notes with a due date become loose tasks (P1).
INSERT INTO tasks (item_id, status)
  SELECT id, CASE WHEN completed_at IS NULL THEN 'plan' ELSE 'done' END
  FROM items WHERE type = 'note' AND due_at IS NOT NULL;
UPDATE items SET type = 'task' WHERE type = 'note' AND due_at IS NOT NULL;
```

`user_version` naik ke 5. Upgrade membuat `anchoa.db.bak-v4`.

### Pemetaan ke `items`

| | `type` | `title` | `body` | `due_at` | `completed_at` | `parent_id` |
|---|---|---|---|---|---|---|
| Proyek | `project` | nama | deskripsi | - | - | - |
| Tugas | `task` | judul | catatan | tenggat | saat selesai | tugas induk (sub-tugas) |

### Aturan

- **Hari ini dan 7 hari ke depan** membaca `type = 'task'`, termasuk sub-tugas. Aturan tanggalnya sama seperti sebelumnya.
- **Inbox dan Catatan terbaru** tetap `type = 'note'`, jadi tugas tidak muncul di sana.
- **Kanban** hanya menampilkan tugas induk (`parent_id IS NULL`). Tiap kolom diurutkan menurut tenggat (tanpa tenggat di akhir), lalu waktu dibuat.
- **Kartu tugas** menampilkan jumlah sub-tugas yang selesai dan totalnya.
- **Tugas terlambat** = tenggat sebelum awal hari ini dan status bukan `done`.
- **Tenggat terdekat** = 5 tugas yang belum selesai dan punya tenggat, dari semua proyek dan Tugas lepas, termasuk yang terlambat. Diurutkan menurut tenggat.
- **Daftar proyek:**
  - proyek `active` dan `late` lebih dulu, diurutkan menurut deadline (tanpa deadline di akhir), lalu nama;
  - proyek `done` di bawahnya;
  - "n aktif" menghitung proyek yang belum `done`.
- **`deadline_days`** = selisih hari lokal dari hari ini ke deadline. Negatif berarti terlambat. Dihitung di Rust.

## 4. Command

Semua mengembalikan `Result<T, AppError>`. JSON memakai camelCase. Nilai yang punya cabang logika memakai enum Rust (`ProjectKind`, `ProjectStatus`, `TaskStatus`).

| Command | Masukan | Keluaran |
|---|---|---|
| `projects_overview` | - | `{ projects: ProjectSummary[], activeCount, loose: { done, total }, upcoming: TaskCard[] }` |
| `project_board` | `{ id: string \| null }` (`null` = Tugas lepas) | `{ project: ProjectDetail \| null, columns: { plan: TaskCard[], doing: TaskCard[], done: TaskCard[] } }` |
| `save_project` | `{ id?, name, kind, deadlineAt?, repoUrl?, description }` | `ProjectDetail` |
| `delete_project` | `id` | `()` |
| `open_repo` | `id` (proyek) | `()` |
| `create_task` | `{ title, projectId?, parentId?, status }` | `TaskCard` |
| `get_task` | `id` | `TaskDetail` |
| `update_task` | `id`, `TaskPatch` | `TaskDetail` |
| `delete_task` | `id` | `()` |
| `convert_to_task` | `id` (catatan) | `TaskDetail` |

```
ProjectSummary { id, name, kind, deadlineAt, deadlineDays, status, done, total }
ProjectDetail  { id, name, kind, description, deadlineAt, deadlineDays, repoUrl, status, done, total }
TaskCard       { id, title, status, tag, dueAt, overdue, subDone, subTotal, projectId, projectName }
TaskDetail     { card fields + startAt, parentId, parentTitle, subtasks: TaskCard[] }
TaskPatch      { status?, projectId?: string | null, startAt?: number | null, tag?: string | null }
```

- **`TaskPatch`:** field yang tidak dikirim tidak berubah, dan `null` mengosongkan field (seperti `ItemPatch`). Judul, isi, dan tenggat tetap lewat `update_item`.
- **`update_task`** yang mengubah proyek sebuah tugas induk ikut memindahkan sub-tugasnya ke proyek itu.
- **`get_dashboard`:**
  - `today` dan `upcoming` membaca tugas;
  - field baru `projects: ProjectSummary[]` berisi 2 proyek pertama dari urutan daftar proyek yang belum `done`.
- **Command `complete_item` dihapus** (P8).

### Validasi

Semua kegagalan validasi mengembalikan `AppError::Invalid` dengan pesan dalam Bahasa Indonesia.
- Nama proyek dan judul tugas di-trim dan tidak boleh kosong.
- URL repo harus cocok dengan `^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?$`.
- `projectId` harus proyek yang hidup.
- `parentId` harus tugas induk yang hidup, bukan sub-tugas. Sub-tugas selalu memakai proyek induknya.
- `convert_to_task` hanya menerima catatan.
- `open_repo` membuka URL yang tersimpan di DB lewat `tauri-plugin-opener`. Proyek tanpa repo mengembalikan `Invalid`.

## 5. UI

### Halaman Proyek

Menggantikan halaman "menyusul"; field `about` dan `fase` Proyek dihapus dari `nav.ts`. Mengikuti `Proyek.dc.html`.

- **Header:** "Proyek", "n aktif", "Tambah lewat suara" (nonaktif, tooltip "Hadir di Fase 5"), dan "+ Proyek".
- **Kolom kiri (sekitar 300px):**
  - **Daftar proyek:** tiap kartu berisi nama, titik dan label status (Aktif lime, Terlambat coral, Selesai muted), "Aplikasi · 31 Okt", bar progres, dan persen. Klik kartu untuk memilih. Entri terakhir adalah "Tugas lepas" (n tugas).
  - **Tenggat terdekat:** titik warna, judul, nama proyek (atau "Tugas lepas"), dan tanggal (coral kalau terlambat). Klik baris membuka halaman item tugas itu.
- **Kolom kanan:**
  - **Header proyek:** nama, deskripsi, persen besar, dan "n dari m tugas".
  - **Chip:** deadline ("31 Okt", "hari ini", atau "terlambat 3 hari"), jenis, dan "Repo" (kalau ada). Tombol "Ubah" membuka formulir proyek. Header "Tugas lepas" hanya berisi judul dan jumlah.
  - **Kanban 3 kolom:** Rencana, Dikerjakan, Selesai, masing-masing dengan jumlah kartu.
    - Kartu berisi judul, chip tag, "✓ 3/5" kalau ada sub-tugas, tenggat (coral kalau terlambat), dan tombol →.
    - Tombol → memindah kartu ke kolom berikutnya. Di kolom Selesai, tombolnya ↺, yang mengembalikan kartu ke Rencana.
    - Klik kartu (di luar tombol) membuka halaman item.
    - Kartu di kolom Selesai tampil ringkas, dengan judul dicoret.
  - **"+ Tugas"** di tiap kolom membuka input satu baris. Enter membuat tugas di kolom itu, dan Esc membatalkan.
- **Kosong:**
  - tanpa proyek: "Belum ada proyek" dengan tombol "Buat proyek", sedangkan Tugas lepas tetap bisa dipilih;
  - kolom kanban kosong: "Kosong".
- **Pilihan awal:** proyek pertama di daftar, atau Tugas lepas kalau belum ada proyek.

### Formulir proyek

Memakai `Dialog` dari Fase 2: nama, jenis (Aplikasi, Dokumen, Riset, Pribadi), deadline (opsional), URL repo (opsional), dan deskripsi. Tombol Hapus disertai teks "Tugasnya pindah ke Tugas lepas".

### Halaman item

- **Catatan:** field tenggat dihapus, dan tombol "Jadikan tugas" ditambahkan di baris atas. Setelah diubah, halaman memuat ulang sebagai tugas.
- **Tugas:**
  - baris field: status (Segmented Rencana/Dikerjakan/Selesai), proyek (select: "Tugas lepas" dan semua proyek; nonaktif untuk sub-tugas), mulai, tenggat, dan tag. Semua tersimpan otomatis;
  - sub-tugas menampilkan tautan "↑ <judul induk>";
  - bagian "Sub-tugas" (hanya untuk tugas induk): daftar berisi checkbox (Selesai ↔ Rencana) dan judul yang bisa diklik untuk membuka sub-tugas, ditambah input "Tambah sub-tugas" (Enter).

### Dashboard

Kartu Proyek di bento menjadi aktif: dua proyek, masing-masing dengan nama, bar progres, dan persen. Kalau belum ada proyek, kartu menampilkan "Belum ada proyek". Klik kartu membuka halaman Proyek.

### Palette

Kalau query tidak kosong, grup terakhir berisi dua opsi: "Simpan ke Inbox: “…”" dan "Buat tugas: “…”". Setelah tugas dibuat, muncul toast "Tugas dibuat" dengan aksi "Buka", yang membuka halaman item tugas itu.

## 6. Error handling

- **Mengikuti aturan Fase 1 dan 2:** command tidak boleh panic, dan error tampil sebagai toast.
- **Atomik:** migrasi, `delete_project` (proyek dan tugasnya), `delete_task` (induk dan anak), serta `update_task` yang memindah proyek berjalan dalam satu transaksi SQLite.
- **Tombol →** menunggu jawaban backend dulu, lalu memuat ulang kanban. Kalau gagal, muncul toast dan kartu tidak berpindah.

## 7. Testing

- **Rust** (SQLite in-memory):
  - migrasi 005 di atas DB versi 4: catatan bertenggat menjadi tugas dengan status yang benar, dan catatan lain tetap catatan;
  - status ↔ `completed_at` selalu sinkron;
  - kanban hanya berisi tugas induk dengan urutan yang benar, `subDone`/`subTotal`, dan `overdue`;
  - progres dan status proyek (`active`, `late`, `done`), `deadline_days`, dan urutan daftar;
  - Tenggat terdekat (5, termasuk yang terlambat, tanpa yang `done`);
  - `delete_project` memindahkan tugas ke Tugas lepas;
  - `delete_task` ikut menghapus sub-tugas;
  - memindah proyek induk ikut memindah sub-tugasnya;
  - validasi: judul kosong, URL repo bukan GitHub, sub-tugas dari sub-tugas, proyek yang sudah dihapus;
  - `convert_to_task` hanya untuk catatan;
  - Hari ini dan 7 hari ke depan membaca tugas, sedangkan Inbox tidak berisi tugas;
  - dashboard `projects`.
- **Frontend** (`bun test`): label deadline, label dan warna status proyek, kolom berikutnya untuk tombol →, dan opsi palette "Buat tugas".
- **E2E:**
  - DB lama dengan catatan bertenggat naik ke versi 5 dan menjadi tugas;
  - buat proyek, tambah dua tugas lewat "+ Tugas", pindahkan satu dengan →, lalu cek DB;
  - buka tugas, tambah sub-tugas, lalu kartu menampilkan "0/1";
  - "Jadikan tugas" pada catatan;
  - palette "Buat tugas";
  - kartu Proyek di dashboard.

## 8. Kriteria selesai

1. Proyek bisa dibuat, diubah, dan dihapus tanpa kehilangan tugas.
2. Tugas bisa dibuat, dipindah antar-kolom, diubah, dan dihapus, dan status selalu sinkron dengan `completed_at`.
3. Sub-tugas dan progres "n/m" bekerja.
4. Catatan bertenggat lama menjadi tugas saat upgrade, dengan `.bak-v4`.
5. Dashboard (Hari ini, 7 hari, kartu Proyek) dan panel notifikasi bekerja dengan tugas.
6. Semua test lulus, CI dan SonarCloud hijau.

## 9. Rencana PR

Rinciannya ada di `docs/superpowers/plans/2026-09-30-anchoa-fase3a-proyek.md`.

| PR | Isi |
|---|---|
| 3A-1 | Migrasi 005, backend proyek dan tugas, dashboard membaca tugas, `complete_item` diganti, E2E disesuaikan |
| 3A-2 | Halaman Proyek (daftar, header, kanban, "+ Tugas", formulir proyek), kartu Proyek di dashboard, palette "Buat tugas" |
| 3A-3 | Halaman item untuk tugas (field, sub-tugas), "Jadikan tugas", E2E proyek, versi 0.3.0 |
