# CLAUDE.md

Panduan proyek untuk Claude Code. Baca ini di awal setiap sesi kerja di repo ini.

## Ringkasan Proyek

File manager desktop Linux (setara Thunar/Nautilus) dengan panel AI/CLI terintegrasi untuk operasi file batch/bersyarat. Rilis open-source publik lewat AUR dan Flatpak — sekaligus proyek portofolio, jadi kualitas kode dan kejelasan arsitektur diperlakukan sepenting fitur.

## Stack

- **Bahasa:** Rust edition 2024
- **UI:** `gtk4-rs` + libadwaita, arsitektur komponen lewat `relm4`
- **Async runtime:** tokio (jangan campur runtime lain)
- **Database:** SQLite lewat `rusqlite` (sinkron, dipanggil dari worker thread), migration bernomor sejak commit pertama
- **LLM runtime:** `llama.cpp` via FFI (crate `llama-cpp-2`), model default Qwen2.5-1.5B/3B-Instruct quantized Q4_K_M — **jangan pernah rekomendasikan atau tambahkan dependensi model 7B+**
- **Identitas:** nama `loom`, app ID `io.github.syharipf.Loom`, lisensi GPL-3.0-or-later
- **Packaging:** AUR (PKGBUILD) + Flatpak (sandbox minimal: `--filesystem=home`, `--filesystem=/run/media`, `--filesystem=/mnt` — bukan `=host`)

## Perintah

```bash
cargo build
cargo test
cargo fmt --check
cargo clippy --all-targets -- -D warnings
```

Jalankan `cargo fmt` dan `cargo clippy --all-targets -- -D warnings` sebelum menganggap task selesai — jangan tunggu diminta.

## Workflow

**Perubahan kecil** (1–2 file, < ~100 baris): dikerjakan langsung oleh Opus, tanpa delegasi — biaya briefing + review melebihi penghematannya.

**Fitur multi-file:**

1. **Plan (Opus):** rencana + task list. Test ditulis dulu oleh Opus sebagai spesifikasi.
2. **Implementasi (delegasi):** subagent Sonnet/Haiku, atau `agy-delegate -m gemini-3.8-flash-high --dir <repo>`. Pelaksana **tidak boleh mengubah test** yang ditulis Opus.
3. **Verifikasi (Opus):** jalankan sendiri `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` di state bersih. Jangan percaya laporan "lulus" dari pelaksana.
4. **Review lintas model:** `agy:review` atas diff; Opus hakim akhir atas temuan.

**Git:** satu branch per perubahan (`feat/…`, `fix/…`, `chore/…`, `docs/…`), commit Conventional Commits, push, buka PR ke `main` via `gh pr create`. Claude **tidak merge** — setelah CI hijau dan verifikasi selesai, laporkan link PR; pengguna yang merge (squash). `main` diproteksi: wajib PR + check `check` hijau, tanpa push langsung. Jangan pernah commit secret, `.env*`, `*.db`, atau `*.gguf` — cek `git status` sebelum commit.

## Arsitektur

Satu proses, pemisahan tegas UI thread (GTK4) vs worker thread (filesystem + inferensi LLM). UI thread **tidak boleh** blocking untuk operasi file atau panggilan LLM apa pun — selalu lewat channel async ke worker thread.

Lapisan: `UI (relm4)` → `Command Layer (rule parser → LLM fallback → Validator)` → `Execution Layer (worker thread)` → `Persistence (SQLite + TOML)`.

Command Layer menghasilkan `ActionPlan` terstruktur, bukan langsung mengeksekusi. Lihat aturan keras di bawah.

## Aturan Keras (Non-Negotiable)

Ini bukan preferensi gaya — melanggarnya berarti melanggar requirement keamanan/desain proyek:

