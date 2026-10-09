# Anchoa: Dukungan Arch Linux / CachyOS (pacman repo + AUR) dan Rilis Otomatis

> **For agentic workers:** Kerjakan per task. Task 1 dan 3 dikerjakan subagent `implementer` (Sonnet); Task 2 di thread utama karena butuh iterasi CI; review oleh `reviewer-opus`.

**Goal:** Anchoa bisa dipasang dan diperbarui di CachyOS/Arch lewat `pacman` atau `paru`, berjalan dengan UI yang sama seperti di Fedora, dan setiap rilis dibuat otomatis oleh CI (RPM + paket Arch + repo).

**Architecture:**
- **Build paket Arch di container `archlinux:base-devel`** supaya biner ditautkan ke library Arch (webkit2gtk-4.1, glibc rolling). Tauri membangun bundle `deb` (pure Rust, tidak butuh dpkg); isi `data/` (biner, `.desktop`, ikon, resource `/usr/lib/Anchoa`) dikemas jadi `anchoa-<ver>-x86_64.tar.gz` lalu `PKGBUILD` mengekstraknya. Satu `PKGBUILD` dipakai untuk repo pacman (`anchoa`) dan AUR (`anchoa-bin`, hasil `sed`).
- **Repo pacman di GitHub Pages** `https://syharipf.github.io/Anchoa/arch/x86_64/`, dibangun bersama repo dnf di `dnf-repo.yml` (Pages selalu diganti utuh). Paket dan DB ditandatangani dengan kunci GPG yang sama (`RPM_GPG_PRIVATE_KEY`).
- **Rilis otomatis** `release.yml`: push ke `main` yang mengubah versi di `src-tauri/tauri.conf.json` dan tag `v<versi>` belum ada → build RPM (container `fedora:44`) + paket Arch → `gh release create` → dispatch `dnf-repo.yml` dan `android-release.yml` (rilis buatan `GITHUB_TOKEN` tidak memicu event `release`, jadi harus di-dispatch).
- **AUR** `anchoa-bin` di-push dari `release.yml` hanya jika secret `AUR_SSH_PRIVATE_KEY` ada; tanpa secret, job dilewati.
- **GPU:** mesin yang hanya punya NVIDIA (umum di CachyOS) belum ditangani `gpu.rs`; WebKitGTK di driver proprietary NVIDIA gagal membuat buffer GBM → jendela kosong. Set `WEBKIT_DISABLE_DMABUF_RENDERER=1` di kasus itu.

## Global Constraints

1. Semua cek eksisting tetap hijau: `bun run typecheck`, `bun run test`, `cargo test`, `cargo clippy --all-targets -- -D warnings`.
2. Alur RPM/dnf tidak boleh rusak: `anchoa.repo` dan URL `rpm/x86_64` tetap.
3. Tidak ada secret di repo. Bash memakai `[[ ... ]]` (SonarCloud).
4. Font sudah dibundel lewat `@fontsource`, jadi UI tidak bergantung font sistem; jangan tambahkan font sistem sebagai dependensi.

## Tasks

### Task 1: Workaround GPU NVIDIA-only (`src-tauri/src/gpu.rs`, `src-tauri/src/lib.rs`)

- [ ] Test gagal dulu: fungsi murni yang, untuk daftar render node, memilih aksi: node non-NVIDIA (perilaku lama), *disable DMA-BUF* untuk mesin NVIDIA-only, atau tidak apa-apa.
- [ ] `apply_linux_workaround()` men-set `WEBKIT_DISABLE_DMABUF_RENDERER=1` untuk NVIDIA-only, kecuali user sudah men-set variabel itu atau `WEBKIT_WEB_RENDER_DEVICE_FILE`.
- [ ] Log di `lib.rs` menyebut aksi yang diambil.
- [ ] `cargo test gpu::`, `cargo clippy --all-targets -- -D warnings`.

### Task 2: Packaging & workflow (`packaging/arch/`, `.github/workflows/`)

- [ ] `packaging/arch/PKGBUILD`: `pkgname=anchoa`, ekstrak tarball rilis, dependensi runtime Arch, `optdepends` (ollama, gnome-keyring/kwallet, gst-plugins).
- [ ] `packaging/arch/build-tarball.sh`: build bundle deb Tauri, kemas `data/` jadi tarball.
- [ ] `packaging/arch/smoke.sh`: `pacman -U`, cek `ldd` tanpa `not found`, jalankan `/usr/bin/anchoa` di Xvfb dengan D-Bus privat, tunggu DB + jendela, screenshot, pastikan layar tidak kosong.
- [ ] `ci.yml` job `arch`: build debug di container Arch, `makepkg`, `smoke.sh`, unggah screenshot.
- [ ] `release.yml` seperti di Architecture.
- [ ] `dnf-repo.yml`: job `arch-repo` (container Arch) mengunduh `*.pkg.tar.zst` 5 rilis terakhir, `gpg --detach-sign`, `repo-add --sign`, menyalin symlink jadi file biasa; job Pages menggabungkannya ke `site/arch/`.
- [ ] `packaging/arch/anchoa-pacman.conf`: potongan `pacman.conf`.

### Task 3: Dokumentasi

- [ ] README: bagian "Arch Linux / CachyOS (repo pacman)", AUR, badge platform, build dari sumber di Arch.
- [ ] Landing: kartu unduhan Arch/CachyOS, teks "tersedia di Fedora" → "Fedora & Arch".
- [ ] CLAUDE.md: target, alur rilis baru, catatan peran model di cloud.

### Task 4: Rilis

- [ ] Bump versi ke `0.33.0` (`package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`).
- [ ] PR → CI hijau (termasuk job `arch`) → review → merge → `release.yml` membuat `v0.33.0` → Pages memuat `arch/x86_64/anchoa.db`.

## Langkah manual untuk user

- AUR: buat akun AUR, daftarkan kunci SSH publik, simpan kunci privat sebagai secret `AUR_SSH_PRIVATE_KEY`. Tanpa ini, `paru -S anchoa` tetap jalan lewat repo pacman.
- Uji di CachyOS asli dengan GPU nyata (Xvfb memakai software GL).
