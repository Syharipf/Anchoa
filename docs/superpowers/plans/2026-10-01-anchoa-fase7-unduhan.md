# Anchoa Fase 7 (Unduhan): Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Kode ditulis oleh Gemini 3.8 Flash High lewat `agy-multi`, lalu dicek sesi Opus.

**Goal:** Antrean unduhan media (yt-dlp + ffmpeg) dan file langsung (Rust `ureq`), dengan jeda, lanjut, batas paralel, dan batas kecepatan.

**Architecture:**
- `downloads.rs` berisi fungsi murni: DB, argumen yt-dlp, dan parser progres.
- `downloader.rs` adalah manajer runtime di Tauri `State`. Ia memegang proses anak dan thread, progres di memori, dan penjadwal FIFO.
- Frontend memakai polling `downloads_list` tiap 1 detik.

**Spec:** `docs/superpowers/specs/2026-10-01-anchoa-fase7-unduhan-design.md`. Baca seluruhnya, terutama §2 dan §4.

**Bentuk rencana:** sama seperti rencana Fase 4 dan 6. Rencana ini berisi antarmuka, aturan, dan test wajib. Kerjakan TDD dengan satu commit per task, dan stage path secara eksplisit.

## Global Constraints

- Semua Global Constraints rencana sebelumnya berlaku, termasuk aturan SonarCloud.
- Tidak ada dependency baru. Pakai `ureq`, `serde_json`, `std::process`, dan `std::thread`.
- Test Rust tidak memakai jaringan luar. Server HTTP test berjalan di `127.0.0.1` dalam thread.
- Test Rust tidak menjalankan yt-dlp asli. Logika proses diuji lewat argumen dan parser. yt-dlp asli hanya dijalankan di E2E.
- Tidak boleh panic di path yang dipicu user. Mutex yang ter-*poison* dipetakan ke `AppError`.
- Nama rilis: "Anchoa v0.8.0 — Unduhan".

## Pembagian PR

| PR | Branch | Task |
|---|---|---|
| 7-1 | `feat/72-f7-1-downloads-backend` | 1–3 |
| 7-2 | `feat/73-f7-2-downloads-page` | 4–6 |

---

# PR 7-1

### Task 1: Migrasi 008 dan `downloads.rs`

**Antarmuka:**

```rust
pub enum DownloadKind { Media, File }                        // "media" | "file"
pub enum DownloadStatus { Queued, Running, Paused, Processing, Done, Failed }
pub struct MediaOptions { audio_only: bool, quality: String /* "1080p" | "192 kbps" */, format: String /* "MP4" | "MP3" */, subtitles: bool }
pub struct NewDownload { url, kind, options: Option<MediaOptions> }
pub struct DownloadRow { id, title, url, kind, options, status, total_bytes: Option<i64>, done_bytes: i64, file_path: Option<String>, error: Option<String>, created_at, finished_at }
pub struct DownloadSettings { dir: String, parallel: u8 /* 1..=5 */, limit: u64 /* byte/detik, 0 = tanpa batas */ }
pub fn add(conn, input, now) -> Result<DownloadRow, AppError>        // validasi URL; magnet/.torrent → Invalid("Torrent belum didukung")
pub fn list(conn) -> Result<Vec<DownloadRow>, AppError>              // terbaru dulu, tanpa yang terhapus
pub fn get(conn, id) -> Result<DownloadRow, AppError>
pub fn set_status(conn, id, status, error: Option<&str>, now) -> Result<(), AppError>
pub fn set_progress(conn, id, done, total) / set_title / set_file
pub fn next_queued(conn, limit: usize) -> Result<Vec<String>, AppError>  // FIFO by created_at
pub fn pause_interrupted(conn) -> Result<usize, AppError>            // running|queued|processing → paused (saat start)
pub fn remove(conn, id, now) -> Result<(), AppError>                 // soft delete
pub fn settings(conn, default_dir) -> Result<DownloadSettings, AppError>
pub fn save_settings(conn, s, home) -> Result<DownloadSettings, AppError>  // dir harus ada & di bawah home; parallel 1..=5
pub fn build_ytdlp_args(opts: &MediaOptions, dir: &Path, limit: u64) -> Vec<String>
pub fn parse_line(line: &str) -> Option<YtEvent>  // Progress{done,total,speed,eta} | Post | Title(String) | File(String) | Error(String)
pub fn safe_name(raw: &str) -> String              // buang '/', '\0', ".." di depan; kosong → "unduhan"
```

Argumen yt-dlp mengikuti spec §4 secara persis. Template progres:

```
--progress-template "download:PROGRESS %(progress.downloaded_bytes)s/%(progress.total_bytes,progress.total_bytes_estimate)s/%(progress.speed)s/%(progress.eta)s"
--progress-template "postprocess:POST"
--print "before_dl:TITLE %(title)s"
--print "after_move:FILE %(filepath)s"
```

Nilai `NA` di baris progres dibaca sebagai `None`.

**Test:**
- `version_7_database_upgrades_to_downloads_schema` (di `db.rs`);
- `add_rejects_bad_urls_and_torrents`;
- `list_is_newest_first_and_skips_removed`;
- `next_queued_is_fifo_and_respects_the_limit`;
- `interrupted_downloads_become_paused`;
- `settings_default_and_validate`;
- `ytdlp_args_for_video_audio_subtitles_and_limit`;
- `parse_progress_post_title_file_and_error_lines`;
- `safe_name_strips_path_parts`.

**Commit:** `feat: add the downloads schema and rules`.

