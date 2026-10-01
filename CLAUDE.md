# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Anchoa is an all-in-one personal management desktop app in the style of Notion and Obsidian: finance, projects, tasks, schedule, notes, files, downloads and email, all linked together. It is built in phases, and each phase has its own spec and plan (written in Indonesian):

- Specs: `docs/superpowers/specs/`. The roadmap is in section 13 of `2026-09-29-anchoa-fase1-design.md` (Fase 1: foundation + dashboard).
- Plans: `docs/superpowers/plans/`
- Design: `docs/design/DESIGN.md`, `docs/design/tokens.css`, and one artboard per page in `docs/design/artboards/`. Artboards use design-tool syntax (`{{…}}`, `<sc-for>`, `DCLogic`); translate them to React, never copy them.
- `docs/reference/anchoa-final/` is the original design package, kept for reference. Its SvelteKit + Supabase stack does not apply here. Its `ARCHITECTURE.md` is the starting point for Fase 9 sync.

Status: Fase 7 Unduhan built; next phases wait for the user. The old Fase 4 note features (page tree, block editor, wikilinks, FTS5) wait for the user to choose where they live.

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
7. At the end of a phase, tag the release (`v0.1.0` for Fase 1) and attach the RPM to a GitHub Release.

Do not start implementing a phase until the user approves moving from planning to code.

### Model per step

- Planning (brainstorm, spec, plan): Opus 5.5 at high effort, in the main session, with the `superpowers:brainstorming` and `superpowers:writing-plans` skills. Execute plans with `superpowers:subagent-driven-development`, and close each PR with `superpowers:verification-before-completion` and `superpowers:finishing-a-development-branch`. Use any other listed skill that fits the task.
- Implementation: Gemini 3.8 Flash High through `agy-multi` with `--dangerously-skip-permissions`, one plan task per run, to save Claude tokens. Gemini only implements; it does not review. The prompt keeps it inside this repository and forbids push, merge and PRs; the Opus session does those and checks each result (the task's tests and the commit diff). Each plan has the command under "Menjalankan task dengan agy".
- `agy-multi` (`~/.local/bin/agy-multi`) wraps `agy` with the same arguments. Put `--model` before `-p`, because `-p` takes the next argument as the prompt.
  - On a quota error, it repeats the run with the next Google account.
  - When a Gemini model is out of quota on every account, it repeats the run with `claude-opus-4-6-thinking` (Claude Opus 4.6 in Antigravity), again account by account.
  - When that is out everywhere too, it sends the `-p` prompt to `codex exec` without sandbox.
- Review: Codex (Codex CLI, ChatGPT login), read-only, on every PR:

  ```bash
  codex exec -s read-only -C "$PWD" -o ../review.txt "You are reviewing a pull request. Run git diff origin/main...HEAD to see it, and open changed files for context. Project rules are in CLAUDE.md; the spec is <spec path>, and this PR is <PR>. Do not edit files. Report real bugs, security issues and spec mismatches, one per line as path:line: problem. Say NONE if clean."
  ```

  `codex review --base` does not accept custom instructions, so use `codex exec`. Check every finding before fixing it: reviewers also report false positives.
- Fallback, only when needed: Opus at medium effort. Use the `reviewer-opus` agent when Codex fails (auth, quota, timeout, or no output after a retry). Use the `implementer` agent (Sonnet, `.claude/agents/implementer.md`) when a task fails twice through `agy-multi`, and Opus only when it also fails twice with Sonnet.

## GUI testing

- Run the app on a separate Xvfb display (for example `:99`) and drive it with xdotool and screenshots.
- Never send synthetic input to the user's `:0` display.
- Check results in the DB on disk as well as on screen.
- Hand the user only the checks that cannot be automated, such as real-GPU rendering. Xvfb uses software GL, so FPS measured there means nothing.
