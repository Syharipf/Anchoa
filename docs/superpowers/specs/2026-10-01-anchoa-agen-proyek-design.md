# Anchoa — Proyek × Agen AI

Tanggal: 2026-10-01
Status: diminta user pada 2026-10-01 pukul 15:30 dan 16:18 ("bisa implement yang project itu dulu?"). User sedang tidak di tempat dan meminta tanpa tanya-jawab, jadi semua keputusan di §2 diambil Claude dan bisa diubah nanti.

## 1. Ringkasan

Halaman Proyek menjadi tempat memantau dan menyuruh agen AI:
- **Kanban 5 kolom** untuk proyek agen: Rencana, Dikerjakan, Tes, Review, Selesai.
- **Utas aktivitas per tugas**, gaya Slack. Isinya:
  - permintaan user;
  - hasil planning agen (spec, rencana);
  - siapa yang mengerjakan;
  - hasil tes;
  - temuan review;
  - perubahan status;
  - tautan PR.
- **Kotak "Minta agen"** di proyek. Permintaan user menjadi tugas baru di kolom Rencana, lalu Anchoa menjalankan perintah agen yang dikonfigurasi (opsional).
- **Agen melapor lewat CLI** `anchoa agent …` ke database yang sama, sehingga semua riwayat tersimpan di proyek.

## 2. Keputusan

| Kode | Keputusan | Alasan |
|---|---|---|
| A1 | Agen (Claude Code, Codex, Gemini lewat agy) berjalan di luar Anchoa dan melapor lewat **CLI di binary yang sama**: `anchoa agent <subperintah>`. `main.rs` memeriksa argumen sebelum Tauri dijalankan. CLI memanggil fungsi Rust yang sama dengan command UI. | Semua agen bisa menjalankan shell; tidak perlu server atau port. Sesuai aturan CLAUDE.md: AI memanggil fungsi yang sama. |
| A2 | CLI membuka DB yang sama dengan app (path data XDG yang sama), WAL, dan `busy_timeout` 5 detik. Tidak pernah membuat DB baru kalau DB tidak ada: CLI berhenti dengan pesan "Buka Anchoa sekali dulu". | Dua proses aman di SQLite WAL. Aturan "jangan buat DB baru". |
| A3 | Status tugas bertambah `test` (Tes) dan `review` (Review), sehingga menjadi `plan | doing | test | review | done`. Proyek biasa tetap menampilkan 3 kolom. Proyek dengan `agent = 1` menampilkan 5 kolom. | Proyek lama tidak berubah. |
| A4 | Aktivitas adalah item `type = 'activity'` (judul = ringkasan satu baris, body = Markdown) dengan tabel ekstensi `activities (item_id, task_id, project_id, actor, role, kind)`. `actor` adalah nama bebas ("Kamu", "Opus", "Sol", "Gemini"). `role`: `request`, `plan`, `implement`, `test`, `review`, `merge`, atau `note`. `kind`: `message`, `status`, `result`, `link`. | Prinsip "semua hal adalah item", sehingga aktivitas bisa dicari lewat FTS dan disinkronkan nanti. |
| A5 | Perubahan status lewat UI atau CLI otomatis menulis aktivitas `kind = 'status'` ("Sol memindahkan ke Tes"). | Riwayat lengkap tanpa disiplin manual. |
| A6 | Hasil planning: `anchoa agent plan --task <id> --file <path.md>` menyimpan isi file sebagai aktivitas `role = plan`, dan juga sebagai halaman Catatan di bawah halaman proyek "Rencana <proyek>". | Rencana muncul di proyek dan di Catatan. |
| A7 | Kotak "Minta agen" membuat tugas di Rencana dengan aktivitas `role = request`. Kalau proyek punya **perintah agen** (diisi user di pengaturan proyek, misalnya `claude -p "$ANCHOA_REQUEST"`), Anchoa menjalankannya di folder repo proyek dengan env `ANCHOA_PROJECT`, `ANCHOA_TASK`, `ANCHOA_REQUEST`, dan `ANCHOA_CLI` (path binary). stdout dan stderr disimpan ke log `<data>/agent-runs/<task>.log`. Exit non-0 menulis aktivitas "Agen gagal (kode n)". Tanpa perintah, permintaan hanya menunggu di Rencana, dan agen bisa mengambilnya lewat `anchoa agent inbox`. | Tidak memilih LLM untuk user (itu keputusan Fase 5). Perintah diisi sendiri oleh user, sehingga tidak ada kredensial di Anchoa. |
| A8 | Perintah agen hanya dijalankan dari klik user ("Kirim"), tidak pernah otomatis, dan maksimal satu proses per proyek. Ada tombol "Hentikan". | Aman: tidak ada eksekusi tak terduga. |
| A9 | UI memperbarui papan dan utas setiap 3 detik selama halaman proyek agen terbuka. | Agen menulis dari proses lain; polling sederhana tanpa event lintas proses. |
| A10 | `anchoa agent` mencetak JSON satu baris per hasil (`--json` default), supaya mudah dibaca agen. | Mesin ke mesin. |

