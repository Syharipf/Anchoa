# Anchoa Profil: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Implementasi utama oleh Codex gpt-6.1-sol xhigh. Kalau kuotanya habis, pakai Gemini 3.8 Flash High lewat `agy-multi`. Review oleh Gemini dan Sol, lalu dicek sesi Opus.

**Goal:** Halaman Profil sesuai artboard, berisi:
- kartu profil dengan nama dan statistik;
- sakelar notifikasi per jenis pengingat yang memengaruhi panel dan badge;
- akun terhubung.

**Spec:** `docs/superpowers/specs/2026-10-01-anchoa-profil-design.md` (R1–R6).

## Global Constraints

- Semua aturan di `CLAUDE.md` berlaku: SonarCloud, tanpa dependency baru, tanpa panic, `src/api.ts` sebagai satu-satunya pemanggil `invoke()`, dan setiap query menyaring baris terhapus.
- Nilai di tabel `settings` disimpan sebagai teks: `"1"` atau `"0"` untuk sakelar.
- Nama rilis: "Anchoa v0.12.0 — Profil".

## Pembagian PR

| PR | Task |
|---|---|
| R-1 (#100) | 1 |
| R-2 (#101) | 2–3 |

---

### Task 1: `profile.rs`

**Antarmuka:** spec §3.
- Streak habit memakai fungsi di `habits.rs` yang sudah ada (`current_streak` atau ringkasan `habits_overview`). Jangan menulis ulang aturan streak.
- Command `get_profile`, `set_profile_name`, `get_notify_prefs`, `set_notify_prefs`, didaftarkan di `lib.rs`. Wrapper dan tipe di `src/api.ts`: `Profile`, `ProfileStats`, `NotifyPrefs`.

**Test:**
- `profile_counts_done_tasks_journal_and_notes`;
- `profile_since_is_the_oldest_item`;
- `set_name_trims_and_limits`;
- `notify_prefs_default_on_and_round_trip`.

**Commit:** `feat: add the profile backend`.
**Penutup PR R-1:** `cargo test`, clippy, `bun run typecheck`, `bun run test`, dan E2E penuh `PASS`.

---

### Task 2: Halaman Profil dan filter pengingat

**Files:**
- `src/profile/ProfilePage.tsx` dan komponen kartunya;
- `src/profile/view.ts` dengan `view.test.ts`;
- `src/notifications/reminders.ts` dengan test-nya;
- `App.tsx`, `src/shell/nav.ts` (hapus `about` dari `profil`);
- Dashboard: sapaan memakai nama, kalau sudah ada sapaan bernama (R6).

**Perilaku:** spec §2 dan §4. Tata letak dan warna mengikuti `docs/design/artboards/Profil.dc.html`. Terjemahkan ke React dan Tailwind dengan token di `src/index.css` saja, tanpa warna arbitrer `[#…]`, dan jangan salin sintaks alat desain.

**Test:**
- `reminders` dengan setiap jenis dimatikan;
- `reminderCount` ikut berubah;
- inisial nama;
- format "sejak".

**Commit:** `feat: add the profile page and notification switches`.

### Task 3: E2E, versi 0.12.0 (sesi Opus)

- `check_profile` sesuai spec §5.
- Versi 0.12.0.
- Status di `CLAUDE.md`.

**Commit:** `test: cover the profile page end to end; bump version to 0.12.0`.

## Menjalankan task

- **Sol:** `codex exec -m gpt-6.1-sol -c model_reasoning_effort=xhigh -s workspace-write -C <worktree> "<task>" < /dev/null`. Sandbox Sol tidak bisa commit, jadi sesi Opus yang commit.
- **Gemini:** `agy-multi --model gemini-3.8-flash-high --dangerously-skip-permissions -p "<task>" < /dev/null`.
