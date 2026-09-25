# Loom

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
- Back/forward history, parent folder, editable path bar
- Hidden-file toggle

Planned for v1:

- Sidebar with XDG places, mounted drives, and bookmarks
- Copy, move, rename, new folder, trash, with name-conflict handling
- Name filter and recursive search
- Command panel (rule-based parser, validator, preview)
- Optional local LLM fallback via llama.cpp (small quantized models such as Qwen2.5 1.5B/3B Instruct)
- Multi-level undo and operation history

See [`docs/PRD.md`](docs/PRD.md) for the full spec and what's out of scope for v1.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Alt+Left` / `Alt+Right` | Back / forward |
| `Alt+Up` | Parent folder |
| `Ctrl+L` | Edit location |
| `Ctrl+H` | Show hidden files |
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

AUR and Flatpak packages are planned once v1 is usable.

## Data

Loom only writes to XDG directories:

- `$XDG_DATA_HOME/loom/history.db` — operation history for undo, and bookmarks
- `$XDG_CONFIG_HOME/loom/config.toml` — preferences

## Contributing

Before opening a PR, make sure these pass (CI runs the same):

```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

## License

[GPL-3.0-or-later](LICENSE)
