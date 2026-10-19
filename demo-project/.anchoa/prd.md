# PRD & Arsitektur: Autentikasi Biometrik & Multi-Factor Desktop

## 1. Sasaran Produk & Ringkasan Fitur
- **Tujuan Utama:** Menyediakan modul otentikasi lokal multi-faktor yang aman, cepat, dan terintegrasi untuk pengguna desktop Linux (Argon2id + PAM / fprintd).
- **Target Pengguna:** Pengguna desktop personal Anchoa yang menghendaki perlindungan berkas dan data rahasia tanpa server cloud eksternal.
- **Ruang Lingkup:**
  - Login PIN 6 digit dengan proteksi brute-force.
  - Opsi sidik jari biometrik via D-Bus fprintd service.
  - Sesi memori terisolasi dengan kunci dekripsi zeroize saat dikunci.

## 2. Tech Stack & Dependensi Fullstack
- **Frontend Client:** React 19 + TypeScript + Tailwind CSS (Vite)
- **Backend Core:** Tauri 2 (Rust) + Tokio async runtime
- **Database:** SQLite (rusqlite) dengan WAL mode, FTS5, dan enkripsi lokal
- **Keamanan & Kriptografi:** Argon2id key derivation, zeroize memory guard, strict CSP
- **Infrastruktur & Komunikasi:** Tauri IPC commands, stdio PTY stream, Linux D-Bus

## 3. Arsitektur Sistem & Model Data
- **Skema SQLite:**
  ```sql
  CREATE TABLE security_keys (
    id TEXT PRIMARY KEY,
    salt BLOB NOT NULL,
    hash BLOB NOT NULL,
    iterations INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE security_attempts (
    id TEXT PRIMARY KEY,
    failed_count INTEGER NOT NULL DEFAULT 0,
    cooldown_until INTEGER,
    last_attempt_at INTEGER NOT NULL
  );
  ```
- **Aliran Data (Data Flow):**
  1. Input pengguna di modal React `PinDialog.tsx`.
  2. Dipassing ke Rust backend via Tauri command `api.verifyPin(pin)`.
  3. Rust memeriksa limit di `security_attempts`.
  4. Komparasi hash Argon2id constant-time.
  5. Jika valid: simpan state session token terdekripsi di memori dan kirim event ke frontend.

## 4. Kontrak API / Rust Commands
- `security_status() -> Result<SecurityStatus, AppError>`
- `security_verify_pin(pin: String) -> Result<SessionGrant, AppError>`
- `security_cooldown_remaining() -> Result<Option<u64>, AppError>`

## 5. Alur & Logika Proses Bisnis
1. Aplikasi terbuka dalam status lock screen (startup guard).
2. Pengguna memasukkan PIN 6 digit.
3. Sistem memvalidasi kuota percobaan:
   - Jika salah 5x berturut-turut: kunci input selama 30 detik (cooldown).
   - Jika benar: reset counter kegagalan, buka workspace studio.

## 6. Kriteria Selesai & Pengujian
- [x] Skema database dan tabel `security_keys` tersimpan.
- [x] Hashing Argon2id teruji tanpa kebocoran memori.
- [x] Rate limiting cooldown 30 detik teruji via cargo test.
- [ ] Integrasi UI modal dialog konfirmasi PIN di frontend.
