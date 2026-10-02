<p align="center">
  <img src="landing/public/social-card.png" alt="Anchoa: satu kawanan untuk semua urusan harianmu" width="720">
</p>

<h1 align="center">Anchoa</h1>

<p align="center">
  Aplikasi desktop all-in-one untuk urusan harian: tugas, jadwal, keuangan, jurnal, catatan, berkas, unduhan, dan email dalam satu tempat, dengan asisten AI yang berjalan di laptopmu sendiri.
</p>

<p align="center">
  <a href="https://github.com/Syharipf/Anchoa/releases/latest"><img alt="Rilis terbaru" src="https://img.shields.io/github/v/release/Syharipf/Anchoa?label=rilis&color=c6f36b&labelColor=0f1115"></a>
  <a href="https://github.com/Syharipf/Anchoa/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Syharipf/Anchoa/ci.yml?branch=main&label=CI&labelColor=0f1115"></a>
  <img alt="Platform: Fedora Linux" src="https://img.shields.io/badge/platform-Fedora%20Linux-51a2da?labelColor=0f1115">
  <img alt="Data lokal" src="https://img.shields.io/badge/data-lokal%20(SQLite)-8a9ba8?labelColor=0f1115">
</p>

<p align="center">
  <a href="https://syharipf.github.io/Anchoa/">Landing page</a> ·
  <a href="docs/MANUAL.md">Panduan pengguna</a> ·
  <a href="#instal">Instal</a> ·
  <a href="https://github.com/Syharipf/Anchoa/releases">Rilis</a>
</p>

---

## Kenapa Anchoa

- **Semua di satu tempat.** Tugas, jadwal, uang, habit, jurnal, dan catatan saling tertaut; satu pencarian (Ctrl K) untuk semuanya.
- **Data tetap di laptopmu.** Semua tersimpan di SQLite lokal, dengan backup harian otomatis. Tidak perlu akun Anchoa, dan tidak ada data yang dikirim ke cloud.
- **Asisten yang privat.** Asisten berjalan di Ollama lokal, bisa diajak bicara (Whisper dan Piper), dan setiap perubahan yang diusulkannya harus kamu setujui dulu.
- **Gratis.** Seluruh kodenya ada di repo ini.

## Modul

| Modul | Isi |
|---|---|
| Dashboard | Tugas hari ini, agenda mendatang, ringkasan modul, kontribusi GitHub (opsional) |
| Jurnal | Ide, curhat, catatan singkat, tag, suasana hati; ide bisa dijadikan tugas |
| Catatan | Halaman bertingkat, editor blok Markdown, `[[wikilink]]` dan tautan balik, sampah, ekspor Markdown |
| Email | Satu akun Gmail: baca, tulis, balas, bintang, arsip, ringkasan dan saran balasan dari asisten |
| Jadwal | Kalender bulanan dan timeline 8 minggu dari tugas dan tagihan |
| Habit | Centang harian, hari aktif, pengingat, streak, riwayat |
| Keuangan | Akun, pemasukan, pengeluaran, transfer, tagihan, batas pengeluaran bulanan |
| Proyek | Kanban, sub-tugas, papan agen kode dengan utas aktivitas |
| Berkas | Jelajah folder lokal, pratinjau, salin, pindah, buang ke Tong Sampah |
| Unduhan | File langsung serta video/audio lewat yt-dlp dan ffmpeg, dengan antrean |
| Asisten | Chat dan suara, usulan aksi yang harus disetujui, model per tugas |
| Notifikasi, Profil, Pengaturan | Pengingat, statistik, kunci PIN, model AI, suara, backup, integrasi |

Cara pakai setiap modul ada di [panduan pengguna](docs/MANUAL.md).

**Status:** versi 0.17.0, untuk Fedora Linux. Yang direncanakan: sinkron terenkripsi end-to-end antarperangkat ([spec](docs/superpowers/specs/2026-10-02-anchoa-sync-design.md)), lalu Android dan Windows.

## Instal

Tambahkan repo dnf Anchoa sekali, lalu pasang:

```bash
sudo dnf config-manager addrepo --from-repofile=https://syharipf.github.io/Anchoa/anchoa.repo
sudo dnf install anchoa
```

Pembaruan lewat `sudo dnf upgrade`. Paket dan metadata repo ditandatangani GPG; dnf meminta konfirmasi kunci saat pertama kali.