## 3. Model data (migrasi 010)

```sql
ALTER TABLE projects ADD COLUMN agent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN agent_command TEXT;   -- null = tanpa perintah
ALTER TABLE projects ADD COLUMN agent_dir TEXT;       -- folder repo lokal, harus di bawah home

CREATE TABLE activities (
  item_id    TEXT PRIMARY KEY REFERENCES items(id),  -- type='activity'
  task_id    TEXT REFERENCES items(id),
  project_id TEXT NOT NULL REFERENCES items(id),
  actor      TEXT NOT NULL,
  role       TEXT NOT NULL,
  kind       TEXT NOT NULL
);
CREATE INDEX activities_task ON activities(task_id);
CREATE INDEX activities_project ON activities(project_id);
```

`tasks.status` adalah teks. `TaskStatus` di Rust ditambah `Test` dan `Review`. Progres proyek menghitung `done` sebagai selesai, dan status lain sebagai belum selesai.

## 4. CLI `anchoa agent`

| Perintah | Hasil |
|---|---|
| `projects` | Daftar proyek agen: id, nama, folder. |
| `inbox [--project ID]` | Tugas di Rencana yang punya aktivitas `request` tanpa aktivitas lanjutan. |
| `task new --project ID --title T [--body B]` | Tugas baru di Rencana. |
| `task status --task ID STATUS --actor NAMA` | Pindah kolom, dan otomatis menulis aktivitas status (A5). |
| `log --task ID --actor NAMA --role ROLE [--kind KIND] [--title T] (--body B \| --file PATH)` | Menambah aktivitas. |
| `plan --task ID --actor NAMA --file PATH` | Rencana (A6). |
| `show --task ID` | Tugas dan semua aktivitasnya. |

Validasi:
- id harus ada;
- role dan kind dari daftar A4;
- body maksimal 200 KB;
- `--file` harus file biasa yang bisa dibaca.

Exit 0 kalau berhasil, dan 2 dengan pesan JSON `{"error": …}` kalau gagal.

## 5. UI

- **ProjectForm:** sakelar "Proyek agen", folder repo (input path, divalidasi di bawah home), dan perintah agen (opsional, dengan contoh di placeholder).
- **Proyek agen:**
  - Kanban 5 kolom. Kartu menampilkan aktor terakhir dan peran terakhirnya ("Sol · implement").
  - Klik kartu membuka panel kanan **Utas**: daftar aktivitas kronologis (avatar inisial aktor, peran, waktu, isi Markdown dirender dengan `BlockPreview` atau `markdown.tsx`), kotak balas (aktivitas `actor = Kamu`, `role = note`), dan tombol status.
- **Kotak "Minta agen"** di atas kanban, dengan tombol Kirim dan Hentikan (A7, A8). Ada indikator "Agen berjalan…" beserta tautan "Lihat log".
- **Tanpa proyek agen:** halaman Proyek tetap seperti sekarang.

## 6. Integrasi alur kerja

Setelah fitur ini ada, `CLAUDE.md` mendapat bagian "Melapor ke Anchoa":
- setiap agen menulis `anchoa agent log` di awal dan akhir tugas;
- planning memakai `anchoa agent plan`;
- implementasi memindahkan tugas ke Dikerjakan, lalu Tes, lalu Review;
- review menulis temuan sebagai aktivitas `role = review`;
- merge menulis tautan PR dan memindahkan tugas ke Selesai.

## 7. Testing

- **Rust:**
  - migrasi v9→v10;
  - status baru;
  - aktivitas otomatis saat status berubah;
  - inbox;
  - plan menulis aktivitas dan halaman Catatan;
  - CLI: parser argumen, error JSON, dan menolak berjalan tanpa DB (fungsi `run(args, data_dir) -> (code, stdout)` yang bisa diuji tanpa proses);
  - runner: perintah dengan env, log, exit non-0, dan satu proses per proyek (pakai `sh -c 'echo $ANCHOA_TASK'`).
- **Frontend:** kolom 5 untuk proyek agen, format utas, dan label peran.
- **E2E (`check_agent`):** buat proyek agen dengan perintah `"$ANCHOA_CLI" agent log --task "$ANCHOA_TASK" --actor Tes --role implement --body halo`, kirim permintaan, lalu tunggu aktivitas "halo" muncul di utas dan di DB. Jalankan `anchoa agent task status --task … test --actor Tes`, lalu cek kartu pindah ke kolom Tes. Screenshot.

## 8. Rencana PR

| PR | Isi |
|---|---|
| A-1 | Migrasi 010, `activities.rs`, status baru, CLI `anchoa agent`, dan test |
| A-2 | Runner perintah agen (A7, A8) dan command UI |
| A-3 | UI: form proyek agen, kanban 5 kolom, utas, Minta agen, polling, E2E, `CLAUDE.md` "Melapor ke Anchoa", versi 0.10.0 |
