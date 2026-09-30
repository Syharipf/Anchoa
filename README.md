# Anchoa

Aplikasi desktop untuk mengelola semuanya di satu tempat (catatan, task, keuangan, project), bergaya Notion/Obsidian. Dibangun dengan Tauri 2, React, dan SQLite. Saat ini untuk Fedora Linux.

## Instal

Unduh file `.rpm` dari halaman Releases, lalu:

```bash
sudo dnf install ./Anchoa-0.3.0-1.x86_64.rpm
```

## Data dan backup

- Database: `~/.local/share/io.github.syharipf.anchoa/anchoa.db`
- Backup: `~/.local/share/io.github.syharipf.anchoa/backups/`, dibuat otomatis setiap hari saat aplikasi dibuka. 7 backup terbaru disimpan. Tombol "Backup sekarang" ada di Pengaturan.

### Memulihkan dari backup

1. Tutup Anchoa.
2. Simpan dulu database yang sekarang, untuk berjaga-jaga:
   ```bash
   cd ~/.local/share/io.github.syharipf.anchoa
   mkdir -p rusak && mv anchoa.db anchoa.db-wal anchoa.db-shm rusak/ 2>/dev/null
   ```
3. Salin backup yang dipilih menjadi `anchoa.db`:
   ```bash
   cp backups/anchoa-2026-09-29.db anchoa.db
   ```
4. Buka Anchoa lagi.

## Pengembangan

Kebutuhan: Rust (stable), bun, dan library sistem untuk Tauri:

```bash
sudo dnf install webkit2gtk4.1-devel librsvg2-devel libappindicator-gtk3-devel libxdo-devel
```

```bash
bun install
bun tauri dev                      # jalankan dengan hot reload
bun run typecheck && bun run test  # cek frontend
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
bun tauri build                    # RPM di src-tauri/target/release/bundle/rpm/
```

Uji end-to-end di display virtual (butuh `Xvfb`, `xdotool`, ImageMagick, `sqlite3`):

```bash
bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa
```

Rencana dan spec ada di `docs/superpowers/`.