File `.rpm` juga tersedia di [GitHub Releases](https://github.com/Syharipf/Anchoa/releases/latest). Pasang file yang diunduh dengan `sudo dnf install ./Anchoa-<versi>-1.x86_64.rpm`, lalu buka Anchoa dari menu aplikasi atau jalankan `anchoa`.

## Program tambahan (opsional)

Modul lokal dapat dipakai tanpa memasang semua program berikut.

- **Ollama:** menjalankan Asisten di laptop. Pasang [paket Fedora Ollama](https://packages.fedoraproject.org/pkgs/ollama/ollama/), jalankan layanannya, lalu unduh model bawaan `qwen2.5:3b`:

  ```bash
  sudo dnf install ollama
  sudo systemctl start ollama
  ollama pull qwen2.5:3b
  ```

  Buka Pengaturan > Asisten & AI, klik **Tes koneksi**, lalu pilih model per tugas. Alamat bawaan: `http://127.0.0.1:11434`.

- **whisper-cpp:** mengubah ucapan menjadi teks. Perintah pasang yang ditampilkan aplikasi: `sudo dnf install whisper-cpp` ([paket Fedora](https://packages.fedoraproject.org/pkgs/whisper-cpp/whisper-cpp/)). Anchoa mencari `whisper-cli`, lalu `whisper-cpp`, di PATH. Di Pengaturan > Suara, klik **Pasang** untuk **Model Whisper Base (ggml-base.bin)**.
- **Piper dan suara Piper:** membacakan jawaban Asisten. Di Pengaturan > Suara, klik **Pasang** pada **Piper TTS**, lalu **Pasang** pada suara **Indonesia · News** (`id_ID-news_tts-medium`). Binary dan model suara diunduh oleh aplikasi; tidak perlu memasang paket Piper dengan dnf. Suara lain dan impor pasangan `.onnx`/`.onnx.json` juga tersedia.
- **pw-record dan pw-play:** merekam mikrofon dan memutar suara melalui PipeWire. Jika belum ada, pasang dengan `sudo dnf install pipewire-utils` ([paket Fedora](https://packages.fedoraproject.org/pkgs/pipewire/pipewire-utils/)).
- **yt-dlp dan ffmpeg:** mengunduh serta mengolah video/audio. Perintah yang ditampilkan aplikasi: `sudo dnf install yt-dlp ffmpeg`. Ketersediaan paket `ffmpeg` mengikuti repo yang aktif. Unduhan file langsung tidak memerlukan keduanya; torrent belum didukung.
- **Google App Password:** untuk Email, bukan program Fedora. Aktifkan 2-Step Verification, buat App Password di [akun Google](https://myaccount.google.com/apppasswords), lalu isi **Alamat Gmail** dan **App Password** di menu Email dan klik **Sambungkan**. Password harus 16 huruf; spasi boleh. Password disimpan di keyring sistem.

Unduhan model memerlukan internet. Setelah terpasang, percakapan dan pemrosesan suara berjalan lokal dengan alamat AI bawaan.

## Data dan backup

- Database bawaan: `~/.local/share/io.github.syharipf.anchoa/anchoa.db`.
- Backup: folder `backups/` di direktori data, otomatis saat aplikasi dibuka jika backup hari itu belum ada. Backup manual dan harian berbagi batas 7 berkas terbaru.
- Pengaturan > Sinkron & data menyediakan **Backup sekarang**, **Buka folder backup**, dan **Buka folder data**. Gunakan lokasi yang tampil di sana jika direktori data sistem berbeda.

Backup hanya menyalin database SQLite. File asli, hasil unduhan, model suara, log agen, App Password di keyring, dan berkas `github-token` tidak ikut. Database dan backup belum dienkripsi.

### Memulihkan dari backup

1. Tutup Anchoa dan hentikan agen yang memakai database.
2. Masuk ke direktori data, lalu simpan database saat ini beserta WAL/SHM jika ada:

   ```bash
   cd ~/.local/share/io.github.syharipf.anchoa
   anchoa_rescue_dir="sebelum-pemulihan-$(date +%Y%m%d-%H%M%S)"
   mkdir "$anchoa_rescue_dir"
   for file in anchoa.db anchoa.db-wal anchoa.db-shm; do
     if [ -f "$file" ]; then mv "$file" "$anchoa_rescue_dir/"; fi
   done
   ```

3. Pilih berkas backup yang ada dan salin menjadi `anchoa.db`. Ganti nama contoh berikut sesuai pilihan:

   ```bash
   cp backups/anchoa-2026-10-02.db anchoa.db
   ```

4. Buka Anchoa lagi. Data kembali ke waktu backup, termasuk pengaturan PIN. Sambungkan Gmail/GitHub kembali bila kredensialnya tidak ada.

## Lupa PIN

Tutup Anchoa, lalu jalankan perintah yang sama dengan layar **Lupa PIN?** (butuh `sqlite3`; pasang dengan `sudo dnf install sqlite`):

```bash
sqlite3 ~/.local/share/io.github.syharipf.anchoa/anchoa.db "DELETE FROM settings WHERE key = 'security.pin_hash';"
```

Buka kembali Anchoa. PIN menjadi nonaktif. Jika lokasi data berbeda, sesuaikan path database.

## Pengembangan

Kebutuhan: Rust stable, bun, dan library sistem untuk Tauri:

```bash
sudo dnf install webkit2gtk4.1-devel librsvg2-devel libappindicator-gtk3-devel libxdo-devel
```

Dari akar repo:

```bash
bun install
bun tauri dev
bun run typecheck
bun run test
bun tauri build
```

Paket RPM ada di `src-tauri/target/release/bundle/rpm/`. Cek backend dari `src-tauri/`:

```bash
cargo clippy --all-targets -- -D warnings
cargo test
```

Uji end-to-end di display virtual memerlukan `Xvfb`, `xdotool`, ImageMagick, dan `sqlite3`:

```bash
bun tauri build --debug --no-bundle
scripts/e2e-smoke.sh src-tauri/target/debug/anchoa
```

Landing page ada di `landing/`:

```bash
cd landing
bun install
bun run build
```

Rencana dan spec ada di `docs/superpowers/`; fitur yang tersedia mengikuti kode, bukan rencana.
