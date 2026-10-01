# Anchoa Pengaturan: Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Implementasi utama oleh Codex gpt-6.1-sol xhigh (`codex exec -s workspace-write`). Kalau kuotanya habis, pakai Gemini 3.8 Flash High lewat `agy-multi`. Review oleh Gemini dan Sol, lalu dicek sesi Opus.

**Goal:** Halaman Pengaturan dengan sub-nav enam bagian sesuai artboard, berisi Sinkron & data lokal, Integrasi, dan Tentang (cek pembaruan dan lisensi).

**Spec:** `docs/superpowers/specs/2026-10-01-anchoa-pengaturan-design.md`. Baca seluruhnya (P1–P7).

## Global Constraints

- Semua aturan di `CLAUDE.md` berlaku: aturan SonarCloud, tanpa dependency baru, tanpa panic di path user, dan `src/api.ts` sebagai satu-satunya pemanggil `invoke()`.
- Tidak ada aksi yang menghapus data.
- Cek pembaruan hanya berjalan dari klik.
- Nama rilis: "Anchoa v0.11.0 — Pengaturan".

## Pembagian PR

| PR | Task |
|---|---|
| P-1 (#96) | 1–2 |
| P-2 (#97) | 3–4 |

---

### Task 1: `settings.rs` — ringkasan data

**Antarmuka:** spec §3 (`DataOverview`, `TypeCount`, `BackupFile`, `data_overview`).
- `counts` dihitung dengan `SELECT type, COUNT(*) FROM items WHERE deleted_at IS NULL GROUP BY type ORDER BY 2 DESC, 1`.
- `trashed` adalah jumlah baris dengan `deleted_at IS NOT NULL`.
- `backups`: hanya berkas `*.db` di folder backup, terbaru dulu. Folder yang tidak ada menghasilkan daftar kosong.
- Command `data_overview(app, db)` memakai `app_data_dir` dan `backup_dir(&app)` yang sudah ada di `commands.rs`. Kunci DB dilepas sebelum membaca berkas.

**Test:**
- `overview_counts_live_items_by_type_and_trash`;
- `overview_lists_backups_newest_first`;
- `overview_reports_db_and_wal_size`.

**Commit:** `feat: add the settings data overview`.

### Task 2: cek pembaruan

**Antarmuka:** spec §3 (`UpdateCheck`, `parse_release`, `check_update`, `version_tuple`).
- `parse_release` membaca `tag_name` dan `html_url`.
- `check_update` memakai `ureq` dengan header `User-Agent: anchoa` dan timeout 10 detik. Error jaringan menjadi `AppError::Other("Tidak bisa menghubungi GitHub: …")`.
- Command `check_update(app)`.
- Wrapper di `src/api.ts`: `dataOverview()` dan `checkUpdate()`, beserta tipenya.

**Test:**
- `version_tuple_accepts_v_prefix_and_rejects_garbage`;
- `parse_release_detects_newer_same_and_older`;
- `parse_release_rejects_missing_tag`.

**Commit:** `feat: check GitHub for a newer release`.
**Penutup PR P-1:** `cargo test`, clippy, `bun run typecheck`, `bun run test`, dan E2E penuh `PASS`.

---

### Task 3: UI Pengaturan

**Files:**
- `src/settings/Settings.tsx` (tata letak);
- `SettingsNav.tsx`;
- `ComingSection.tsx` (Asisten & AI, Avatar, Suara);
- `DataSection.tsx`;
- `IntegrationsSection.tsx` (memakai `GithubSection` yang ada);
- `AboutSection.tsx`;
- `view.ts` dengan `view.test.ts`;
- `formatBytes` di `src/format.ts` (beserta test).

**Perilaku:** spec §2 dan §4. Tata letak dan warna mengikuti `docs/design/artboards/Pengaturan.dc.html` dan `PengaturanSinkron.dc.html`. Terjemahkan ke React dan Tailwind; jangan salin sintaks alat desain.
- `App.tsx`: halaman `settings` menerima bagian awal, misalnya `{ name: "settings", section: "about" }`. Tombol "Buka Pengaturan" di ComingSoon membuka bagian yang sesuai, atau `ai` untuk Email/AI.

**Test:**
- label dan urutan bagian;
- status kecil (GitHub terhubung atau belum, versi);
- `formatBytes` (0 B, 1023 B, 1,5 KB, 12,3 MB).

**Commit:** `feat: rebuild the settings page around a section nav`.

### Task 4: E2E, versi 0.11.0 (sesi Opus)

- `check_settings` sesuai spec §5.
- Versi 0.11.0 (`package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`).
- Status di `CLAUDE.md`.

**Commit:** `test: cover the settings page end to end; bump version to 0.11.0`.
**Penutup PR P-2**, lalu rilis.

## Menjalankan task

- **Sol:** `codex exec -m gpt-6.1-sol -c model_reasoning_effort=xhigh -s workspace-write -C <worktree> "<task>" < /dev/null`. Sandbox Sol tidak bisa commit (metadata git berada di luar worktree), jadi sesi Opus yang commit.
- **Gemini:** `agy-multi --model gemini-3.8-flash-high --dangerously-skip-permissions -p "<task>" < /dev/null`.