### Task 2: `downloader.rs` (runtime)

**Antarmuka:**

```rust
pub struct Downloader { inner: Mutex<HashMap<String, Live>> }  // Live { cancel: Arc<AtomicBool>, child: Option<Child>, done, total, speed, eta }
impl Downloader {
  pub fn schedule(&self, app: &AppHandle) -> Result<(), AppError>   // isi slot sampai parallel dari next_queued
  pub fn pause(&self, id) ; pub fn cancel(&self, id)               // kill child / set flag
  pub fn live(&self) -> HashMap<String, LiveProgress>
}
pub fn fetch_file(url, dir, limit, cancel: &AtomicBool, on_progress: impl FnMut(u64, Option<u64>)) -> Result<PathBuf, AppError>
```

- `fetch_file` mengikuti spec §4 bagian "File langsung": file sementara di `.anchoa-part/<id>/`, `Range`, 200 berarti mulai dari awal, rename ke folder saat selesai dengan nama unik (`files::unique_name`), dan throttle dengan sleep per potongan 64 KB.
- `Live` menyimpan `Child` di map, setelah stdout-nya diambil oleh thread pembaca. Jeda dan batal mengunci map lalu memanggil `child.kill()`. Thread pembaca selesai saat EOF, lalu mengunci map dan memanggil `wait()`. Flag `cancel` membedakan dihentikan dari gagal.
- Thread worker:
  - yt-dlp dijalankan dengan `Command::new("yt-dlp")`, stdout di-pipe dan dibaca per baris lewat `parse_line`;
  - state memori diperbarui;
  - DB diperbarui saat status berubah, memakai `Db` dari `app.state()`;
  - saat selesai atau gagal: entri dihapus dari map, lalu `schedule()` dipanggil.
- Kalau yt-dlp tidak ditemukan: status Gagal dengan pesan "yt-dlp belum terpasang: sudo dnf install yt-dlp ffmpeg".

**Test:**
- `fetch_file_downloads_and_resumes_with_range`: server lokal memakai `TcpListener`, mendukung `Range`, dan file `.part` sudah ada setengah;
- `fetch_file_restarts_when_range_is_ignored`;
- `fetch_file_stops_when_cancelled`;
- `fetch_file_picks_a_unique_name`.

**Commit:** `feat: run downloads in the background`.

### Task 3: Command, startup, dan tipe API

- `commands.rs`: semua command di spec §4. `downloads_list` menggabungkan baris DB dengan progres memori dan menghitung `speed` total serta jumlah `active`.
- `download_engines`:
  - `yt-dlp --version` (format `YYYY.MM.DD`; petunjuk pembaruan kalau lebih tua dari 60 hari, dihitung di Rust);
  - `ffmpeg -version` (baris pertama);
  - null kalau tidak ada.
- `lib.rs`:
  - `manage(Downloader::default())`;
  - saat setup, panggil `pause_interrupted`;
  - daftarkan command.
- `src/api.ts`: tipe dan pemanggil.

**Test:** `cargo test`, clippy, typecheck, `bun run test`, dan E2E penuh `PASS`.
**Commit:** `feat: expose download commands`.
**Penutup PR 7-1.**

---

# PR 7-2

### Task 4: Aturan tampilan

`src/downloads/view.ts` dan `view.test.ts`:
- `detect(url)` sesuai U4, dengan contoh dari artboard;
- `progressText(row)`, misalnya "63% · 8,2 MB/s · 19 dtk lagi", "Menunggu giliran antrean", dan "Tersimpan di …";
- `STATUS_LABELS`;
- `addLabel(det, opts)`;
- `formatSpeed`.

**Commit:** `feat: add download view rules`.

### Task 5: Halaman Unduhan dan kartu dashboard

**Files:**
- `src/downloads/` berisi `DownloadsPage.tsx`, `AddDownload.tsx`, `DownloadQueue.tsx`, `EnginesPanel.tsx`, dan `DownloadSettingsPanel.tsx`.
- `nav.ts`: Unduhan tanpa `fase` dan `about`.
- `App.tsx`.
- Kartu Unduhan di dashboard: `dashboard.rs` menambahkan ringkasan unduhan (2 aktif dan kecepatan dari `Downloader`), dan di frontend, kartunya.

**Perilaku:** spec §5. "Tampilkan di Berkas" membuka halaman Berkas di folder file itu, lewat prop navigasi yang sudah ada di `App`.

**Commit:** `feat: add the Unduhan page`.

### Task 6: E2E, versi 0.8.0, penutup

**`scripts/e2e-smoke.sh`:** fungsi `check_downloads`.
- Server lokal: `python3 -m http.server` di port bebas, di direktori sementara.
- Isi direktori itu dibuat dengan:
  - `head -c 2097152 /dev/urandom > contoh.bin`;
  - `ffmpeg -f lavfi -i sine=d=3 -f lavfi -i color=c=green:s=160x120:d=3 -shortest klip.mp4`.
- Setting `downloads.dir` diisi direktori sementara lewat `sql` sebelum `start_app`.
- Alur sesuai spec §6:
  - tempel URL dengan `xdotool type`, lalu klik Unduh;
  - tunggu, lalu cek file di disk dan status `done` di DB;
  - screenshot.
- `kill` server di akhir.

**Versi 0.8.0.** Status di `CLAUDE.md`.

**Commit:** `test: cover downloads end to end; bump version to 0.8.0`.
**Penutup PR 7-2**, lalu rilis "Anchoa v0.8.0 — Unduhan".
