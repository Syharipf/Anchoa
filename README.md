# Anchoa

A keyboard-first file manager for the Linux desktop, built with GTK4 and libadwaita, with a command panel for batch and conditional file operations:

```
move *.jpg older than 30d to ~/Pictures/old
trash *.tmp in ~/Downloads
chmod 644 *.txt
```

Commands are parsed by a deterministic rule-based parser first. A small local LLM is an **optional** fallback for phrasing the parser doesn't understand. Either way, every plan goes through a validator and a preview before anything touches your files.

> **Status:** early development. Not usable as a daily file manager yet.

## Principles

- **No shell execution.** The command panel can only produce `move`, `copy`, `trash`, `rename`, `mkdir`, and `chmod`. Every action plan, whether from the parser or the LLM, must pass the validator.
- **Preview first.** Destructive operations show exactly what will change and wait for confirmation. Nothing runs automatically.
- **Delete means trash.** Deleted files go to the XDG trash. Permanent deletion is explicit and confirmed.
- **Undo.** Operations are recorded so they can be reverted, including batches that fail halfway.
- **Offline.** No network calls, ever — including the AI features. There is no cloud LLM backend.
- **The model is optional.** Navigation, file operations, and rule-based commands work fully without a model installed. If you add one, it only sees file metadata (name, size, permissions, timestamps), never file contents.
- **Works everywhere.** Client-side decorations, full keyboard navigation, and no compositor required — KDE Plasma and tiling WMs like i3 alike.

## Features

Done:

- Directory listing with name, size, permission, and modified-time columns (sortable by name, size, and time)
- Back/forward history, parent folder, editable path bar, hidden-file toggle
- Sidebar with XDG places, mounted and mountable drives, the trash, and reorderable bookmarks
- Trash, rename, and new folder, each recorded so it can be undone
- Trash view: restore, delete for good, empty the trash; trash older than 30 days is deleted at startup (configurable)
- Command panel: rule-based parser, validator, and a preview before anything runs
- Multi-level undo with a preview of what will be reverted and what changed since

Planned for v1:

- Copy, cut, paste, and drag and drop, with name-conflict handling
- Name filter and recursive search
- Settings
- Optional local LLM fallback via llama.cpp (small quantized models such as Qwen2.5 1.5B/3B Instruct)

See [`docs/PRD.md`](docs/PRD.md) for the full spec and what's out of scope for v1.

## Command panel

Press `Ctrl+K` and type a command. It applies to the entries of one folder (the active one, or the one given with `in`), never recursively.

```
move *.jpg older than 30d to ~/Pictures/old
copy *.pdf larger than 5mb to ~/Documents/big
trash *.tmp in ~/Downloads
rename *.jpeg to *.jpg
mkdir 2026-09
chmod 644 *.txt
```

- Conditions: a glob (`*`, `?`; hidden names only match a pattern that starts with `.`), `files` or `dirs`, `older`/`newer than Nd`, `larger`/`smaller than N{b,kb,mb,gb}`.
- `~` is your home folder; relative paths start at the active folder. Quote names with spaces: `trash "to do.txt"`.
- Every command shows a preview (item count, total size, folders it creates) and waits for confirmation. `Ctrl+Z` undoes it.
- It is not a shell: only the six operations above exist, and nothing else can run.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Alt+Left` / `Alt+Right` | Back / forward |
| `Alt+Up` | Parent folder |
| `Ctrl+L` | Edit location |
| `Ctrl+K` | Command panel (`Esc` returns to the file list) |
| `F6` | Cycle focus: sidebar, file list, command panel |
| `Ctrl+H` | Show hidden files |
| `Delete` | Move the selection to the trash (in the trash: delete for good) |
| `F2` | Rename |
| `Ctrl+Shift+N` | New folder |
| `Ctrl+Z` | Undo the last operation |
| `Ctrl+D` | Bookmark the current folder |
| `Delete` (sidebar) | Remove the selected bookmark |
| `Alt+Shift+Up` / `Alt+Shift+Down` (sidebar) | Move the selected bookmark |
| `Ctrl+Q` | Quit |

## Building

Requires Rust 1.85+ (edition 2024), GTK 4, libadwaita, and SQLite development files.

```bash
# Fedora
sudo dnf install gtk4-devel libadwaita-devel sqlite-devel

# Debian / Ubuntu
sudo apt install libgtk-4-dev libadwaita-1-dev libsqlite3-dev

# Arch
sudo pacman -S gtk4 libadwaita sqlite
```

```bash
cargo run --release
```

### Arch Linux (AUR)

[`packaging/aur/PKGBUILD`](packaging/aur/PKGBUILD) builds `anchoa-git` from the latest commit:

```bash
cd packaging/aur && makepkg -si
```

A Flatpak is planned once v1 is usable.

## Data

Anchoa only writes to XDG directories:

- `$XDG_DATA_HOME/anchoa/history.db` — operation history for undo, command history, and bookmarks
- `$XDG_CONFIG_HOME/anchoa/config.toml` — preferences, such as `trash_auto_delete_days` (default 30, `0` turns it off)

## Contributing

Before opening a PR, make sure these pass (CI runs the same):

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

## License

[GPL-3.0-or-later](LICENSE)
