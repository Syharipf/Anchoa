# Mulai membangun `anchoa-app` (Tauri 2 + SvelteKit + Supabase) dengan Claude Code

Repo pasangan: `anchoa-supabase` (lihat paket terpisah). Letakkan keduanya bersebelahan, mis. `~/proyek/anchoa-app` dan `~/proyek/anchoa-supabase`.

Paket ini **bukan** kode aplikasi. Isinya bekal supaya Claude Code membangun Anchoa dengan benar:

| Isi | Fungsi |
|---|---|
| `CLAUDE.md` | Aturan proyek. Dibaca otomatis oleh Claude Code setiap sesi. |
| `docs/ARCHITECTURE.md` + `docs/arsitektur-anchoa.png` | Arsitektur final (Supabase, 2 repo, file via Tailscale + SFTP). |
| `docs/design/` | `DESIGN.md`, `tokens.css`, `artboards/*.dc.html`, dan folder `screenshots/` (kamu isi). |
| `docs/ROADMAP.md` | Fase 0–9 dengan checklist dan kriteria selesai. |
| `docs/PROMPTS.md` | Prompt siap salin per fase. |
| `.claude/commands/` | Perintah pintas: `/fase`, `/cek-desain`, `/cek-keamanan`. |
| `static/live2d/` | Tempat Cubism Core dan model (kamu isi, tidak di-commit). |
| `gitignore-tambahan.txt` | Baris untuk ditambahkan ke `.gitignore`. |

Perintah di bawah untuk **Fedora**. Distro lain: https://v2.tauri.app/start/prerequisites/

---

## Langkah 1 — Prasyarat desktop

```bash
sudo dnf install webkit2gtk4.1-devel \
  openssl-devel \
  curl \
  wget \
  file \
  libappindicator-gtk3-devel \
  librsvg2-devel \
  libxdo-devel
sudo dnf group install "c-development"

# Rust (pilih instalasi default), lalu buka terminal baru
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh

# Node.js LTS (dari repo Fedora, atau pakai fnm/nvm kalau lebih suka)
sudo dnf install nodejs

rustc --version && node --version && npm --version
```

## Langkah 2 — Prasyarat Android (boleh menyusul sebelum uji Android di Fase 0)

1. Pasang **Android Studio**. Buka *SDK Manager* dan pasang: Android SDK Platform, Platform-Tools, **NDK (Side by side)**, Build-Tools, Command-line Tools.
2. Tambahkan ke `~/.bashrc` (atau shell yang kamu pakai), sesuaikan lokasi instalasi Android Studio:
   ```bash
   export JAVA_HOME=/opt/android-studio/jbr        # ganti jika Android Studio ada di tempat lain
   export ANDROID_HOME="$HOME/Android/Sdk"
   export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 $ANDROID_HOME/ndk)"
   ```
3. Target Rust untuk Android:
   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```
4. Di HP: aktifkan *Opsi pengembang* → *USB debugging*, sambungkan kabel, cek `adb devices`.

## Langkah 3 — Buat proyek

```bash
npm create tauri-app@latest
```
Jawab:
- Project name: `anchoa-app`
- Identifier: format domain terbalik, mis. `dev.rip.anchoa`
- Frontend language: **TypeScript / JavaScript**
- Package manager: **npm**
- UI template: **Svelte**
- UI flavor: **TypeScript**

Coba jalankan template bawaannya (build Rust pertama butuh beberapa menit):
```bash
cd anchoa-app
npm install
npm run tauri dev
```

> **Jendela kosong/putih?** (umum di Linux + GPU NVIDIA) Coba untuk dev lokal:
> `WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`
> Kalau laptopmu hybrid (Intel + NVIDIA), uji juga dengan GPU NVIDIA:
> `__NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia npm run tauri dev`
> Panduan lengkap: https://v2.tauri.app/develop/debug/linux-graphics/

## Langkah 4 — Masukkan paket ini ke proyek

Salin **isi** folder paket ini ke dalam folder `anchoa-app/` (gabungkan dengan yang sudah ada):
```
anchoa-app/
├─ CLAUDE.md
├─ .claude/commands/…
├─ docs/…
└─ static/live2d/…
```
Tambahkan isi `gitignore-tambahan.txt` ke `.gitignore`, lalu:
```bash
git init   # jika belum
git add -A && git commit -m "chore: scaffold Tauri + SvelteKit dan bekal desain"
```
Tambahkan juga `.env.local` ke `.gitignore` (sudah ada di `gitignore-tambahan.txt`).

```bash
# nanti di Fase 3: isi dari `supabase status` di repo anchoa-supabase
cat > .env.local <<ENV
PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
PUBLIC_SUPABASE_ANON_KEY=<anon key dari supabase status>
ENV
```

## Langkah 5 — Live2D (untuk Fase 0)

1. Unduh **Cubism SDK for Web** dari https://www.live2d.com/en/sdk/download/web/ (harus menyetujui lisensinya).
2. Salin `live2dcubismcore.min.js` (biasanya di folder `Core/`) ke `static/live2d/core/`.
3. Salin satu model contoh (biasanya di `Samples/Resources/`) ke `static/live2d/models/<nama-model>/`. Model contoh punya syarat pemakaiannya sendiri — pakai untuk uji coba saja.

Cubism Core bersifat proprietary: **jangan di-commit ke repo publik** (sudah diatur lewat `.gitignore`).

## Langkah 6 — Screenshot desain

Dari canvas desain, ekspor gambar setiap artboard (Share › Export) ke `docs/design/screenshots/` dengan nama sesuai artboard: `Main.png`, `Jurnal.png`, `Email.png`, `Jadwal.png`, `Habit.png`, `Keuangan.png`, `Proyek.png`, `Berkas.png`, `Unduhan.png`, `Profil.png`, `Pengaturan.png`, `PengaturanAvatar.png`, `PengaturanSinkron.png`, `Login.png`, `Onboarding.png`, semua layar HP (`HpMasuk.png` … `HpProfil.png`, 19 berkas, daftar lengkap di `docs/design/screenshots/BACA-SAYA.txt`), `State.png`, `ProyekAgen.png`, `ProyekAgenHubungkan.png`, `Loading.png`, `CommandPalette.png`, `NotifPanel.png`, `Palet.png`. Canvas-nya dibagi **satu halaman per menu** (pilih halaman di kiri atas), jadi setiap artboard termuat penuh sebelum diekspor.

## Langkah 7 — Jalankan Claude Code

Pasang Claude Code jika belum (ikuti https://docs.claude.com → Claude Code → Setup), lalu:
```bash
cd anchoa-app
claude
```
Tempel **Pesan pertama** dari `docs/PROMPTS.md`, lalu lanjut `/fase 0`.

Aturan main yang disarankan:
- Satu fase per sesi, **plan mode** (Shift+Tab) di awal, `/clear` di antara fase, commit setelah fase lolos.
- Fase 0 adalah **gerbang keputusan**: kalau Live2D di Tauri tidak mulus di Linux/Android, putuskan rencana cadangan dulu sebelum lanjut.

## Urutan dengan repo Supabase

- Fase 0–2 di repo ini **tidak butuh** Supabase (pakai data mock).
- Sebelum Fase 3: selesaikan Fase A–B di `anchoa-supabase`, nyalakan `supabase start`, isi `.env.local`, lalu `npm run gen:types`.
