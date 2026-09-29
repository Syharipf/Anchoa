# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Anchoa is an all-in-one personal management desktop app in the style of Notion and Obsidian: finance, projects, tasks and notes, all linked together. It is built in phases, and each phase has its own spec and plan (written in Indonesian):

- Specs: `docs/superpowers/specs/`. The current one is `2026-09-29-anchoa-fase1-design.md` (Fase 1: foundation + dashboard). The roadmap is in its section 13.
- Plans: `docs/superpowers/plans/`

Status: Fase 1 is being implemented PR by PR; see the plan in `docs/superpowers/plans/`.

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
- Targets: Fedora Linux now; Windows and Android in Fase 6.

## Architecture rules

Spec sections 4 to 6 have the details.

- Modular monolith: one process, one SQLite DB. Do not split into services.
- The frontend never touches the DB. Every action is a Rust command, and `src/api.ts` is the only caller of `invoke()`. The future AI assistant (Fase 5) calls the same commands.
- Everything is an item: each thing is one row in `items`. Module-specific fields go in an extension table keyed by `item_id`.
- IDs are UUIDv7. Timestamps are epoch ms UTC. Deletes are soft (`deleted_at`), and every query must filter out deleted rows. Store money as integer minor units, never as float. These choices keep future multi-device sync possible without a big migration.
- Compute day boundaries ("today", "overdue") in Rust, in local time.
- Commands return `Result<T, AppError>`. Do not panic on user-triggered paths. Never create a fresh DB over one that failed to open.

## Linux GPU quirk

On the dev laptop, NVIDIA is the X `PrimaryGPU`, and Intel is also present.

- WebKitGTK logs `Failed to create GBM buffer ... Invalid argument` and renders nothing unless `WEBKIT_WEB_RENDER_DEVICE_FILE` points at a non-NVIDIA render node. The app sets this at the top of `main()` (spec section 8).
- Under the `power-saver` power profile, WebKit caps `requestAnimationFrame` at about 30 FPS. This is expected behaviour, not a bug.

## Workflow (agreed with the user)

1. Each phase is planned per PR in `docs/superpowers/plans/`. Each PR has a GitHub Issue in that phase's milestone.
2. Create a branch `feat/<issue>-<slug>` from `main`. Never push to `main` directly: it is protected and requires a PR plus green CI.
3. Use TDD. Make small commits in Conventional Commits format.
4. Before opening a PR, run the full check suite and the Xvfb UI check. Put the evidence (test output, screenshots) in the PR body, together with `Closes #N`.
5. Review the diff yourself and fix what you find. Then hand the PR to the user.
6. Merge only when the user says so, with `gh pr merge --squash --delete-branch`.
7. At the end of a phase, tag the release (`v0.1.0` for Fase 1) and attach the RPM to a GitHub Release.

Do not start implementing a phase until the user approves moving from planning to code.

## GUI testing

- Run the app on a separate Xvfb display (for example `:99`) and drive it with xdotool and screenshots.
- Never send synthetic input to the user's `:0` display.
- Check results in the DB on disk as well as on screen.
- Hand the user only the checks that cannot be automated, such as real-GPU rendering. Xvfb uses software GL, so FPS measured there means nothing.
