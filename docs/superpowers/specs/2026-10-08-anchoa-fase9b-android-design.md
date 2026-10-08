# Anchoa Fase 9b — Port Android & Rilis Mobile

Tanggal: 2026-10-08  
Status: Draf Usulan Rencana (menunggu konfirmasi user)  
Acuan Desain: `docs/design/DESIGN.md` §3 & 19 Artboard `Hp*.dc.html` di `docs/design/artboards/`  
Prasyarat: Fase 9a (Sync Supabase E2E Encrypted) selesai di v0.31.0+

---

## 1. Ringkasan

Fase 9b membawa Anchoa ke platform Android sebagai aplikasi mobile native berbasis **Tauri 2 + Rust + React + SQLite**.

Prinsip inti:
- **Satu Codebase (Monorepo):** Frontend React dan logika backend Rust berada di repo yang sama dengan desktop.
- **Local-First Penuh:** SQLite lokal tetap menjadi sumber kebenaran offline di perangkat, dengan sync terenkripsi multi-device via Supabase (Fase 9a).
- **UI Spesifik Mobile:** Navigasi desktop (rail 72px) diganti dengan **Dok Ringkas + Roda Menu HP** (`DESIGN.md` §3) dan 19 tampilan layar mobile yang diadaptasi dari artboard `Hp*`.
- **Rilis Otomatis:** Pipeline CI GitHub Actions mem-build APK (`Anchoa-vX.Y.Z.apk`) dan menyematkannya ke GitHub Release bersamaan dengan build `.rpm` desktop.

---

## 2. Keputusan Arsitektur

