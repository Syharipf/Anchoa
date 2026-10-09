## Roles & skills — wajib setiap sesi

1. **Pakai model role yang sudah dikonfigurasi** di `~/.omp/agent/config.yml` (`modelRoles`: plan, task, advisor, commit, smol, slow, default, Reviewer). Saat spawn subagent, selalu set `model` selector sesuai role (`@plan`, `@task`, `@advisor`, `@smol`, `@slow`) — bukan selalu `default`.
2. **Pakai skill yang relevan.** Sebelum kerja, cek skill yang tersedia (superpowers: brainstorming, systematic-debugging, test-driven-development, writing-plans, executing-plans, requesting-code-review, verification-before-completion, dll). Skill wajib di-invoke sebelum jawaban pertama di sesi.
3. **Delegation default.** Multi-file / refactor / fitur / investigasi wajib dipecah ke subagent `task` (1 batch paralel), bukan dikerjakan sendiri di thread utama. Thread utama cukup untuk: edit 1 file < 30 baris, jawab pertanyaan tanpa ubah kode, atau perintah CLI eksplisit dari user.
4. **Setiap pekerjaan > 3 langkah pakai `todo`** (plan → task → advisor). Track per fase: Audit/ingest → Implementasi → Verifikasi & review.
5. **Uji setiap perubahan.** Setelah edit, jalankan test yang menyentuh file itu (`bun test src/<module>` atau `bun test src/pet src/brand ...`) sebelum lanjut. Jangan hanya percaya `bun run test` global — `bun test src` di bun 1.4.2 hanya scan file `*.test.*` di depth 1 dari `src/`; test di subfolder baru perlu dipanggil eksplisit atau ditaruh di folder yang sudah ter-scan.

**Catatan sesi cloud Claude Code:** di sesi cloud `~/.omp/agent/config.yml` tidak ada, jadi role → model dipetakan lewat frontmatter `model:` di `.claude/agents/`: `implementer` = sonnet, `reviewer-opus` = opus, `helper-haiku` = haiku (untuk pekerjaan kecil yang mekanis). Perencanaan dikerjakan di thread utama (Opus).

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Anchoa is an all-in-one personal management desktop app in the style of Notion and Obsidian: finance, projects, tasks, schedule, notes, files, downloads and email, all linked together. It is built in phases, and each phase has its own spec and plan (written in Indonesian):

- Specs: `docs/superpowers/specs/`. The roadmap is in section 13 of `2026-09-29-anchoa-fase1-design.md` (Fase 1: foundation + dashboard).
- Plans: `docs/superpowers/plans/`
- Design: `docs/design/DESIGN.md`, `docs/design/tokens.css`, and one artboard per page in `docs/design/artboards/`. Artboards use design-tool syntax (`{{…}}`, `<sc-for>`, `DCLogic`); translate them to React, never copy them.
- `docs/reference/anchoa-final/` is the original design package, kept for reference. Its SvelteKit + Supabase stack does not apply here. Its `ARCHITECTURE.md` is the starting point for Fase 9 sync.

Status: PIN lock built (spec `2026-10-02-anchoa-pin-design.md`, Argon2id, enforced in Rust; DB encryption later). Fase 5 assistant is built (local brain on Ollama, approval-gated tools, chat, whisper.cpp + Piper voice). Avatar stays static until the Live2D licence check. Fase 8 email is built: Gmail App Password connection, three-column inbox, compose/reply, connection status in Integrasi and Profil, and a local-only email assistant (summary, reply suggestions, approval-gated task proposal). Fase 9a sync is built: encrypted end-to-end sync to Supabase via OAuth (Google/GitHub), XChaCha20-Poly1305, passphrase vault with recovery key, background schedule, and Sync UI in Pengaturan and Profil.

## Commands

- `bun install`: install JS dependencies.
- `bun tauri dev`: run the app with hot reload.
- `bun run typecheck`: TypeScript check.
- `bun run test`: frontend unit tests (`bun test` with `TZ=Asia/Jakarta`). Run one file with `TZ=Asia/Jakarta bun test src/format.test.ts`.
- `cd src-tauri && cargo test`: backend tests. Run one test with `cargo test gpu::tests::leaves_nvidia_only_machines_alone`.
- `cd src-tauri && cargo clippy --all-targets -- -D warnings`: lint (CI fails on any warning).
- `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`: end-to-end check on Xvfb. Screenshots go to `~/.cache/anchoa-e2e/`.
- `bun tauri build`: release RPM in `src-tauri/target/release/bundle/rpm/`.

## Stack

- Backend: Tauri 2 in Rust, under `src-tauri/`.
- Frontend: React + TypeScript + Vite + Tailwind, under `src/`.
- Database: SQLite via `rusqlite`.
- JS tooling: bun. On the dev machine `node` is a shim for bun.
- Targets: Fedora and Arch Linux/CachyOS now; Windows and Android in Fase 9.

## Architecture rules

Spec sections 4 to 6 have the details.

