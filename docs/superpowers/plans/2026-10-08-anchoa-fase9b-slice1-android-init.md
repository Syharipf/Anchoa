# Anchoa Fase 9b Slice 1: Inisialisasi Android & Isolasi Backend Rust

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyiapkan konfigurasi Tauri 2 Android, mengisolasi dependensi dan API desktop-only di Rust (`src-tauri`), menyediakan helper deteksi platform di frontend, serta membuat pipeline CI GitHub Actions untuk memvalidasi kompilasi APK Android.

**Architecture:**
- Backend Rust memakai conditional compilation `#[cfg(desktop)]` dan `#[cfg(target_os = "android")]`.
- Fitur desktop-only (single-instance plugin, sistem tray, Piper/whisper lokal, SecretService Linux keyring) tidak di-compile di Android.
- Frontend React mengekspor `isMobile()` / `usePlatform()` dari `src/platform.ts`.
- CI GitHub Actions (`.github/workflows/android-build.yml`) menjalankan build test Android menggunakan Java 17 + Android NDK.

**Spec:** `docs/superpowers/specs/2026-10-08-anchoa-fase9b-android-design.md` (§2 A1–A7, §5 Slice 1).

---

## Global Constraints

1. **Aturan Umum & CI:**
   - Semua tes eksisting desktop (`bun test`, `bun run typecheck`, `cargo test`, `cargo clippy`) harus tetap 100% hijau di Linux.
   - Tidak merusak build desktop RPM atau alur dev lokal.
2. **Tanpa Biner Tambahan di Repo:**
   - Tidak meng-commit file `.apk`, `.so`, atau aset biner besar ke Git.
3. **Rahasia:**
   - Tidak ada token, secret, atau keystore mentah yang di-commit ke Git.

---

## Tasks

### Task 1: Isolasi Fitur Desktop di Rust (`src-tauri`)

- [ ] **Files to modify:**
  - `src-tauri/Cargo.toml`
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/main.rs`
  - `src-tauri/src/keystore.rs`
- [ ] **Steps:**
  1. Batasi dependensi desktop di `Cargo.toml` menggunakan `[target.'cfg(not(target_os = "android"))'.dependencies]`:
     - `tauri-plugin-single-instance`
  2. Di `src-tauri/src/lib.rs`:
     - Bungkus pendaftaran plugin `single_instance` dalam `#[cfg(desktop)]`.
     - Pastikan inisialisasi window/tray hanya berjalan di desktop.
  3. Di `src-tauri/src/keystore.rs`:
     - Berikan implementasi penyimpanan aman cadangan / no-op terkontrol untuk `#[cfg(target_os = "android")]` agar kompilasi Android tidak gagal mencari `keyring` SecretService Linux.
  4. Jalankan `cargo clippy --all-targets -- -D warnings` dan `cargo test` untuk memastikan build desktop tidak regresi.

### Task 2: Konfigurasi Tauri 2 Android & Platform Detection Frontend

- [ ] **Files to modify/create:**
  - `src-tauri/tauri.conf.json`
  - `src/platform.ts`
  - `src/platform.test.ts`
- [ ] **Steps:**
  1. Perbarui `src-tauri/tauri.conf.json` dengan konfigurasi Android package identifier (`io.github.syharipf.anchoa`).
  2. Buat `src/platform.ts`:
     - Ekspor fungsi `isMobile(): boolean` dan hook `useIsMobile(): boolean`.
     - Deteksi runtime Tauri (User Agent / window matchMedia / Tauri internals).
  3. Tulis unit test di `src/platform.test.ts` dengan Bun test runner.
  4. Jalankan `bun test src/platform.test.ts` dan `bun run typecheck`.

### Task 3: Setup CI Workflow Kompilasi Android APK

- [ ] **Files to create:**
  - `.github/workflows/android-build.yml`
- [ ] **Steps:**
  1. Buat workflow GitHub Actions:
     - Trigger: pull request dan push ke branch `feat/*android*` atau `main`.
     - Runner: `ubuntu-latest`.
     - Steps:
       - Checkout repo.
       - Setup Java 17 (Temurin).
       - Setup Android SDK & NDK r26+.
       - Setup Rust + target `aarch64-linux-android`.
       - Setup Bun + install dependencies + build Vite frontend.
       - Jalankan `cargo check --target aarch64-linux-android` di `src-tauri` untuk memastikan kompilasi Android bebas error.
  2. Verifikasi sintaks workflow YAML.

### Task 4: Verifikasi & Review

- [ ] Jalankan suite penuh di mesin lokal:
  - `bun run typecheck`
  - `bun run test`
  - `cd src-tauri && cargo test`
  - `cd src-tauri && cargo clippy --all-targets -- -D warnings`
- [ ] Buat branch `feat/android-init-slice1`, commit perubahan, dan buka PR.