| Kode | Keputusan | Alasan |
|---|---|---|
| **A1** | **Tauri 2 Mobile (Single Codebase).** Struktur proyek diinisialisasi dengan `bun tauri android init` menghasilkan folder `src-tauri/gen/android`. | Menghindari duplikasi logika bisnis, model SQLite, dan kriptografi E2E yang sudah matang di Rust. |
| **A2** | **SQLite via Android NDK.** `rusqlite` dikompilasi untuk target Android (`aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android`). Jalur DB disimpan di `app_data_dir()` Android internal storage (`/data/user/0/...`). | Menjamin 100% kompatibilitas skema SQLite dan trigger sync outbox tanpa migrasi ulang. |
| **A3** | **Penyimpanan Rahasia (Keyring vs Keystore).** Di Android, crate/plugin keyring diganti dengan penyimpanan aman via Android Keystore / EncryptedSharedPreferences untuk token sesi dan kunci enkripsi (DEK). | Linux SecretService tidak tersedia di Android runtime. |
| **A4** | **Deteksi Platform & Shell UI Adaptif.** Frontend mendeteksi platform lewat Tauri API (`@tauri-apps/plugin-os`) atau responsif viewport: desktop memakai `Sidebar.tsx`, Android memakai komponen `MobileDock.tsx` dan `MobileWheelNav.tsx`. | Mengikuti spesifikasi artboard `Hp*` tanpa merusak pengalaman desktop 1280×800. |
| **A5** | **AI & Voice di Mobile.** Piper (TTS) dan whisper.cpp (STT) lokal dimatikan di mobile demi baterai & memori. Di Android, STT/TTS memakai Cloud API penyedia (OpenAI/Groq/Gemini) atau web speech API bawaan Android WebView. Kata pemanggil "Hai Anchoa" dimatikan default di Android (`DESIGN.md` §3). | Model lokal 500MB+ dan komputasi float intensif membuat HP panas dan baterai cepat habis. |
| **A6** | **Unduhan di Mobile.** Torrent (`librqbit`) dinonaktifkan di Android. Unduhan file langsung via `reqwest` Rust tetap jalan. Media download memakai link langsung / plugin tanpa sidecar biner desktop yt-dlp/ffmpeg. | Keterbatasan arsitektur sandbox Android dan ukuran APK. |
| **A7** | **Build & Signing CI di GitHub Actions.** Build APK dijalankan di GitHub Actions runner `ubuntu-latest` (dengan Java 17 + Android NDK bawaan). Keystore release disimpan di GitHub Secrets (`ANDROID_KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, dll.). | Mengatasi ketiadaan toolchain Android (JDK, NDK, rustup android target) di mesin dev Fedora lokal. |

---

## 3. Desain Navigasi & Tampilan Mobile

Sesuai `docs/design/DESIGN.md` §3:

### 3.1 Dok + Roda Menu (Nav Bawah)
- **11 Layar Utama:** Memakai dok bawah setinggi ±100px.
  - Tombol **Cari** (52px, kiri) → menuju `HpCari`.
  - Tombol **Menu Utama** (60px, tengah): Menampilkan ikon halaman aktif, label kecil di bawah, dan cincin kawanan teri (22 ekor) di sekelilingnya.
  - Tombol **Mikrofon** (52px lime, kanan) → menuju `HpAsisten`.
  - Konten halaman diberi `padding-bottom: 120px` dengan gradasi pudar 136px di belakang dok.
- **Roda Terbuka (Tap Menu Utama):**
  - Scrim gelap (`rgba(5,7,10,0.76)`) menutup layar.
  - Roda menu muncul dari pusat (195, 780), radius 112px, menampilkan 11 item menu (5 item terlihat dalam rentang ±72° dari puncak).
  - Tombol tengah berubah jadi **×** (tutup); tombol kiri/kanan berubah jadi navigasi rotasi **‹ ›** (44px).
  - Gestur geser horizontal memutar roda (0.6° per px) dengan snap animasi `cubic-bezier(.2,.8,.2,1)`.
  - Tombol Back Android atau tap scrim menutup roda kembali ke halaman aktif.
- **8 Layar Detail (Tanpa Dok Bawah):**
  - `HpAsisten`, `HpEmailBaca`, `HpPengaturanAI`, `HpProfil`, `HpNotif`, `HpCari`, `HpMasuk`, dan detail item.
  - Memakai header tombol **Kembali** (`‹`) standar mobile di bagian atas.

### 3.2 19 Layar yang Disediakan
1. `HpBeranda`: Ringkasan harian, kartu asisten, habit, saldo, email baru.
2. `HpBerandaRoda`: Keadaan roda menu terbuka dengan kawanan teri melingkar.
3. `HpCari`: Pencarian global instan FTS5.
4. `HpNotif`: Notifikasi jatuh tempo & pengingat.
5. `HpJurnal`: Catatan cepat, curhat, ide, mood picker mobile.
6. `HpHabit`: Centang habit harian, streak counter.
7. `HpJadwal`: Agenda timeline ringkas untuk layar vertikal.
8. `HpKeuangan`: Saldo akun, transaksi terbaru, tombol catat cepat.
9. `HpProyek`: Daftar proyek & status tugas kolom ringkas.
10. `HpAgen`: Monitoring status agen & riwayat tugas.
11. `HpEmail`: Tampilan inbox mobile satu kolom.
12. `HpEmailBaca`: Pembaca isi email dengan tombol aksi cepat.
13. `HpBerkas`: Penjelajah berkas & dokumen.
14. `HpUnduhan`: Status antrean unduhan.
15. `HpAsisten`: Antarmuka percakapan suara/teks dengan AI.
16. `HpPengaturan`: Daftar preferensi, sinkronisasi, dan akun.
17. `HpPengaturanAI`: Pengaturan API key dan pemilihan model cloud.
18. `HpProfil`: Avatar, statistik, tombol PIN & sesi.
19. `HpMasuk`: Alur login Supabase OAuth (Google/GitHub) via Android Deep Link.

---

## 4. Pipeline Build & Rilis (GitHub Actions)

Karena mesin pengembang saat ini tidak memiliki toolchain Android, build dilakukan via GitHub Actions workflow baru `.github/workflows/android-release.yml`:

```
Tag vX.Y.Z dipush / Release dibuat
       │
       ▼
GitHub Actions (ubuntu-latest)
  ├── 1. Setup Java 17 + Android SDK & NDK 26+
  ├── 2. Setup Rust + target aarch64-linux-android & armv7-linux-androideabi
  ├── 3. Setup Bun + build frontend Vite
  ├── 4. `bun tauri android build --apk`
  ├── 5. Sign APK (apksigner) dengan release keystore
  └── 6. Unggah `Anchoa-vX.Y.Z.apk` ke aset GitHub Release yang sama dengan `.rpm`
```

---

## 5. Rencana Tahapan Eksekusi (Implementation Slices)

Pekerjaan dipecah menjadi 4 sub-fase (PR):

1. **Slice 1: Inisialisasi Android & Isolasi Backend Rust (PR 1)**
   - Jalankan `tauri android init` untuk menghasilkan scaffolding `src-tauri/gen/android`.
   - Pisahkan dependensi desktop vs mobile di `Cargo.toml` (`#[cfg(target_os = "android")]`).
   - Implementasikan storage fallback aman untuk Android Keystore / data directory.
   - Setup GitHub Actions CI smoke build untuk APK.

2. **Slice 2: Komponen Shell Mobile — Dok Bawah & Roda Navigasi (PR 2)**
   - Buat `src/shell/mobile/MobileDock.tsx` dan `src/shell/mobile/MobileWheelNav.tsx`.
   - Implementasikan gestur rotasi sentuh, snap posisi, tombol Back Android, dan animasi teri melingkar.
   - Sambungkan navigasi antar modul ke state routing yang ada.

3. **Slice 3: Adaptasi Tampilan 19 Layar Mobile (PR 3)**
   - Porting artboard `Hp*` ke komponen React yang responsif sesuai data nyata di SQLite.
   - Penyesuaian form, ukuran tombol sentuh (min 48px), dan keyboard handling di HP.

4. **Slice 4: Release Pipeline & Pengujian APK (PR 4)**
   - Konfigurasi signing keystore di GitHub Actions.
   - Build artifact APK rilis otomatis saat tag rilis dibuat.
   - Dokumentasi panduan instalasi `.apk` di `docs/MANUAL.md`.

---

## 6. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Ukuran APK terlalu besar | Lambat diunduh di HP | Pisahkan per-ABI (hanya build `arm64-v8a` untuk device modern, atau universal APK terkompresi). Hindari bundle model lokal di dalam APK. |
| Permission Android (Internet, Storage, Mic) | Crash saat runtime jika ditolak | Definisikan permission eksplisit di `AndroidManifest.xml` dan request secara anggun via plugin Tauri saat fitur dipakai. |
| Deep link OAuth Supabase di Android | Login gagal redirect kembali ke app | Daftarkan intent filter URL scheme `io.github.syharipf.anchoa://auth/callback` di AndroidManifest. |