1. **Tidak ada eksekusi shell command arbitrer dari panel AI.** Output LLM hanya boleh memilih dari whitelist operasi (`move`, `copy`, `trash`, `rename`, `mkdir`, `chmod`). Setiap `ActionPlan` — baik dari rule parser maupun LLM — **wajib** lolos `Validator` sebelum dieksekusi. Jangan pernah membuat jalur yang melewati Validator, termasuk untuk "kasus khusus" atau debugging.
2. **Delete selalu lewat trash XDG** via `gio::File::trash()` (menangani `.Trash-$uid` di mount lain dan portal Flatpak — jangan tulis manual ke direktori Trash), bukan `unlink`/`remove_file` permanen, kecuali eksplisit diminta pengguna dan dikonfirmasi via dialog — bukan default.
3. **Model LLM lokal bersifat opsional.** Semua fitur inti (navigasi, CRUD, permission, rule-based command) harus tetap berfungsi penuh tanpa model terpasang. Jangan menambahkan kode yang mengasumsikan model selalu ada.
4. **Tidak ada panggilan jaringan** untuk fungsi inti apa pun, termasuk AI (no cloud LLM fallback). Kalau menambah dependensi baru, cek dulu apakah dia diam-diam butuh network di runtime.
5. **State persisten hanya di path XDG** (`$XDG_CONFIG_HOME/loom`, `$XDG_DATA_HOME/loom`) — resolve lewat `glib::user_config_dir()`/`glib::user_data_dir()`, jangan hardcode `~/.config` (Flatpak memetakannya ke `~/.var/app/<app-id>/`). Jangan menulis ke home directory langsung.
6. **Panel AI hanya mengirim metadata direktori ke model** (nama, ukuran, permission, timestamp) — tidak pernah isi file.
7. **Setiap operasi destruktif harus melalui tahap preview + konfirmasi eksplisit** sebelum eksekusi. Tidak ada auto-execute.

## Database

SQLite di `$XDG_DATA_HOME/loom/history.db`. Tabel utama: `operation`, `operation_item` (pasangan untuk undo — simpan state before/after, jangan menyalin isi file), `command_history` (untuk mengukur rasio rule-based vs LLM), `bookmark`. Tabel `download_job` sudah disiapkan di skema untuk v2 — **jangan diimplementasikan sekarang**, hanya jaga agar migration tidak perlu dirombak nanti.

Retensi: pangkas otomatis operasi berumur >30 hari **atau** di luar 1.000 operasi terakhir (mana yang lebih dulu tercapai).

Preferensi pengguna disimpan terpisah sebagai TOML di `$XDG_CONFIG_HOME/loom/config.toml`, bukan di database.

## Scope v1 — Jangan Implementasikan Dulu

Kalau diminta menambah salah satu ini tanpa konteks eksplisit yang mengubah scope, tanyakan dulu — ini keputusan sadar yang ditunda ke v2:

- Download manager / torrent (aria2c wrapper)
- Tab & multi-window
- Dual-pane view
- Operasi remote (SFTP/SMB/MTP/GVfs)
- Thumbnail video/PDF
- Plugin/extension system
- LLM cloud/API backend

## Konvensi Kode

- Error handling: `thiserror` untuk error domain (yang perlu ditangani berbeda-beda di caller), `anyhow` untuk error di boundary aplikasi/main.
- Kode yang menyentuh FFI ke llama.cpp: isolasi `unsafe` seminimal mungkin, wrap di fungsi aman secepatnya, beri komentar kenapa unsafe-nya sound.
- Operasi filesystem yang bisa gagal di tengah jalan (copy/move banyak file) harus punya jalur cleanup eksplisit — jangan biarkan partial state ambigu (lihat User Flow 6.4 di PRD).
- Test wajib untuk: rule-based parser (regresi paling gampang lolos tanpa test), Validator whitelist (termasuk input adversarial — path traversal, operasi di luar daftar izin), operasi filesystem dengan skenario gagal (disk penuh, permission ditolak, konflik nama) pakai temp dir.

## Target Lingkungan

Harus tetap wajar di KDE Plasma **dan** tiling WM (i3wm) — jangan bergantung pada dekorasi jendela sisi server, jangan rusak tanpa compositor. Navigasi penuh lewat keyboard adalah requirement, bukan nice-to-have.

## Referensi

PRD lengkap (goals, user flow, architecture diagram, ERD, open questions) ada di `docs/PRD.md`. Cek §10 Open Questions sebelum mengasumsikan keputusan yang belum final (threshold confidence parser, grammar parser lengkap, undo trash di Flatpak, dll). Bahasa perintah v1: Inggris saja.