- Modular monolith: one process, one SQLite DB. Do not split into services.
- The frontend never touches the DB. Every action is a Rust command, and `src/api.ts` is the only caller of `invoke()`. The future AI assistant (Fase 5) calls the same commands.
- Everything is an item: each thing is one row in `items`. Module-specific fields go in an extension table keyed by `item_id`.
- IDs are UUIDv7. Timestamps are epoch ms UTC. Deletes are soft (`deleted_at`), and every query must filter out deleted rows. Store money as integer minor units, never as float. These choices keep future multi-device sync possible without a big migration.
- Compute day boundaries ("today", "overdue") in Rust, in local time.
- Commands return `Result<T, AppError>`. Do not panic on user-triggered paths. Never create a fresh DB over one that failed to open.

## SonarCloud conventions

SonarCloud analyses every PR, and its quality gate fails on any new security finding or bug. To keep it green:

- Wrap React component props in `Readonly<...>`.
- Do not use `Math.random()`; use a counter for local IDs.
- Use `[[ ... ]]` instead of `[ ... ]` in bash scripts.
- An element with `onClick` that is not a native button or link also needs a keyboard handler (rule S1082). Sonar counts a missing one as a bug, and one bug fails the gate on reliability.

## Linux GPU quirk

On the dev laptop, NVIDIA is the X `PrimaryGPU`, and Intel is also present.

- WebKitGTK logs `Failed to create GBM buffer ... Invalid argument` and renders nothing unless `WEBKIT_WEB_RENDER_DEVICE_FILE` points at a non-NVIDIA render node. The app sets this at the top of `main()` (spec section 8).
- Under the `power-saver` power profile, WebKit caps `requestAnimationFrame` at about 30 FPS. This is expected behaviour, not a bug.

## Workflow (agreed with the user)

1. Each phase is planned per PR in `docs/superpowers/plans/`. Each PR has a GitHub Issue in that phase's milestone.
2. Create a branch `feat/<issue>-<slug>` from `main`. Never push to `main` directly: it is protected and requires a PR plus green CI.
3. Use TDD. Make small commits in Conventional Commits format.
4. Before opening a PR, run the full check suite and the Xvfb UI check. Put the evidence (test output, screenshots) in the PR body, together with `Closes #N`.
5. Run the review (see below), verify each finding, and fix the real ones. Then hand the PR to the user.
6. Merge once every check is green (tests, clippy, E2E, review, CI, SonarCloud); the user approved this on 2026-10-01. Use `gh pr merge --squash --delete-branch`, or the GitHub merge API when the branch is checked out in another worktree.
7. Releases are automatic. A PR to `main` that bumps the version in `src-tauri/tauri.conf.json` triggers `.github/workflows/release.yml` once merged: it builds the RPM (Fedora container) and the Arch package (Arch container), creates the GitHub Release `v<version>` with both attached, then dispatches `dnf-repo.yml` and `android-release.yml`. It also pushes `anchoa-bin` to the AUR, but only if the `AUR_SSH_PRIVATE_KEY` secret exists. `dnf-repo.yml` signs the RPMs of the last 5 releases and publishes the dnf repo (`packaging/anchoa.repo`), the signed pacman repo (`https://syharipf.github.io/Anchoa/arch/$arch`, repo name `anchoa`, same GPG key) and the landing page from `landing/` (Astro; a push to `main` that changes `landing/**` also redeploys) on GitHub Pages. It needs the `RPM_GPG_PRIVATE_KEY` secret. Tag a phase release (`v0.1.0` for Fase 1) by bumping the version in the same way.

Do not start implementing a phase until the user approves moving from planning to code.

## Reporting to Anchoa

When a task belongs to an agent project in Anchoa, report through the CLI in the app binary (`anchoa agent …`, or `"$ANCHOA_CLI" agent …` inside a run that Anchoa started). Each command prints one JSON line; errors exit with code 2.

- Find work with `anchoa agent projects` and `anchoa agent inbox [--project ID]`. When Anchoa starts the run, the task id is `$ANCHOA_TASK`.
- Log the start and the end of each task: `anchoa agent log --task ID --actor <name> --role implement --body "…"`.
- Save plans with `anchoa agent plan --task ID --actor <name> --file plan.md`. The plan also becomes a Catatan page under "Rencana <project>".
- Move the card as work progresses: `anchoa agent task status --task ID doing|test|review|done --actor <name>`. Status changes are logged automatically.
- MANDATORY AUTO-STEP: Setiap menyelesaikan PR / rilis, jangan tunggu user meminta. Wajib otomatis:
  1. Log review findings: `anchoa agent log --task ID --actor Claude --role review --body "..."`
  2. Log PR link: `anchoa agent log --task ID --actor Claude --role merge --kind link --body "https://github.com/..."`
  3. Pindahkan status task ke `done`: `anchoa agent task status --task ID done --actor Claude`
  4. Lapor ringkasan dan status kartu ke user.
- Never send file contents, secrets, or `.env` values to Anchoa.

## GUI testing

- Run the app on a separate Xvfb display (for example `:99`) and drive it with xdotool and screenshots.
- Never send synthetic input to the user's `:0` display.
- Check results in the DB on disk as well as on screen.
- Hand the user only the checks that cannot be automated, such as real-GPU rendering. Xvfb uses software GL, so FPS measured there means nothing.
