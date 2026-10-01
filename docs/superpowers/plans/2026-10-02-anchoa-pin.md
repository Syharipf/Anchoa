# Anchoa Kunci PIN: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Implementasi utama oleh Codex gpt-6.1-sol xhigh. Kalau kuotanya habis, pakai Gemini 3.8 Flash High lewat `agy-multi`. Review oleh Gemini dan Sol, lalu dicek sesi Opus.

**Goal:** Kunci PIN saat app dibuka, dengan hash Argon2id dan penegakan di Rust.

**Spec:** `docs/superpowers/specs/2026-10-02-anchoa-pin-design.md` (K1–K8).

## Global Constraints

- Semua aturan di `CLAUDE.md` berlaku.
- Dependency baru: `argon2` (RustCrypto) saja. Sebutkan di body PR.
- PIN mentah tidak pernah disimpan, di-log, atau dikirim balik ke frontend.
- Nama rilis: "Anchoa v0.15.0 — Kunci PIN".

| PR | Task |
|---|---|
| K-1 (#112) | 1 |
| K-2 (#113) | 2–3 |

### Task 1: `security.rs` dan guard

- `security.rs`:
  - `hash_pin`, `verify_pin` (Argon2id, PHC string);
  - `validate_pin` (4–8 digit);
  - `SecurityState { locked: Mutex<bool>, failures: Mutex<(u32, Option<Instant>)> }`, diisi dari tabel `settings` saat setup.
- Command: `security_status`, `unlock(pin)`, `set_pin(old: Option<String>, new)`, `disable_pin(pin)`.
- Guard di `lib.rs`: bungkus handler `generate_handler!`. Selama terkunci, command di luar daftar izin (`security_status`, `unlock`, `app_status`, dan yang dibutuhkan layar kunci) ditolak dengan pesan "Anchoa terkunci". CLI tidak terpengaruh.
- Wrapper `src/api.ts`.

**Test:**
- `pin_hash_verifies_and_rejects_wrong_pin`;
- `invalid_pins_are_rejected`;
- `set_pin_requires_old_pin_when_enabled`;
- `disable_requires_correct_pin`;
- `five_failures_start_a_cooldown`;
- `guard_allows_only_listed_commands_while_locked` (fungsi murni `is_allowed_while_locked`).

**Commit:** `feat: add the PIN lock backend`.

### Task 2: Layar kunci dan Profil › Keamanan

- `src/security/LockScreen.tsx`. `App.tsx` memanggil `securityStatus()` saat start. Selama `locked`, hanya layar kunci yang dirender, dan setelah `unlock` app dimuat seperti biasa.
- Profil › Keamanan sesuai spec K7: dialog Buat PIN, Ganti PIN, dan Matikan.
- Hanya token tema. Aturan SonarCloud. Bagian bersama tidak boleh duplikat.

**Test:** layar kunci (benar, salah, jeda) dan alur sakelar.
**Commit:** `feat: add the lock screen and PIN settings`.

### Task 3: E2E dan versi 0.15.0 (sesi Opus)

- `check_pin` sesuai spec §3.
- Versi 0.15.0 dan status di `CLAUDE.md`.

**Commit:** `test: cover the PIN lock end to end; bump version to 0.15.0`.
