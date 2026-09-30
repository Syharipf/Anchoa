# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Anchoa is an all-in-one personal management desktop app in the style of Notion and Obsidian: finance, projects, tasks, schedule, notes, files, downloads and email, all linked together. It is built in phases, and each phase has its own spec and plan (written in Indonesian):

- Specs: `docs/superpowers/specs/`. The roadmap is in section 13 of `2026-09-29-anchoa-fase1-design.md` (Fase 1: foundation + dashboard).
- Plans: `docs/superpowers/plans/`
- Design: `docs/design/DESIGN.md`, `docs/design/tokens.css`, and one artboard per page in `docs/design/artboards/`. Artboards use design-tool syntax (`{{…}}`, `<sc-for>`, `DCLogic`); translate them to React, never copy them.
- `docs/reference/anchoa-final/` is the original design package, kept for reference. Its SvelteKit + Supabase stack does not apply here. Its `ARCHITECTURE.md` is the starting point for Fase 9 sync.

Status: Fase 1 and redesign D (UI-1 to UI-4) are merged; the v0.1.0 tag and Release are still open (#6). Next is the "UI lanjutan" shell work, then Fase 2 (its draft spec needs rework).

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
- Targets: Fedora Linux now; Windows and Android in Fase 9.

## Architecture rules

Spec sections 4 to 6 have the details.

- Modular monolith: one process, one SQLite DB. Do not split into services.
- The frontend never touches the DB. Every action is a Rust command, and `src/api.ts` is the only caller of `invoke()`. The future AI assistant (Fase 5) calls the same commands.
- Everything is an item: each thing is one row in `items`. Module-specific fields go in an extension table keyed by `item_id`.
- IDs are UUIDv7. Timestamps are epoch ms UTC. Deletes are soft (`deleted_at`), and every query must filter out deleted rows. Store money as integer minor units, never as float. These choices keep future multi-device sync possible without a big migration.
- Compute day boundaries ("today", "overdue") in Rust, in local time.
- Commands return `Result<T, AppError>`. Do not panic on user-triggered paths. Never create a fresh DB over one that failed to open.

## SonarCloud conventions

SonarCloud analyses every PR, and its quality gate fails on any new security finding. To keep it green:

- Wrap React component props in `Readonly<...>`.
- Do not use `Math.random()`; use a counter for local IDs.
- Use `[[ ... ]]` instead of `[ ... ]` in bash scripts.

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
6. Merge only when the user says so, with `gh pr merge --squash --delete-branch`.
7. At the end of a phase, tag the release (`v0.1.0` for Fase 1) and attach the RPM to a GitHub Release.

Do not start implementing a phase until the user approves moving from planning to code.

### Model per step

- Planning (brainstorm, spec, plan): Opus 5.5 at high effort, in the main session, with the `superpowers:brainstorming` and `superpowers:writing-plans` skills. Execute plans with `superpowers:subagent-driven-development`, and close each PR with `superpowers:verification-before-completion` and `superpowers:finishing-a-development-branch`. Use any other listed skill that fits the task.
- Implementation: Sonnet at high effort, through the `implementer` agent (`.claude/agents/implementer.md`), one plan task per run. The Opus session checks each result.
- Review: Gemini 3.8 Flash High through the Antigravity CLI (`agy`), read-only:

  ```bash
  git diff main...HEAD > .git/review.diff
  agy --model gemini-3.8-flash-high --mode plan --print-timeout 600s -p "Rules: do not run shell commands, do not open URLs, and read only files inside this repository with your built-in file viewing tool. Task: review the diff in .git/review.diff against CLAUDE.md and the spec for this PR. Open changed files for context. Report bugs, security issues and spec mismatches, one per line as path:line: problem. Say NONE if clean."
  ```

  Put `--model` before `-p`, because `-p` takes the next argument as the prompt. Headless `agy` ignores stdin, so give it the diff as a file inside the repo. It denies any tool call that needs a permission prompt (shell commands outside its allow-list, URLs, files outside the repo), and one denial ends the run with `jetski: no output produced`. The rules at the start of the prompt prevent that; if it still happens, run it once more. Check every finding before fixing it: Gemini also reports false positives.
- Fallback, only when needed: Opus at medium effort. Use the `reviewer-opus` agent when `agy` fails (not installed, auth, quota, timeout, or no output after a retry). Use Opus instead of `implementer` only when a task fails twice with Sonnet.

## GUI testing

- Run the app on a separate Xvfb display (for example `:99`) and drive it with xdotool and screenshots.
- Never send synthetic input to the user's `:0` display.
- Check results in the DB on disk as well as on screen.
- Hand the user only the checks that cannot be automated, such as real-GPU rendering. Xvfb uses software GL, so FPS measured there means nothing.
