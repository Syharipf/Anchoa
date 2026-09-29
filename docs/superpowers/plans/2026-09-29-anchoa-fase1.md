# Anchoa Fase 1 (Fondasi + Dashboard): Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun aplikasi desktop Anchoa v0.1.0 untuk Fedora. Isinya app shell, database SQLite, quick capture, Inbox, halaman item, dashboard 4 widget, backup, dan installer RPM.

**Architecture:** Tauri 2 dengan modular monolith. React memanggil command Rust hanya lewat `src/api.ts`. Command Rust hanyalah lapisan tipis yang meneruskan ke fungsi murni (`items.rs`, `dashboard.rs`, `backup.rs`). Fungsi murni itu menerima `&Connection` dan `now`, jadi semuanya bisa diuji dengan SQLite in-memory.

**Tech Stack:** Tauri 2.12, Rust edition 2024, rusqlite 0.40 (bundled), jiff 0.2, uuid 1 (v7), React 19, TypeScript 7, Vite 8, Tailwind CSS 4, bun 1.4 (package manager dan test runner).

**Spec:** `docs/superpowers/specs/2026-09-29-anchoa-fase1-design.md`

## Global Constraints

- Identifier app: `io.github.syharipf.anchoa`. Nama produk: `Anchoa`. Versi: `0.1.0`.
- Jendela: awal 1280×800, minimum 1100×680. Kolom AI lebar 240px (`w-60`).
- Folder data: `app_data_dir()`, lalu `anchoa.db`, `backups/`, dan log di `app_log_dir()`.
- ID item: UUIDv7. Waktu: epoch ms UTC. Hapus: soft delete (`deleted_at`). Semua query memfilter `deleted_at IS NULL`.
- Uang: integer, tidak pernah float (belum dipakai di Fase 1).
- Command tidak boleh panic di jalur yang dipicu user, dan semuanya mengembalikan `Result<T, AppError>` yang sampai ke frontend sebagai `{ code, message }`.
- DB yang gagal dibuka tidak boleh ditimpa atau diganti dengan DB kosong.
- Pragma: `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.
- Backup: harian saat start, 7 file terbaru disimpan, backup manual ikut rotasi yang sama.
- Autosave halaman item: 500 ms setelah berhenti mengetik, dan saat fokus pindah.
- Shortcut quick capture: `Ctrl+N`.
- Sapaan: pagi 04:00–10:59, siang 11:00–14:59, sore 15:00–17:59, malam 18:00–03:59.
- Batas "Item terbaru": 8 item.
- CSP ketat, tanpa CDN. Semua aset dibundel.
- Semua teks UI dalam Bahasa Indonesia.
- `main` diproteksi: setiap perubahan lewat PR, CI hijau, dan squash merge. Merge hanya kalau user bilang "merge".

## Penyesuaian terhadap spec

Keputusan berikut muncul saat kode diverifikasi. Spec diperbarui di commit yang sama dengan rencana ini.

1. **Test frontend memakai `bun test` bawaan bun, bukan Vitest.** Satu dependency lebih sedikit, dan bun sudah menjadi runtime di mesin ini.
2. **`update_item(id, patch)`** menerima objek `patch` (`title?`, `body?`, `dueAt?`). `dueAt: null` menghapus tanggal, dan field yang tidak dikirim tidak diubah.
3. **Command baru `db_status`** mengembalikan `{ path, error, backupError }` untuk layar error dan toast backup.
4. **Command baru `open_folder(kind)`** dengan `kind` = `data`, `backup`, atau `log`. Folder dibuka dari sisi Rust lewat `tauri-plugin-opener`, jadi frontend tidak pernah mengirim path dan tidak butuh izin opener.
5. **Field `finance` di `Dashboard` belum ada di Fase 1.** Widget keuangan menampilkan teks statis.
6. **Input tanggal kosong ditampilkan abu-abu.** WebKitGTK menampilkan tanggal hari ini di input `type="date"` yang kosong, sehingga terlihat seolah sudah di-set.
7. **Uji end-to-end memakai `scripts/e2e-smoke.sh`.** Skrip ini menjalankan app di Xvfb dengan folder data dan D-Bus sendiri. D-Bus terpisah itu wajib, karena `tauri-plugin-single-instance` memakai D-Bus: tanpa itu, instance uji hanya akan memfokuskan Anchoa yang sedang dipakai.

## Pembagian PR

| Issue | Branch | Isi |
|---|---|---|
| #1 | `feat/1-scaffold` | Scaffold Tauri + React, shell kosong, perbaikan GPU, single instance, log, CI, skrip E2E |
| #2 | `feat/2-database` | SQLite, migrasi, `AppError`, command item (backend saja) |
| #3 | `feat/3-items-ui` | Toast, layar error DB, quick capture + `Ctrl+N`, Inbox, halaman item, `bun test` |
| #4 | `feat/4-dashboard` | `get_dashboard` + widget Hari ini, Keuangan, Item terbaru |
| #5 | `feat/5-backup-settings` | Backup harian dan manual, halaman Pengaturan |
| #6 | `feat/6-release` | README, RPM, rilis `v0.1.0` |

Nomor issue di atas berlaku kalau issue dibuat berurutan di repo yang masih kosong (Task 0.2). Nomor PR akan mulai dari #7.

## Siklus setiap PR

Ringkasannya ada di `CLAUDE.md`. Setiap PR berakhir dengan task "Buka PR", yang berisi perintah lengkapnya. Aturannya:

1. `git switch main && git pull`, lalu `git switch -c <branch>`.
2. Kerjakan task-nya dengan TDD dan commit kecil (Conventional Commits, diakhiri baris `Co-Authored-By`).
3. Jalankan verifikasi penuh:
   ```bash
   bun run typecheck && bun run test && bun run build
   cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test && cd ..
   bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa
   ```
   Lewati `bun run test` di PR #1 dan #2, karena script itu baru ada di PR #3.
4. Lihat screenshot di `~/.cache/anchoa-e2e/` dan pastikan tampilannya sesuai.
5. Buat PR (`gh pr create`) dengan ringkasan, hasil verifikasi, dan `Closes #N`.
6. Review diff sendiri (`/code-review`), perbaiki temuannya, lalu tunggu review dari user.
7. Setelah user bilang "merge": `gh pr merge --squash --delete-branch`, lalu `git switch main && git pull`.

---

## Task 0: Persiapan repo (sekali, sebelum PR #1)

Dijalankan di `main` lokal, yang saat ini berisi spec, `CLAUDE.md`, `.gitignore`, dan dokumen ini.

### Task 0.1: Push `main` dan atur repo

- [ ] **Step 1: Push `main` pertama kali**

```bash
git push -u origin main
```

Expected: `branch 'main' set up to track 'origin/main'`.

- [ ] **Step 2: Hanya izinkan squash merge dan hapus branch otomatis**

```bash
gh repo edit Syharipf/Anchoa --enable-squash-merge --enable-merge-commit=false --enable-rebase-merge=false --delete-branch-on-merge
```

- [ ] **Step 3: Proteksi `main`: wajib lewat PR, berlaku juga untuk admin**

Status check CI belum bisa diwajibkan di sini, karena job `check` belum pernah jalan. Itu ditambahkan di Task 1.5.

```bash
gh api -X PUT repos/Syharipf/Anchoa/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null
}
EOF
```

Expected: JSON yang berisi `"enforce_admins": { ... "enabled": true }`.

### Task 0.2: Milestone dan issue

- [ ] **Step 1: Buat milestone**

```bash
gh api repos/Syharipf/Anchoa/milestones -f title="Fase 1" -f description="Fondasi + Dashboard. Spec: docs/superpowers/specs/2026-09-29-anchoa-fase1-design.md"
```

- [ ] **Step 2: Buat 6 issue secara berurutan**

```bash
P=docs/superpowers/plans/2026-09-29-anchoa-fase1.md
gh issue create --milestone "Fase 1" --title "Scaffold aplikasi, perbaikan GPU Linux, dan CI" --body "Rencana: $P, PR #1. Tauri 2 + React + Tailwind, shell kosong (sidebar, konten, kolom AI), perbaikan WEBKIT_WEB_RENDER_DEVICE_FILE, single instance, log, CI GitHub Actions, skrip E2E."
gh issue create --milestone "Fase 1" --title "Fondasi database dan command item" --body "Rencana: $P, PR #2. SQLite + migrasi + backup sebelum migrasi, AppError, command capture/open/update/delete/list_inbox, db_status, open_folder."
gh issue create --milestone "Fase 1" --title "UI item: quick capture, Inbox, halaman item" --body "Rencana: $P, PR #3. Toast, layar error DB, quick capture + Ctrl+N, Inbox, halaman item dengan autosave dan hapus, bun test."
gh issue create --milestone "Fase 1" --title "Widget dashboard" --body "Rencana: $P, PR #4. get_dashboard, widget Hari ini (terlambat + hari ini), Keuangan (kosong), Item terbaru."
gh issue create --milestone "Fase 1" --title "Backup dan halaman Pengaturan" --body "Rencana: $P, PR #5. Backup harian saat start, backup manual, rotasi 7 file, halaman Pengaturan."
gh issue create --milestone "Fase 1" --title "Rilis v0.1.0" --body "Rencana: $P, PR #6. README (dev + restore), RPM, uji instalasi, GitHub Release v0.1.0."
gh issue list --milestone "Fase 1"
```

Expected: issue #1 sampai #6 dengan judul sesuai urutan di atas.

---

## PR #1: Scaffold, perbaikan GPU, dan CI (`feat/1-scaffold`, Closes #1)

### Task 1.1: Frontend scaffold

**Files:**
- Create: `package.json`, `bun.lock` (dibuat oleh bun), `vite.config.ts`, `tsconfig.json`, `index.html`, `src/index.css`, `src/main.tsx`, `src/App.tsx`, `src/shell/Sidebar.tsx`, `src/shell/AiColumn.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `Sidebar({ current, onSelect })` dan `type TopPage` (diperluas di PR #3 dan #5), serta `AiColumn()`.

- [ ] **Step 1: Buat branch**

```bash
git switch main && git pull && git switch -c feat/1-scaffold
```

- [ ] **Step 2: Tulis `package.json`**

```json
{
  "name": "anchoa",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "tauri": "tauri"
  }
}
```

- [ ] **Step 3: Pasang dependency**

```bash
bun add react react-dom @tauri-apps/api
bun add -d @tauri-apps/cli vite @vitejs/plugin-react tailwindcss@4 @tailwindcss/vite@4 typescript @types/react @types/react-dom
```

Expected (per 2026-09-29): react 19.3, @tauri-apps/api dan cli 2.12, vite 8.3, @vitejs/plugin-react 6.1, tailwindcss 4.3, typescript 7.0.

- [ ] **Step 4: Tulis `vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri expects a fixed dev port; keep the screen so Rust errors stay visible.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
});
```

- [ ] **Step 5: Tulis `tsconfig.json`**

TypeScript 7 tidak lagi memuat `@types/*` secara otomatis, dan secara default menolak import CSS tanpa deklarasi. Karena itu `types` harus ditulis eksplisit.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 6: Tulis `index.html`**

```html
<!doctype html>
<html lang="id">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Anchoa</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Tulis `src/index.css`**

```css
@import "tailwindcss";

:root {
  color-scheme: light dark;
}

html,
body,
#root {
  height: 100%;
}

body {
  @apply bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100;
}
```

- [ ] **Step 8: Tulis `src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 9: Tulis `src/shell/Sidebar.tsx`**

```tsx
export type TopPage = "dashboard";

export function Sidebar({ current, onSelect }: { current: string; onSelect: (page: TopPage) => void }) {
  const link = (page: TopPage, label: string) => (
    <button
      onClick={() => onSelect(page)}
      aria-current={current === page ? "page" : undefined}
      className={`w-full rounded-md px-3 py-2 text-left text-sm ${
        current === page
          ? "bg-violet-600 text-white"
          : "text-neutral-600 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-neutral-200 bg-neutral-100 p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-4 px-3 text-lg font-bold">Anchoa</div>
      {link("dashboard", "Dashboard")}
    </nav>
  );
}
```

- [ ] **Step 10: Tulis `src/shell/AiColumn.tsx`**

```tsx
/** Reserved for the Live2D assistant (Fase 5). */
export function AiColumn() {
  return (
    <aside className="flex w-60 shrink-0 flex-col items-center justify-center gap-3 border-l border-neutral-200 bg-neutral-100 p-4 text-center text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex h-40 w-28 items-center justify-center rounded-xl border-2 border-dashed border-violet-400 text-violet-500">
        AI
      </div>
      <p>AI Assistant — segera</p>
    </aside>
  );
}
```

- [ ] **Step 11: Tulis `src/App.tsx`**

```tsx
import { AiColumn } from "./shell/AiColumn";
import { Sidebar } from "./shell/Sidebar";

export function App() {
  return (
    <div className="flex h-full">
      <Sidebar current="dashboard" onSelect={() => {}} />
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <h1 className="text-xl font-bold">Dashboard</h1>
      </main>
      <AiColumn />
    </div>
  );
}
```

- [ ] **Step 12: Tambah baris ke `.gitignore`**

Isi akhir `.gitignore`:

```
.superpowers/
node_modules/
dist/
src-tauri/target/
src-tauri/gen/
```

- [ ] **Step 13: Verifikasi**

Run: `bun run typecheck && bun run build`
Expected: `tsc` tanpa output, dan Vite menulis `dist/index.html` serta `dist/assets/*`.

- [ ] **Step 14: Commit**

```bash
git add package.json bun.lock vite.config.ts tsconfig.json index.html src .gitignore
git commit -m "feat: scaffold React + Vite + Tailwind frontend with empty shell

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.2: Backend Tauri dan perbaikan GPU (TDD)

**Files:**
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/gpu.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `app-icon.png`, `src-tauri/icons/*`

**Interfaces:**
- Produces: `gpu::pick_render_node(&[(String, String)]) -> Option<String>` dan `gpu::apply_linux_workaround() -> Option<String>`.

- [ ] **Step 1: Tulis `src-tauri/Cargo.toml`**

```toml
[package]
name = "anchoa"
version = "0.1.0"
edition = "2024"

[lib]
name = "anchoa_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-log = "2"
tauri-plugin-single-instance = "2"
log = "0.4"
```

- [ ] **Step 2: Tulis `src-tauri/build.rs` dan `src-tauri/src/main.rs`**

`src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

`src-tauri/src/main.rs`:

```rust
// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    anchoa_lib::run()
}
```

- [ ] **Step 3: Tulis `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Anchoa",
  "version": "0.1.0",
  "identifier": "io.github.syharipf.anchoa",
  "build": {
    "beforeDevCommand": "bun run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "bun run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Anchoa",
        "width": 1280,
        "height": 800,
        "minWidth": 1100,
        "minHeight": 680
      }
    ],
    "security": {
      "csp": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'",
      "devCsp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": ["rpm"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

`devCsp: null` diperlukan karena Vite dev server menyisipkan script inline untuk hot reload. Build rilis tetap memakai `csp` yang ketat.

- [ ] **Step 4: Tulis `src-tauri/capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Permissions for the main window",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

- [ ] **Step 5: Buat ikon**

```bash
magick -size 1024x1024 xc:'#7c3aed' -fill white -gravity center -pointsize 640 -annotate 0 'A' PNG32:app-icon.png
bun tauri icon app-icon.png
```

Expected: `src-tauri/icons/` berisi `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`, `icon.png`, serta folder `android/` dan `ios/`.

- [ ] **Step 6: Tulis test GPU yang gagal**

Buat `src-tauri/src/gpu.rs` dengan implementasi sementara yang selalu mengembalikan `None`:

```rust
pub fn pick_render_node(_nodes: &[(String, String)]) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::pick_render_node;

    fn node(path: &str, driver: &str) -> (String, String) {
        (path.to_string(), driver.to_string())
    }

    #[test]
    fn picks_non_nvidia_node_when_nvidia_present() {
        let nodes = [node("/dev/dri/renderD128", "i915"), node("/dev/dri/renderD129", "nvidia")];
        assert_eq!(pick_render_node(&nodes), Some("/dev/dri/renderD128".to_string()));

        let nodes = [node("/dev/dri/renderD128", "nvidia"), node("/dev/dri/renderD129", "amdgpu")];
        assert_eq!(pick_render_node(&nodes), Some("/dev/dri/renderD129".to_string()));
    }

    #[test]
    fn leaves_machines_without_nvidia_alone() {
        assert_eq!(pick_render_node(&[node("/dev/dri/renderD128", "i915")]), None);
        assert_eq!(pick_render_node(&[]), None);
    }

    #[test]
    fn leaves_nvidia_only_machines_alone() {
        assert_eq!(pick_render_node(&[node("/dev/dri/renderD128", "nvidia")]), None);
    }
}
```

Buat `src-tauri/src/lib.rs` sementara:

```rust
mod gpu;

pub fn run() {}
```

Pastikan `dist/` sudah ada dari Task 1.1 Step 13, karena `tauri::generate_context!` membacanya saat compile.

- [ ] **Step 7: Jalankan test, pastikan gagal**

Run: `cd src-tauri && cargo test gpu && cd ..`
Expected: FAIL. `picks_non_nvidia_node_when_nvidia_present` gagal dengan `left: None, right: Some("/dev/dri/renderD128")`. Dua test lain lulus.

- [ ] **Step 8: Implementasi lengkap `src-tauri/src/gpu.rs`**

Ganti seluruh isi file:

```rust
//! WebKitGTK cannot allocate GBM buffers on the proprietary NVIDIA driver and
//! renders nothing. When an NVIDIA render node sits next to another GPU, point
//! WebKit at the other one.

/// `nodes` holds (render node path, kernel driver name) pairs.
/// Returns the node to use only when NVIDIA and a non-NVIDIA node both exist.
pub fn pick_render_node(nodes: &[(String, String)]) -> Option<String> {
    if !nodes.iter().any(|(_, driver)| driver == "nvidia") {
        return None;
    }
    nodes
        .iter()
        .find(|(_, driver)| driver != "nvidia")
        .map(|(node, _)| node.clone())
}

#[cfg(target_os = "linux")]
fn render_nodes() -> Vec<(String, String)> {
    let Ok(entries) = std::fs::read_dir("/dev/dri") else {
        return Vec::new();
    };
    let mut nodes: Vec<(String, String)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with("renderD") {
                return None;
            }
            let driver = std::fs::read_link(format!("/sys/class/drm/{name}/device/driver"))
                .ok()
                .and_then(|p| p.file_name().map(|f| f.to_string_lossy().into_owned()))
                .unwrap_or_default();
            Some((format!("/dev/dri/{name}"), driver))
        })
        .collect();
    nodes.sort();
    nodes
}

/// Sets `WEBKIT_WEB_RENDER_DEVICE_FILE` when needed and returns the chosen node.
/// Must run before any other thread exists: `set_var` is unsafe otherwise.
#[cfg(target_os = "linux")]
pub fn apply_linux_workaround() -> Option<String> {
    const VAR: &str = "WEBKIT_WEB_RENDER_DEVICE_FILE";
    if std::env::var_os(VAR).is_some() {
        return None;
    }
    let node = pick_render_node(&render_nodes())?;
    // SAFETY: called first thing in `run()`, before any thread is spawned.
    unsafe { std::env::set_var(VAR, &node) };
    Some(node)
}

#[cfg(not(target_os = "linux"))]
pub fn apply_linux_workaround() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::pick_render_node;

    fn node(path: &str, driver: &str) -> (String, String) {
        (path.to_string(), driver.to_string())
    }

    #[test]
    fn picks_non_nvidia_node_when_nvidia_present() {
        let nodes = [node("/dev/dri/renderD128", "i915"), node("/dev/dri/renderD129", "nvidia")];
        assert_eq!(pick_render_node(&nodes), Some("/dev/dri/renderD128".to_string()));

        let nodes = [node("/dev/dri/renderD128", "nvidia"), node("/dev/dri/renderD129", "amdgpu")];
        assert_eq!(pick_render_node(&nodes), Some("/dev/dri/renderD129".to_string()));
    }

    #[test]
    fn leaves_machines_without_nvidia_alone() {
        assert_eq!(pick_render_node(&[node("/dev/dri/renderD128", "i915")]), None);
        assert_eq!(pick_render_node(&[]), None);
    }

    #[test]
    fn leaves_nvidia_only_machines_alone() {
        assert_eq!(pick_render_node(&[node("/dev/dri/renderD128", "nvidia")]), None);
    }
}
```

- [ ] **Step 9: Tulis `src-tauri/src/lib.rs` yang sebenarnya**

```rust
mod gpu;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Must stay first: it may call set_var, which is only sound before other threads start.
    let gpu_node = gpu::apply_linux_workaround();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        .setup(move |_app| {
            if let Some(node) = &gpu_node {
                log::info!("NVIDIA workaround: WEBKIT_WEB_RENDER_DEVICE_FILE={node}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`tauri_plugin_single_instance` harus menjadi plugin pertama yang didaftarkan.

- [ ] **Step 10: Jalankan test dan clippy**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings && cd ..`
Expected: `test result: ok. 3 passed`. Clippy tanpa warning.

- [ ] **Step 11: Commit**

```bash
git add src-tauri app-icon.png
git commit -m "feat: add Tauri backend with Linux NVIDIA render-node workaround

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.3: Skrip E2E

**Files:**
- Create: `scripts/e2e-smoke.sh`

**Interfaces:**
- Produces: helper `fail`, `shot`, `sql`, `click`, `start_app`, `stop_app`, `fresh`, dan `check_shell`. PR berikutnya menambah fungsi `check_*` beserta pemanggilannya di bagian bawah skrip.

- [ ] **Step 1: Tulis `scripts/e2e-smoke.sh`**

```bash
#!/usr/bin/env bash
# End-to-end smoke test. Runs the app on a private Xvfb display with its own
# data dir and D-Bus, so it never touches the real session, real data, or a
# running Anchoa. Coordinates assume the fixed 1280x800 window at 0,0.
# Usage: scripts/e2e-smoke.sh <path-to-anchoa-binary>
set -euo pipefail

BIN=$(realpath "${1:?usage: e2e-smoke.sh <anchoa binary>}")
WORK=${E2E_DIR:-$HOME/.cache/anchoa-e2e}
APPDATA="$WORK/data/io.github.syharipf.anchoa"
DB="$APPDATA/anchoa.db"
export DISPLAY=${E2E_DISPLAY:-:99} XDG_DATA_HOME="$WORK/data"

rm -rf "$WORK" && mkdir -p "$WORK/data"
Xvfb "$DISPLAY" -screen 0 1280x800x24 >/dev/null 2>&1 &
XVFB=$!
{ read -r DBUS_SESSION_BUS_ADDRESS; read -r DBUS_PID; } < <(dbus-daemon --session --fork --print-address=1 --print-pid=1)
export DBUS_SESSION_BUS_ADDRESS
APP=
trap 'kill $APP $DBUS_PID $XVFB 2>/dev/null || true' EXIT
sleep 1

fail() { echo "FAIL: $*"; exit 1; }
shot() { import -window root "$WORK/$1.png"; }
sql() { sqlite3 "$DB" "$1"; }
click() { xdotool mousemove "$1" "$2" click 1; sleep 0.7; }

start_app() {
  "$BIN" >>"$WORK/app.log" 2>&1 &
  APP=$!
  xdotool search --sync --name '^Anchoa$' >/dev/null
  # WebKit needs a few seconds to paint under software GL: wait for a non-blank screen.
  for _ in $(seq 1 30); do
    sd=$(import -window root png:- | magick - -format '%[fx:standard_deviation]' info:)
    awk -v sd="$sd" 'BEGIN { exit !(sd > 0.01) }' && return
    sleep 1
  done
  fail "window never painted"
}

stop_app() { kill "$APP"; wait "$APP" 2>/dev/null || true; APP=; }

# Every check starts from an empty data dir: WAL files left by a killed run
# would otherwise leak into the next check.
fresh() { rm -rf "$APPDATA"; }

check_shell() {
  fresh
  start_app
  shot 1-shell
  stop_app
}

check_shell
echo "PASS. Screenshots in $WORK"
```

```bash
chmod +x scripts/e2e-smoke.sh
```

Alat yang dibutuhkan (sudah terpasang di mesin pengembang): `Xvfb`, `xdotool`, ImageMagick (`import`, `magick`), `sqlite3`, dan `dbus-daemon`.

- [ ] **Step 2: Build dan jalankan**

Run: `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`
Expected: `PASS. Screenshots in /home/syharipf/.cache/anchoa-e2e`. File `1-shell.png` menampilkan sidebar "Anchoa / Dashboard", judul "Dashboard", dan kolom kanan "AI Assistant — segera". `app.log` berisi `NVIDIA workaround: WEBKIT_WEB_RENDER_DEVICE_FILE=/dev/dri/renderD128`.

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-smoke.sh
git commit -m "test: add Xvfb end-to-end smoke script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.4: CI dan perintah di CLAUDE.md

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `CLAUDE.md` (baris Status dan bagian Commands baru)

- [ ] **Step 1: Tulis `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v5
      - name: Install system libraries for Tauri
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev libssl-dev
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - name: Build frontend (embedded by tauri::generate_context!)
        run: bun run build
      - run: cargo clippy --all-targets -- -D warnings
        working-directory: src-tauri
      - run: cargo test
        working-directory: src-tauri
```

- [ ] **Step 2: Perbarui `CLAUDE.md`**

Ganti paragraf ini:

```
Status: Fase 1 is in planning. There is no application code yet. Add the build, lint and test commands to this file in the scaffold PR.
```

dengan:

```
Status: Fase 1 is being implemented PR by PR; see the plan in `docs/superpowers/plans/`.

## Commands

- `bun install`: install JS dependencies.
- `bun tauri dev`: run the app with hot reload.
- `bun run typecheck`: TypeScript check.
- `cd src-tauri && cargo test`: backend tests. Run one test with `cargo test gpu::tests::leaves_nvidia_only_machines_alone`.
- `cd src-tauri && cargo clippy --all-targets -- -D warnings`: lint (CI fails on any warning).
- `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`: end-to-end check on Xvfb. Screenshots go to `~/.cache/anchoa-e2e/`.
- `bun tauri build`: release RPM in `src-tauri/target/release/bundle/rpm/`.
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml CLAUDE.md
git commit -m "ci: add Linux CI for typecheck, build, clippy and cargo test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 1.5: Buka PR #1

- [ ] **Step 1: Verifikasi penuh**

Jalankan perintah di "Siklus setiap PR", langkah 3, tanpa `bun run test`. Semua harus lulus.

- [ ] **Step 2: Cek di layar asli (user)**

Minta user menjalankan `! bun tauri dev` dari root repo, lalu memastikan jendela tampil normal. Di laptop NVIDIA-primary, tanpa perbaikan GPU jendelanya akan kosong. Ini satu-satunya cek yang tidak bisa diotomatisasi, karena Xvfb tidak memakai GPU NVIDIA.

- [ ] **Step 3: Push dan buat PR**

```bash
git push -u origin feat/1-scaffold
gh pr create --title "Scaffold aplikasi, perbaikan GPU Linux, dan CI" --body "$(cat <<'EOF'
## Ringkasan
- Tauri 2 + React 19 + Vite + Tailwind 4, shell kosong (sidebar, konten, kolom AI 240px)
- Perbaikan GPU Linux: WEBKIT_WEB_RENDER_DEVICE_FILE ke node non-NVIDIA (spec bagian 8)
- Single instance, log ke file, CSP ketat
- CI GitHub Actions: typecheck, build, clippy -D warnings, cargo test
- scripts/e2e-smoke.sh (Xvfb + D-Bus terpisah)

## Verifikasi
- cargo test: 3 passed
- e2e-smoke: PASS (screenshot shell)
- Layar asli (NVIDIA-primary): <hasil cek user>

Closes #1

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Setelah CI hijau untuk pertama kali, wajibkan status check `check`**

```bash
gh api -X PUT repos/Syharipf/Anchoa/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": { "strict": true, "contexts": ["check"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null
}
EOF
```

- [ ] **Step 5: Review sendiri, serahkan ke user, merge setelah user bilang "merge"**

```bash
gh pr merge --squash --delete-branch && git switch main && git pull
```

---

## PR #2: Database dan command item (`feat/2-database`, Closes #2)

### Task 2.1: Dependency, error, dan migrasi

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/migrations/001_init.sql`, `src-tauri/src/error.rs`, `src-tauri/src/time.rs`

**Interfaces:**
- Produces: `AppError` dengan varian `Empty`, `NotFound`, `DbUnavailable`, `DbTooNew(i64)`, `Db`, `Io`, `Tauri`, `Other(String)`, metode `code()`, dan implementasi `Serialize` yang menghasilkan `{ code, message }`. Juga `time::now_ms() -> i64`.

- [ ] **Step 1: Buat branch dan pasang crate**

```bash
git switch main && git pull && git switch -c feat/2-database
cd src-tauri
cargo add rusqlite --features bundled
cargo add serde --features derive
cargo add thiserror jiff tauri-plugin-opener
cargo add uuid --features v7
cargo add --dev tempfile serde_json
cd ..
```

Expected: `[dependencies]` bertambah `rusqlite` (0.40, bundled), `serde`, `thiserror` (2), `jiff` (0.2), `tauri-plugin-opener` (2), dan `uuid` (1, v7). `[dev-dependencies]` berisi `tempfile` dan `serde_json`.

- [ ] **Step 2: Tulis `src-tauri/migrations/001_init.sql`**

```sql
CREATE TABLE items (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  parent_id   TEXT REFERENCES items(id),
  due_at      INTEGER,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  opened_at   INTEGER,
  deleted_at  INTEGER
);

CREATE INDEX items_due    ON items(due_at)    WHERE deleted_at IS NULL AND due_at IS NOT NULL;
CREATE INDEX items_parent ON items(parent_id) WHERE deleted_at IS NULL;
```

- [ ] **Step 3: Tulis `src-tauri/src/error.rs`**

```rust
use serde::ser::{Serialize, SerializeStruct, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Teks tidak boleh kosong")]
    Empty,
    #[error("Item tidak ditemukan")]
    NotFound,
    #[error("Database tidak tersedia")]
    DbUnavailable,
    #[error("Database versi {0} dibuat oleh aplikasi yang lebih baru")]
    DbTooNew(i64),
    #[error("Kesalahan database: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Kesalahan file: {0}")]
    Io(#[from] std::io::Error),
    #[error("Kesalahan aplikasi: {0}")]
    Tauri(#[from] tauri::Error),
    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Empty => "empty",
            AppError::NotFound => "not_found",
            AppError::DbUnavailable => "db_unavailable",
            AppError::DbTooNew(_) => "db_too_new",
            AppError::Db(_) => "db",
            AppError::Io(_) => "io",
            AppError::Tauri(_) | AppError::Other(_) => "other",
        }
    }
}

/// Sent to the frontend as `{ code, message }`.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("code", self.code())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}
```

- [ ] **Step 4: Tulis `src-tauri/src/time.rs`**

```rust
use jiff::Timestamp;

pub fn now_ms() -> i64 {
    Timestamp::now().as_millisecond()
}
```

Modul ini belum didaftarkan di `lib.rs`. Pendaftarannya di Task 2.4, supaya tidak ada peringatan dead code di commit antara.

### Task 2.2: Lapisan database (TDD)

**Files:**
- Create: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs` (hanya `mod error; mod db;`)

**Interfaces:**
- Produces:
  - `db::Db { path: PathBuf, open_error: Option<String> }` dengan `Db::open_at(PathBuf) -> Db` dan `Db::conn(&self) -> Result<MutexGuard<'_, Connection>, AppError>`.
  - `db::open(&Path) -> Result<Connection, AppError>`
  - `db::open_in_memory() -> Connection` (hanya `#[cfg(test)]`)
  - `db::vacuum_into(&Connection, &Path) -> Result<(), AppError>`
  - `db::migrate(&mut Connection, &[&str], Option<&Path>) -> Result<(), AppError>`
  - `db::MIGRATIONS`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src-tauri/src/db.rs` yang untuk sementara hanya berisi modul test berikut:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    const M1: &str = "CREATE TABLE a (x INTEGER);";
    const M2: &str = "CREATE TABLE b (y INTEGER);";

    fn version(conn: &Connection) -> i64 {
        conn.pragma_query_value(None, "user_version", |r| r.get(0)).unwrap()
    }

    #[test]
    fn fresh_database_gets_all_migrations_and_pragmas() {
        let conn = open_in_memory();
        assert_eq!(version(&conn), MIGRATIONS.len() as i64);
        let fk: i64 = conn.pragma_query_value(None, "foreign_keys", |r| r.get(0)).unwrap();
        assert_eq!(fk, 1);
        conn.execute("SELECT id, type, title, body, parent_id, due_at, created_at, updated_at, opened_at, deleted_at FROM items", [])
            .unwrap();
    }

    #[test]
    fn upgrade_backs_up_old_version_first() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("anchoa.db");
        let mut conn = Connection::open(&path).unwrap();
        migrate(&mut conn, &[M1], Some(&path)).unwrap();
        conn.execute("INSERT INTO a VALUES (42)", []).unwrap();

        migrate(&mut conn, &[M1, M2], Some(&path)).unwrap();

        assert_eq!(version(&conn), 2);
        let backup = Connection::open(dir.path().join("anchoa.db.bak-v1")).unwrap();
        assert_eq!(version(&backup), 1);
        let x: i64 = backup.query_row("SELECT x FROM a", [], |r| r.get(0)).unwrap();
        assert_eq!(x, 42);
    }

    #[test]
    fn failed_migration_rolls_back() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn, &[M1], None).unwrap();
        let err = migrate(&mut conn, &[M1, "CREATE TABLE broken (;"], None);
        assert!(err.is_err());
        assert_eq!(version(&conn), 1);
    }

    #[test]
    fn refuses_database_from_newer_app() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn, &[M1, M2], None).unwrap();
        assert!(matches!(migrate(&mut conn, &[M1], None), Err(AppError::DbTooNew(2))));
    }

    #[test]
    fn corrupt_file_is_reported_and_left_untouched() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("anchoa.db");
        let garbage = vec![7u8; 4096];
        std::fs::write(&path, &garbage).unwrap();

        let db = Db::open_at(path.clone());

        assert!(db.open_error.is_some());
        assert!(matches!(db.conn(), Err(AppError::DbUnavailable)));
        assert_eq!(std::fs::read(&path).unwrap(), garbage);
    }
}
```

Tambahkan di baris paling atas `src-tauri/src/lib.rs`:

```rust
mod db;
mod error;
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd src-tauri && cargo test db:: ; cd ..`
Expected: FAIL saat compile, dengan `cannot find function 'open_in_memory'` dan `cannot find type 'Connection'`.

- [ ] **Step 3: Implementasi**

Tambahkan kode berikut **di atas** modul test di `src-tauri/src/db.rs`:

```rust
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use rusqlite::Connection;

use crate::error::AppError;

pub const MIGRATIONS: &[&str] = &[include_str!("../migrations/001_init.sql")];

/// Managed Tauri state. When the database fails to open, `conn` is `None`
/// and the frontend shows an error screen; no new database is created.
pub struct Db {
    conn: Option<Mutex<Connection>>,
    pub path: PathBuf,
    pub open_error: Option<String>,
}

impl Db {
    pub fn open_at(path: PathBuf) -> Db {
        match open(&path) {
            Ok(conn) => Db { conn: Some(Mutex::new(conn)), path, open_error: None },
            Err(e) => Db { conn: None, path, open_error: Some(e.to_string()) },
        }
    }

    pub fn conn(&self) -> Result<MutexGuard<'_, Connection>, AppError> {
        let conn = self.conn.as_ref().ok_or(AppError::DbUnavailable)?;
        conn.lock().map_err(|_| AppError::DbUnavailable)
    }
}

pub fn open(path: &Path) -> Result<Connection, AppError> {
    let mut conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&mut conn, MIGRATIONS, Some(path))?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    configure(&conn).unwrap();
    migrate(&mut conn, MIGRATIONS, None).unwrap();
    conn
}

fn configure(conn: &Connection) -> Result<(), AppError> {
    conn.busy_timeout(Duration::from_millis(5000))?;
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))?;
    Ok(())
}

/// Consistent copy of the live database, safe while it is open.
pub fn vacuum_into(conn: &Connection, dest: &Path) -> Result<(), AppError> {
    conn.execute("VACUUM INTO ?1", [dest.to_string_lossy()])?;
    Ok(())
}

/// Applies `migrations[user_version..]`, one transaction each. An existing
/// database is copied to `<db>.bak-v<old version>` first.
pub fn migrate(conn: &mut Connection, migrations: &[&str], db_path: Option<&Path>) -> Result<(), AppError> {
    let current: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let latest = migrations.len() as i64;
    if current > latest {
        return Err(AppError::DbTooNew(current));
    }
    if current == latest {
        return Ok(());
    }
    if current > 0 && let Some(path) = db_path {
        let backup = PathBuf::from(format!("{}.bak-v{current}", path.display()));
        if !backup.exists() {
            vacuum_into(conn, &backup)?;
        }
    }
    for (i, sql) in migrations.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", i as i64 + 1)?;
        tx.commit()?;
    }
    Ok(())
}
```

- [ ] **Step 4: Jalankan test**

Run: `cd src-tauri && cargo test db:: ; cd ..`
Expected: `5 passed`. Di tahap ini `cargo clippy` masih akan memperingatkan dead code, karena `Db` belum dipakai di luar test. Peringatan itu hilang di Task 2.4.

- [ ] **Step 5: Commit**

```bash
git add src-tauri
git commit -m "feat: add SQLite layer with migrations and pre-migration backup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2.3: Operasi item (TDD)

**Files:**
- Create: `src-tauri/src/items.rs`
- Modify: `src-tauri/src/lib.rs` (tambah `mod items;`)

**Interfaces:**
- Consumes: `db::open_in_memory` dan `AppError`.
- Produces:
  - `Item { id, kind (JSON: "type"), title, body, parent_id, due_at, created_at, updated_at, opened_at }`, diserialisasi ke camelCase.
  - `ItemSummary { id, kind (JSON: "type"), title, due_at, last_activity_at }`, diserialisasi ke camelCase.
  - `ItemPatch { title: Option<String>, body: Option<String>, due_at: Option<Option<i64>> }`, dideserialisasi dari camelCase.
  - `summaries(&Connection, clause: &str, params) -> Result<Vec<ItemSummary>, AppError>`
  - `get`, `capture_note(&Connection, &str, now)`, `open(&Connection, &str, now)`, `update(&Connection, &str, &ItemPatch, now)`, `delete(&Connection, &str, now)`, `list_inbox(&Connection)`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src-tauri/src/items.rs` berisi modul test saja, lalu tambahkan `mod items;` di `lib.rs`.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;

    #[test]
    fn capture_trims_text_into_an_inbox_note() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "  beli kopi  ", 1000).unwrap();
        assert_eq!(item.kind, "note");
        assert_eq!(item.title, "beli kopi");
        assert_eq!(item.parent_id, None);
        assert_eq!((item.created_at, item.updated_at), (1000, 1000));
        assert_eq!(uuid::Uuid::parse_str(&item.id).unwrap().get_version_num(), 7);
    }

    #[test]
    fn capture_rejects_blank_text() {
        let conn = open_in_memory();
        assert!(matches!(capture_note(&conn, "   ", 1000), Err(AppError::Empty)));
        assert!(list_inbox(&conn).unwrap().is_empty());
    }

    #[test]
    fn open_sets_opened_at_only() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "a", 1000).unwrap();
        let opened = open(&conn, &item.id, 5000).unwrap();
        assert_eq!(opened.opened_at, Some(5000));
        assert_eq!(opened.updated_at, 1000);
    }

    #[test]
    fn update_changes_only_sent_fields() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "a", 1000).unwrap();
        let patch = ItemPatch { body: Some("isi".into()), due_at: Some(Some(9000)), ..Default::default() };
        let updated = update(&conn, &item.id, &patch, 2000).unwrap();
        assert_eq!(updated.title, "a");
        assert_eq!(updated.body, "isi");
        assert_eq!(updated.due_at, Some(9000));
        assert_eq!(updated.updated_at, 2000);
    }

    #[test]
    fn update_with_null_due_clears_it() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "a", 1000).unwrap();
        update(&conn, &item.id, &ItemPatch { due_at: Some(Some(9000)), ..Default::default() }, 2000).unwrap();
        let cleared = update(&conn, &item.id, &ItemPatch { due_at: Some(None), ..Default::default() }, 3000).unwrap();
        assert_eq!(cleared.due_at, None);
    }

    #[test]
    fn empty_patch_does_not_touch_updated_at() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "a", 1000).unwrap();
        let same = update(&conn, &item.id, &ItemPatch::default(), 2000).unwrap();
        assert_eq!(same.updated_at, 1000);
    }

    #[test]
    fn patch_json_distinguishes_missing_from_null() {
        let missing: ItemPatch = serde_json_from(r#"{"title":"x"}"#);
        assert_eq!(missing.due_at, None);
        let null: ItemPatch = serde_json_from(r#"{"dueAt":null}"#);
        assert_eq!(null.due_at, Some(None));
        let set: ItemPatch = serde_json_from(r#"{"dueAt":5}"#);
        assert_eq!(set.due_at, Some(Some(5)));
    }

    fn serde_json_from(json: &str) -> ItemPatch {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn deleted_items_disappear() {
        let conn = open_in_memory();
        let item = capture_note(&conn, "a", 1000).unwrap();
        delete(&conn, &item.id, 2000).unwrap();
        assert!(matches!(get(&conn, &item.id), Err(AppError::NotFound)));
        assert!(matches!(open(&conn, &item.id, 3000), Err(AppError::NotFound)));
        assert!(matches!(delete(&conn, &item.id, 3000), Err(AppError::NotFound)));
        assert!(list_inbox(&conn).unwrap().is_empty());
    }

    #[test]
    fn inbox_lists_newest_first() {
        let conn = open_in_memory();
        capture_note(&conn, "lama", 1000).unwrap();
        capture_note(&conn, "baru", 2000).unwrap();
        let titles: Vec<String> = list_inbox(&conn).unwrap().into_iter().map(|s| s.title).collect();
        assert_eq!(titles, ["baru", "lama"]);
    }

    #[test]
    fn unknown_id_is_not_found() {
        let conn = open_in_memory();
        assert!(matches!(update(&conn, "nope", &ItemPatch { title: Some("x".into()), ..Default::default() }, 1), Err(AppError::NotFound)));
    }
}
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd src-tauri && cargo test items:: ; cd ..`
Expected: FAIL saat compile, dengan `cannot find function 'capture_note'`.

- [ ] **Step 3: Implementasi**

Tambahkan kode berikut di atas modul test di `src-tauri/src/items.rs`:

```rust
use rusqlite::{Connection, OptionalExtension, Params, Row, params};
use serde::{Deserialize, Deserializer, Serialize};

use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub title: String,
    pub body: String,
    pub parent_id: Option<String>,
    pub due_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub opened_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSummary {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub title: String,
    pub due_at: Option<i64>,
    pub last_activity_at: i64,
}

/// Fields sent by the item page. A missing field is left unchanged;
/// `dueAt: null` clears the due date.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPatch {
    pub title: Option<String>,
    pub body: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub due_at: Option<Option<i64>>,
}

fn present<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<i64>>, D::Error> {
    Option::<i64>::deserialize(d).map(Some)
}

const ITEM_COLUMNS: &str = "id, type, title, body, parent_id, due_at, created_at, updated_at, opened_at";

fn item_from_row(r: &Row) -> rusqlite::Result<Item> {
    Ok(Item {
        id: r.get(0)?,
        kind: r.get(1)?,
        title: r.get(2)?,
        body: r.get(3)?,
        parent_id: r.get(4)?,
        due_at: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
        opened_at: r.get(8)?,
    })
}

/// Live (not deleted) items matching `clause`, which is SQL placed after
/// `WHERE deleted_at IS NULL AND`; it may end with ORDER BY / LIMIT.
pub fn summaries(conn: &Connection, clause: &str, params: impl Params) -> Result<Vec<ItemSummary>, AppError> {
    let sql = format!(
        "SELECT id, type, title, due_at, MAX(created_at, updated_at, COALESCE(opened_at, 0)) AS last_activity_at
         FROM items WHERE deleted_at IS NULL AND {clause}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params, |r| {
        Ok(ItemSummary { id: r.get(0)?, kind: r.get(1)?, title: r.get(2)?, due_at: r.get(3)?, last_activity_at: r.get(4)? })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn get(conn: &Connection, id: &str) -> Result<Item, AppError> {
    conn.query_row(
        &format!("SELECT {ITEM_COLUMNS} FROM items WHERE id = ?1 AND deleted_at IS NULL"),
        [id],
        item_from_row,
    )
    .optional()?
    .ok_or(AppError::NotFound)
}

pub fn capture_note(conn: &Connection, text: &str, now: i64) -> Result<Item, AppError> {
    let title = text.trim();
    if title.is_empty() {
        return Err(AppError::Empty);
    }
    let id = uuid::Uuid::now_v7().to_string();
    conn.execute(
        "INSERT INTO items (id, type, title, created_at, updated_at) VALUES (?1, 'note', ?2, ?3, ?3)",
        params![id, title, now],
    )?;
    get(conn, &id)
}

/// Marks the item as opened. Does not touch `updated_at`.
pub fn open(conn: &Connection, id: &str, now: i64) -> Result<Item, AppError> {
    let changed = conn.execute(
        "UPDATE items SET opened_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    get(conn, id)
}

pub fn update(conn: &Connection, id: &str, patch: &ItemPatch, now: i64) -> Result<Item, AppError> {
    if patch.title.is_none() && patch.body.is_none() && patch.due_at.is_none() {
        return get(conn, id);
    }
    let changed = conn.execute(
        "UPDATE items SET
           title = COALESCE(?2, title),
           body = COALESCE(?3, body),
           due_at = CASE WHEN ?4 THEN ?5 ELSE due_at END,
           updated_at = ?6
         WHERE id = ?1 AND deleted_at IS NULL",
        params![id, patch.title, patch.body, patch.due_at.is_some(), patch.due_at.flatten(), now],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: &str, now: i64) -> Result<(), AppError> {
    let changed = conn.execute(
        "UPDATE items SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub fn list_inbox(conn: &Connection) -> Result<Vec<ItemSummary>, AppError> {
    summaries(conn, "parent_id IS NULL ORDER BY created_at DESC, id DESC", [])
}
```

- [ ] **Step 4: Jalankan test**

Run: `cd src-tauri && cargo test ; cd ..`
Expected: `18 passed` (3 gpu, 5 db, 10 items).

- [ ] **Step 5: Commit**

```bash
git add src-tauri
git commit -m "feat: add item operations (capture, open, update, delete, inbox)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2.4: Command Tauri dan wiring

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (isi penuh), `scripts/e2e-smoke.sh` (`check_shell`)

**Interfaces:**
- Produces (nama command untuk `invoke`):
  - `db_status() -> { path, error }`
  - `open_folder(kind: "data" | "log")`
  - `capture_note(text)`
  - `open_item(id)`
  - `update_item(id, patch)`
  - `delete_item(id)`
  - `list_inbox()`

- [ ] **Step 1: Tulis `src-tauri/src/commands.rs`**

```rust
//! Thin Tauri glue: every function here only resolves state and delegates.
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::db::Db;
use crate::error::AppError;
use crate::items::{self, Item, ItemPatch, ItemSummary};
use crate::time;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStatus {
    pub path: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn db_status(db: State<'_, Db>) -> DbStatus {
    DbStatus { path: db.path.display().to_string(), error: db.open_error.clone() }
}

#[tauri::command]
pub fn capture_note(db: State<'_, Db>, text: String) -> Result<Item, AppError> {
    items::capture_note(&*db.conn()?, &text, time::now_ms())
}

#[tauri::command]
pub fn open_item(db: State<'_, Db>, id: String) -> Result<Item, AppError> {
    items::open(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn update_item(db: State<'_, Db>, id: String, patch: ItemPatch) -> Result<Item, AppError> {
    items::update(&*db.conn()?, &id, &patch, time::now_ms())
}

#[tauri::command]
pub fn delete_item(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    items::delete(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn list_inbox(db: State<'_, Db>) -> Result<Vec<ItemSummary>, AppError> {
    items::list_inbox(&*db.conn()?)
}

/// Opens one of the app's own folders in the file manager. The frontend
/// never passes a path, so it cannot open anything else.
#[tauri::command]
pub fn open_folder(app: AppHandle, kind: String) -> Result<(), AppError> {
    let dir = match kind.as_str() {
        "data" => app.path().app_data_dir()?,
        "log" => app.path().app_log_dir()?,
        other => return Err(AppError::Other(format!("folder tidak dikenal: {other}"))),
    };
    std::fs::create_dir_all(&dir)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))
}
```

`&*db.conn()?` wajib memakai `*`: deref coercion tidak berlaku lewat operator `?`.

- [ ] **Step 2: Tulis ulang `src-tauri/src/lib.rs`**

```rust
mod commands;
mod db;
mod error;
mod gpu;
mod items;
mod time;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Must stay first: it may call set_var, which is only sound before other threads start.
    let gpu_node = gpu::apply_linux_workaround();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            if let Some(node) = &gpu_node {
                log::info!("NVIDIA workaround: WEBKIT_WEB_RENDER_DEVICE_FILE={node}");
            }
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let db = db::Db::open_at(data_dir.join("anchoa.db"));
            if let Some(e) = &db.open_error {
                log::error!("database open failed: {e}");
            }
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_status,
            commands::open_folder,
            commands::capture_note,
            commands::open_item,
            commands::update_item,
            commands::delete_item,
            commands::list_inbox,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Tambahkan pengecekan DB ke `check_shell` di `scripts/e2e-smoke.sh`**

```bash
check_shell() {
  fresh
  start_app
  shot 1-shell
  stop_app
  [ "$(sql 'PRAGMA user_version')" = 1 ] || fail "database not created or not migrated"
}
```

- [ ] **Step 4: Verifikasi**

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test && cd .. && bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`
Expected: clippy bersih, `18 passed`, dan `PASS`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri scripts/e2e-smoke.sh
git commit -m "feat: expose database status and item commands to the frontend

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2.5: Buka PR #2

- [ ] **Step 1: Verifikasi penuh** (sesuai "Siklus setiap PR" langkah 3, tanpa `bun run test`).
- [ ] **Step 2: Push dan buat PR**

```bash
git push -u origin feat/2-database
gh pr create --title "Fondasi database dan command item" --body "$(cat <<'EOF'
## Ringkasan
- SQLite (WAL, foreign_keys, busy_timeout), migrasi per transaksi, backup `.bak-v{n}` sebelum migrasi
- DB rusak atau versi lebih baru: dilaporkan lewat `db_status`, file tidak disentuh
- AppError -> `{ code, message }`
- Command: capture_note, open_item, update_item (patch), delete_item (soft), list_inbox, open_folder

## Verifikasi
- cargo test: 18 passed; clippy -D warnings bersih
- e2e-smoke: PASS (DB dibuat, user_version = 1)

Closes #2

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Review sendiri, serahkan ke user, merge setelah user bilang "merge"**

```bash
gh pr merge --squash --delete-branch && git switch main && git pull
```

---

## PR #3: UI item (`feat/3-items-ui`, Closes #3)

### Task 3.1: Test runner frontend dan helper format (TDD)

**Files:**
- Modify: `package.json` (script `test`), `tsconfig.json` (`types`), `.github/workflows/ci.yml`, `CLAUDE.md`
- Create: `src/format.ts`, `src/format.test.ts`

**Interfaces:**
- Produces: `relativeTime(then, now)`, `shortDate(ms)`, `dateInputToMs(value) -> number | null`, `msToDateInput(ms | null) -> string`

- [ ] **Step 1: Buat branch dan pasang tipe bun**

```bash
git switch main && git pull && git switch -c feat/3-items-ui
bun add -d @types/bun
```

- [ ] **Step 2: Tambah script test dan tipe**

Di `package.json`, ganti objek `scripts` menjadi:

```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "TZ=Asia/Jakarta bun test src",
    "tauri": "tauri"
  },
```

Di `tsconfig.json`, ganti `"types": ["vite/client"]` menjadi:

```json
"types": ["vite/client", "bun"]
```

Di `.github/workflows/ci.yml`, tambahkan langkah ini setelah `- run: bun run typecheck`:

```yaml
      - run: bun run test
```

Di `CLAUDE.md` bagian Commands, tambahkan setelah baris `bun run typecheck`:

```
- `bun run test`: frontend unit tests (`bun test` with `TZ=Asia/Jakarta`). Run one file with `TZ=Asia/Jakarta bun test src/format.test.ts`.
```

- [ ] **Step 3: Tulis test yang gagal: `src/format.test.ts`**

```ts
// Run with TZ=Asia/Jakarta (see the "test" script in package.json).
import { describe, expect, test } from "bun:test";
import { dateInputToMs, msToDateInput, relativeTime, shortDate } from "./format";

const at = (iso: string) => new Date(iso).getTime();

describe("relativeTime", () => {
  const now = at("2026-09-29T14:00:00+07:00");
  test("short spans", () => {
    expect(relativeTime(now - 30_000, now)).toBe("baru saja");
    expect(relativeTime(now - 2 * 60_000, now)).toBe("2 menit lalu");
    expect(relativeTime(now - 5 * 3_600_000, now)).toBe("5 jam lalu");
  });
  test("calendar days", () => {
    expect(relativeTime(at("2026-09-28T09:00:00+07:00"), now)).toBe("kemarin");
    expect(relativeTime(at("2026-09-26T09:00:00+07:00"), now)).toBe("3 hari lalu");
    expect(relativeTime(at("2026-09-12T09:00:00+07:00"), now)).toBe("12 Sep");
  });
});

describe("dates", () => {
  test("short Indonesian date", () => {
    expect(shortDate(at("2026-09-12T08:00:00+07:00"))).toBe("12 Sep");
  });
  test("date input round trip uses local midnight", () => {
    expect(dateInputToMs("2026-10-01")).toBe(at("2026-10-01T00:00:00+07:00"));
    expect(msToDateInput(at("2026-10-01T00:00:00+07:00"))).toBe("2026-10-01");
    expect(dateInputToMs("")).toBeNull();
    expect(msToDateInput(null)).toBe("");
  });
});
```

- [ ] **Step 4: Jalankan test, pastikan gagal**

Run: `bun run test`
Expected: FAIL dengan `Cannot find module './format'`.

- [ ] **Step 5: Implementasi `src/format.ts`**

```ts
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "12 Sep" */
export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

export function relativeTime(then: number, now: number): string {
  const diff = now - then;
  if (diff < MINUTE) return "baru saja";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} menit lalu`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} jam lalu`;
  // Math.round absorbs 23/25-hour days around DST changes.
  const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY);
  if (days <= 1) return "kemarin";
  if (days < 7) return `${days} hari lalu`;
  return shortDate(then);
}

/** `<input type="date">` value ("2026-10-01") to local midnight in epoch ms. */
export function dateInputToMs(value: string): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
}

export function msToDateInput(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
```

- [ ] **Step 6: Jalankan test dan typecheck**

Run: `bun run test && bun run typecheck`
Expected: `4 pass, 0 fail`. `tsc` tanpa output.

- [ ] **Step 7: Commit**

```bash
git add package.json bun.lock tsconfig.json .github/workflows/ci.yml CLAUDE.md src/format.ts src/format.test.ts
git commit -m "feat: add date/time formatting helpers with bun tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.2: `api.ts`, toast, dan layar error DB

**Files:**
- Create: `src/api.ts`, `src/shell/toast.tsx`, `src/shell/ErrorScreen.tsx`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: command dari Task 2.4.
- Produces:
  - `api.dbStatus`, `api.openFolder`, `api.captureNote`, `api.openItem`, `api.updateItem`, `api.deleteItem`, `api.listInbox`
  - `errorMessage(e)`
  - tipe `Item`, `ItemSummary`, `ItemPatch`, `DbStatus`, `FolderKind`
  - `ToastProvider` dan `useToast() -> (text, kind?) => void`
  - `ErrorScreen({ path, message })`

- [ ] **Step 1: Tulis `src/api.ts`**

```ts
// The only module that talks to the Rust backend.
import { invoke } from "@tauri-apps/api/core";

export interface Item {
  id: string;
  type: string;
  title: string;
  body: string;
  parentId: string | null;
  dueAt: number | null;
  createdAt: number;
  updatedAt: number;
  openedAt: number | null;
}

export interface ItemSummary {
  id: string;
  type: string;
  title: string;
  dueAt: number | null;
  lastActivityAt: number;
}

/** Omitted fields stay unchanged; `dueAt: null` clears the due date. */
export interface ItemPatch {
  title?: string;
  body?: string;
  dueAt?: number | null;
}

export interface DbStatus {
  path: string;
  error: string | null;
}

export type FolderKind = "data" | "log";

export const api = {
  dbStatus: () => invoke<DbStatus>("db_status"),
  openFolder: (kind: FolderKind) => invoke<void>("open_folder", { kind }),
  captureNote: (text: string) => invoke<Item>("capture_note", { text }),
  openItem: (id: string) => invoke<Item>("open_item", { id }),
  updateItem: (id: string, patch: ItemPatch) => invoke<Item>("update_item", { id, patch }),
  deleteItem: (id: string) => invoke<void>("delete_item", { id }),
  listInbox: () => invoke<ItemSummary[]>("list_inbox"),
};

/** Backend errors arrive as `{ code, message }`. */
export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}
```

- [ ] **Step 2: Tulis `src/shell/toast.tsx`**

```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Kind = "info" | "error";
type Toast = { id: number; text: string; kind: Kind };

const ToastContext = createContext<(text: string, kind?: Kind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((text: string, kind: Kind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-md px-4 py-2 text-sm shadow-lg ${
              t.kind === "error" ? "bg-red-600 text-white" : "bg-neutral-800 text-white dark:bg-neutral-200 dark:text-neutral-900"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
```

- [ ] **Step 3: Tulis `src/shell/ErrorScreen.tsx`**

```tsx
import { api } from "../api";

export function ErrorScreen({ path, message }: { path: string; message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-lg flex-col gap-4">
        <h1 className="text-xl font-bold">Database tidak bisa dibuka</h1>
        <p className="text-sm">{message}</p>
        <p className="break-all rounded bg-neutral-100 p-2 font-mono text-xs dark:bg-neutral-900">{path}</p>
        <p className="text-sm text-neutral-500">
          File ini tidak diubah. Periksa izin file atau pulihkan dari folder backup, lalu buka ulang aplikasi.
        </p>
        <button
          onClick={() => void api.openFolder("data")}
          className="self-start rounded-md bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700"
        >
          Buka folder data
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Bungkus App dengan `ToastProvider` di `src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./shell/toast";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
```

- [ ] **Step 5: Typecheck dan commit**

Run: `bun run typecheck`
Expected: tanpa output.

```bash
git add src
git commit -m "feat: add backend API wrapper, toasts and database error screen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.3: Quick capture, Inbox, halaman item, dan navigasi

**Files:**
- Create: `src/shell/ItemRow.tsx`, `src/dashboard/Dashboard.tsx`, `src/dashboard/QuickCapture.tsx`, `src/inbox/Inbox.tsx`, `src/item/ItemPage.tsx`
- Modify: `src/shell/Sidebar.tsx`, `src/App.tsx`

**Interfaces:**
- Consumes: `api`, `errorMessage`, `useToast`, `format.ts`.
- Produces:
  - `ItemRow({ item, detail, onOpen })`
  - `QuickCapture({ onSaved, focusSignal })`
  - `Dashboard({ focusCapture })` (PR #4 menambah prop `onOpen`)
  - `Inbox({ onOpen })`
  - `ItemPage({ id, onBack })`

- [ ] **Step 1: Tulis `src/shell/ItemRow.tsx`**

```tsx
import type { ItemSummary } from "../api";

export function ItemRow({ item, detail, onOpen }: { item: ItemSummary; detail: string; onOpen: (id: string) => void }) {
  return (
    <button
      onClick={() => onOpen(item.id)}
      className="flex w-full justify-between gap-4 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-200 dark:hover:bg-neutral-800"
    >
      <span className="truncate">{item.title || "Tanpa judul"}</span>
      <span className="shrink-0 text-neutral-500">{detail}</span>
    </button>
  );
}
```

- [ ] **Step 2: Tulis `src/dashboard/QuickCapture.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../shell/toast";

export function QuickCapture({ onSaved, focusSignal }: { onSaved: () => void; focusSignal: number }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusSignal > 0) input.current?.focus();
  }, [focusSignal]);

  async function save() {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      await api.captureNote(text);
      setText("");
      toast("Tersimpan ke Inbox");
      onSaved();
    } catch (e) {
      // Leave the text in place so nothing typed is lost.
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      ref={input}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) void save();
      }}
      placeholder="Tulis ide cepat… (Enter = simpan ke Inbox, Ctrl+N dari mana saja)"
      aria-label="Quick capture"
      className="w-full rounded-lg border border-dashed border-neutral-300 bg-transparent px-4 py-3 outline-none focus:border-violet-500 dark:border-neutral-700"
    />
  );
}
```

- [ ] **Step 3: Tulis `src/dashboard/Dashboard.tsx` (sementara berisi quick capture saja)**

```tsx
import { QuickCapture } from "./QuickCapture";

/** Widgets arrive in PR #4; for now the dashboard is quick capture only. */
export function Dashboard({ focusCapture }: { focusCapture: number }) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <QuickCapture onSaved={() => {}} focusSignal={focusCapture} />
    </div>
  );
}
```

- [ ] **Step 4: Tulis `src/inbox/Inbox.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, errorMessage, type ItemSummary } from "../api";
import { relativeTime, shortDate } from "../format";
import { ItemRow } from "../shell/ItemRow";
import { useToast } from "../shell/toast";

export function Inbox({ onOpen }: { onOpen: (id: string) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<ItemSummary[] | null>(null);

  useEffect(() => {
    api.listInbox().then(setItems, (e) => toast(errorMessage(e), "error"));
  }, [toast]);

  const now = Date.now();
  const detail = (i: ItemSummary) =>
    [i.dueAt !== null ? `jatuh tempo ${shortDate(i.dueAt)}` : null, relativeTime(i.lastActivityAt, now)]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-bold">Inbox</h1>
      {items?.length === 0 && <p className="text-sm text-neutral-500">Inbox kosong</p>}
      {items?.map((i) => <ItemRow key={i.id} item={i} detail={detail(i)} onOpen={onOpen} />)}
    </div>
  );
}
```

- [ ] **Step 5: Tulis `src/item/ItemPage.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage, type Item, type ItemPatch } from "../api";
import { dateInputToMs, msToDateInput } from "../format";
import { useToast } from "../shell/toast";

type SaveState = "idle" | "saving" | "saved" | "failed";
const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  saving: "Menyimpan…",
  saved: "Tersimpan",
  failed: "Gagal menyimpan",
};
const AUTOSAVE_MS = 500;

export function ItemPage({ id, onBack }: { id: string; onBack: () => void }) {
  const toast = useToast();
  const [item, setItem] = useState<Item | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pending = useRef<ItemPatch>({});
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    api.openItem(id).then(setItem, (e) => setLoadError(errorMessage(e)));
  }, [id]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    pending.current = {};
    setSave("saving");
    try {
      await api.updateItem(id, patch);
      setSave("saved");
    } catch {
      // Keep the edit (newer edits win) so the next change retries it.
      pending.current = { ...patch, ...pending.current };
      setSave("failed");
    }
  }, [id]);

  // Save anything still pending when the page closes.
  useEffect(() => () => void flush(), [flush]);

  function change(patch: ItemPatch) {
    setItem((current) => (current ? { ...current, ...patch } : current));
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  }

  async function remove() {
    window.clearTimeout(timer.current);
    pending.current = {};
    try {
      await api.deleteItem(id);
      onBack();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-start gap-4">
        <p>{loadError}</p>
        <button onClick={onBack} className="text-sm text-violet-600">
          ← Kembali
        </button>
      </div>
    );
  }
  if (!item) return null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-3 text-sm">
        <button onClick={onBack} className="text-violet-600">
          ← Kembali
        </button>
        <span aria-live="polite" className={`ml-auto ${save === "failed" ? "text-red-600" : "text-neutral-500"}`}>
          {SAVE_LABEL[save]}
        </span>
        {confirmDelete ? (
          <>
            <span>Hapus item ini?</span>
            <button onClick={() => void remove()} className="rounded bg-red-600 px-2 py-1 text-white">
              Ya, hapus
            </button>
            <button onClick={() => setConfirmDelete(false)}>Batal</button>
          </>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="text-red-600">
            Hapus
          </button>
        )}
      </div>

      <input
        value={item.title}
        onChange={(e) => change({ title: e.target.value })}
        onBlur={() => void flush()}
        placeholder="Tanpa judul"
        aria-label="Judul"
        className="bg-transparent text-2xl font-bold outline-none"
      />

      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="due">Jatuh tempo</label>
        <input
          id="due"
          type="date"
          value={msToDateInput(item.dueAt)}
          onChange={(e) => change({ dueAt: dateInputToMs(e.target.value) })}
          onBlur={() => void flush()}
          // WebKit shows today's date in an empty date input; grey it out so it does not look set.
          className={`rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700 ${
            item.dueAt === null ? "text-neutral-400" : ""
          }`}
        />
        {item.dueAt !== null && (
          <button onClick={() => change({ dueAt: null })} className="text-neutral-500">
            Hapus tanggal
          </button>
        )}
      </div>

      <textarea
        value={item.body}
        onChange={(e) => change({ body: e.target.value })}
        onBlur={() => void flush()}
        placeholder="Tulis dalam Markdown…"
        aria-label="Isi"
        className="min-h-[50vh] resize-none rounded-lg border border-neutral-200 bg-transparent p-4 font-mono text-sm outline-none focus:border-violet-500 dark:border-neutral-800"
      />
    </div>
  );
}
```

- [ ] **Step 6: Tambahkan Inbox ke `src/shell/Sidebar.tsx`**

Ganti `export type TopPage = "dashboard";` menjadi:

```tsx
export type TopPage = "dashboard" | "inbox";
```

Ganti `{link("dashboard", "Dashboard")}` menjadi:

```tsx
      {link("dashboard", "Dashboard")}
      {link("inbox", "Inbox")}
```

- [ ] **Step 7: Tulis ulang `src/App.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, type DbStatus } from "./api";
import { Dashboard } from "./dashboard/Dashboard";
import { Inbox } from "./inbox/Inbox";
import { ItemPage } from "./item/ItemPage";
import { AiColumn } from "./shell/AiColumn";
import { ErrorScreen } from "./shell/ErrorScreen";
import { Sidebar, type TopPage } from "./shell/Sidebar";

type Page = { name: TopPage } | { name: "item"; id: string };

export function App() {
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [stack, setStack] = useState<Page[]>([{ name: "dashboard" }]);
  const [focusCapture, setFocusCapture] = useState(0);
  const page = stack[stack.length - 1];

  useEffect(() => {
    api.dbStatus().then(setStatus);
  }, []);

  // Ctrl+N: jump to the dashboard and focus quick capture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setStack([{ name: "dashboard" }]);
        setFocusCapture((n) => n + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!status) return null;
  if (status.error) return <ErrorScreen path={status.path} message={status.error} />;

  const openItem = (id: string) => setStack((s) => [...s, { name: "item", id }]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  return (
    <div className="flex h-full">
      <Sidebar current={page.name} onSelect={(name) => setStack([{ name }])} />
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {page.name === "dashboard" && <Dashboard focusCapture={focusCapture} />}
        {page.name === "inbox" && <Inbox onOpen={openItem} />}
        {page.name === "item" && <ItemPage key={page.id} id={page.id} onBack={back} />}
      </main>
      <AiColumn />
    </div>
  );
}
```

- [ ] **Step 8: Typecheck, test, build**

Run: `bun run typecheck && bun run test && bun run build`
Expected: semua lulus.

- [ ] **Step 9: Commit**

```bash
git add src
git commit -m "feat: add quick capture with Ctrl+N, inbox and item page with autosave

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.4: E2E untuk DB rusak dan alur item

**Files:**
- Modify: `scripts/e2e-smoke.sh`

- [ ] **Step 1: Tambahkan dua fungsi berikut setelah `check_shell`**

```bash
check_corrupt_db() {
  fresh
  mkdir -p "$APPDATA"
  head -c 4096 /dev/urandom >"$DB"
  before=$(sha256sum "$DB")
  start_app
  shot 2-corrupt-db
  stop_app
  [ "$(sha256sum "$DB")" = "$before" ] || fail "corrupt database was modified"
}

check_items() {
  fresh
  start_app
  xdotool key ctrl+n
  xdotool type --delay 20 'catatan dari e2e'
  xdotool key Return
  sleep 1
  [ "$(sql "SELECT title FROM items")" = "catatan dari e2e" ] || fail "capture not saved"

  click 43 118          # sidebar: Inbox
  shot 4-inbox
  click 300 70          # first inbox row
  click 600 400         # body textarea
  xdotool type --delay 20 'isi dari e2e'
  sleep 1.5             # autosave fires after 500 ms
  shot 4-item
  [ "$(sql "SELECT body FROM items")" = "isi dari e2e" ] || fail "autosave did not store the body"

  click 986 34          # Hapus
  shot 4-confirm
  click 921 38          # Ya, hapus
  [ -n "$(sql "SELECT deleted_at FROM items")" ] || fail "delete did not set deleted_at"
  stop_app
}
```

Lalu ganti bagian bawah skrip menjadi:

```bash
check_shell
check_corrupt_db
check_items
echo "PASS. Screenshots in $WORK"
```

- [ ] **Step 2: Jalankan dan periksa screenshot**

Run: `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`
Expected: `PASS`. Periksa screenshot berikut:
- `2-corrupt-db.png`: "Database tidak bisa dibuka", "file is not a database", path file, dan tombol "Buka folder data".
- `4-inbox.png`: satu baris "catatan dari e2e · baru saja".
- `4-item.png`: judul, input jatuh tempo abu-abu (belum di-set), dan isi "isi dari e2e".
- `4-confirm.png`: "Hapus item ini?", "Ya, hapus", dan "Batal".

Kalau ada klik yang meleset, cocokkan koordinatnya dengan screenshot, lalu perbaiki angkanya di skrip.

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-smoke.sh
git commit -m "test: cover corrupt database and item flow in e2e smoke test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3.5: Buka PR #3

- [ ] **Step 1: Verifikasi penuh** (sesuai "Siklus setiap PR" langkah 3, sekarang termasuk `bun run test`).
- [ ] **Step 2: Push dan buat PR**

```bash
git push -u origin feat/3-items-ui
gh pr create --title "UI item: quick capture, Inbox, halaman item" --body "$(cat <<'EOF'
## Ringkasan
- Quick capture di dashboard (Enter simpan, teks tetap ada kalau gagal), Ctrl+N dari halaman mana pun
- Inbox (terbaru dulu), halaman item: judul, jatuh tempo, isi Markdown, autosave 500 ms + saat blur, hapus dengan konfirmasi
- Layar error DB (file tidak disentuh) + tombol buka folder data
- Toast; test frontend pakai `bun test` (TZ=Asia/Jakarta), ikut di CI

## Verifikasi
- bun test: 4 pass; cargo test: 18 passed
- e2e-smoke: PASS (screenshot DB rusak, inbox, item, konfirmasi hapus)

Closes #3

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Review sendiri, serahkan ke user, merge setelah user bilang "merge"**

```bash
gh pr merge --squash --delete-branch && git switch main && git pull
```

---

## PR #4: Widget dashboard (`feat/4-dashboard`, Closes #4)

### Task 4.1: Batas hari lokal (TDD)

**Files:**
- Modify: `src-tauri/src/error.rs`, `src-tauri/src/time.rs`

**Interfaces:**
- Produces: `time::day_bounds(now_ms, &TimeZone) -> Result<(i64, i64), jiff::Error>` dan varian `AppError::Time(jiff::Error)`.

- [ ] **Step 1: Buat branch, lalu tulis test yang gagal di `src-tauri/src/time.rs`**

```bash
git switch main && git pull && git switch -c feat/4-dashboard
```

Tambahkan di akhir `src-tauri/src/time.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn ms(rfc3339: &str) -> i64 {
        rfc3339.parse::<Timestamp>().unwrap().as_millisecond()
    }

    #[test]
    fn day_bounds_follow_the_local_offset() {
        let jakarta = TimeZone::fixed(jiff::tz::offset(7));
        // 01:30 in Jakarta is still 28 Sep in UTC: the local date must win.
        let (start, end) = day_bounds(ms("2026-09-29T01:30:00+07:00"), &jakarta).unwrap();
        assert_eq!(start, ms("2026-09-29T00:00:00+07:00"));
        assert_eq!(end, ms("2026-09-30T00:00:00+07:00"));
    }
}
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd src-tauri && cargo test time:: ; cd ..`
Expected: FAIL saat compile, dengan `cannot find function 'day_bounds'`.

- [ ] **Step 3: Implementasi**

Ganti baris `use jiff::Timestamp;` di `src-tauri/src/time.rs` dengan:

```rust
use jiff::{Timestamp, tz::TimeZone};
```

Tambahkan setelah `now_ms`:

```rust
/// Start (inclusive) and end (exclusive) of the local day containing `now_ms`.
pub fn day_bounds(now_ms: i64, tz: &TimeZone) -> Result<(i64, i64), jiff::Error> {
    let today = Timestamp::from_millisecond(now_ms)?.to_zoned(tz.clone()).date();
    let start = today.to_zoned(tz.clone())?;
    let end = today.tomorrow()?.to_zoned(tz.clone())?;
    Ok((start.timestamp().as_millisecond(), end.timestamp().as_millisecond()))
}
```

Di `src-tauri/src/error.rs`, tambahkan varian ini setelah `Io`:

```rust
    #[error("Kesalahan waktu: {0}")]
    Time(#[from] jiff::Error),
```

Lalu tambahkan cabang ini di `code()`, setelah `AppError::Io(_) => "io",`:

```rust
            AppError::Time(_) => "time",
```

- [ ] **Step 4: Jalankan test**

Run: `cd src-tauri && cargo test time:: ; cd ..`
Expected: `1 passed`. `day_bounds` dan `AppError::Time` baru dipakai di Task 4.2, jadi peringatan dead code sementara dari clippy masih wajar.

- [ ] **Step 5: Commit**

```bash
git add src-tauri
git commit -m "feat: compute local day bounds for due-date queries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.2: Query dashboard (TDD) dan command `get_dashboard`

**Files:**
- Create: `src-tauri/src/dashboard.rs`
- Modify: `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `items::summaries`, `time::day_bounds`.
- Produces: `dashboard::get(&Connection, now, &TimeZone) -> Result<Dashboard, AppError>`, `Dashboard { today: Today { due_today, overdue }, recent }` (camelCase), `RECENT_LIMIT = 8`, dan command `get_dashboard()`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src-tauri/src/dashboard.rs` berisi modul test saja, lalu tambahkan `mod dashboard;` di `lib.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::items::{ItemPatch, capture_note, delete, open, update};
    use jiff::Timestamp;

    fn ms(rfc3339: &str) -> i64 {
        rfc3339.parse::<Timestamp>().unwrap().as_millisecond()
    }

    fn jakarta() -> TimeZone {
        TimeZone::fixed(jiff::tz::offset(7))
    }

    fn note_due(conn: &Connection, title: &str, due: &str) -> String {
        let item = capture_note(conn, title, 1).unwrap();
        update(conn, &item.id, &ItemPatch { due_at: Some(Some(ms(due))), ..Default::default() }, 1).unwrap();
        item.id
    }

    fn titles(list: &[ItemSummary]) -> Vec<&str> {
        list.iter().map(|s| s.title.as_str()).collect()
    }

    #[test]
    fn splits_due_items_by_local_day() {
        let conn = open_in_memory();
        note_due(&conn, "kemarin", "2026-09-28T00:00:00+07:00");
        note_due(&conn, "b hari ini", "2026-09-29T00:00:00+07:00");
        note_due(&conn, "a hari ini", "2026-09-29T00:00:00+07:00");
        note_due(&conn, "besok", "2026-09-30T00:00:00+07:00");
        let gone = note_due(&conn, "dihapus", "2026-09-29T00:00:00+07:00");
        delete(&conn, &gone, 2).unwrap();

        // 01:30 in Jakarta is still 28 Sep in UTC: the local day must win.
        let d = get(&conn, ms("2026-09-29T01:30:00+07:00"), &jakarta()).unwrap();

        assert_eq!(titles(&d.today.due_today), ["a hari ini", "b hari ini"]);
        assert_eq!(titles(&d.today.overdue), ["kemarin"]);
    }

    #[test]
    fn recent_is_capped_and_ordered_by_last_activity() {
        let conn = open_in_memory();
        let mut ids = Vec::new();
        for i in 0..10 {
            ids.push(capture_note(&conn, &format!("n{i}"), 1000 + i).unwrap().id);
        }
        open(&conn, &ids[0], 5000).unwrap();

        let d = get(&conn, 6000, &jakarta()).unwrap();

        assert_eq!(d.recent.len(), RECENT_LIMIT);
        assert_eq!(titles(&d.recent)[..3], ["n0", "n9", "n8"]);
        assert_eq!(d.recent[0].last_activity_at, 5000);
    }
}
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `cd src-tauri && cargo test dashboard:: ; cd ..`
Expected: FAIL saat compile, dengan `cannot find function 'get'` dan `cannot find type 'TimeZone'`.

- [ ] **Step 3: Implementasi di atas modul test**

```rust
use jiff::tz::TimeZone;
use rusqlite::{Connection, params};
use serde::Serialize;

use crate::error::AppError;
use crate::items::{ItemSummary, summaries};
use crate::time::day_bounds;

pub const RECENT_LIMIT: usize = 8;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Today {
    pub due_today: Vec<ItemSummary>,
    pub overdue: Vec<ItemSummary>,
}

/// Fase 2 adds a `finance` field.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub today: Today,
    pub recent: Vec<ItemSummary>,
}

pub fn get(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Dashboard, AppError> {
    let (start, end) = day_bounds(now, tz)?;
    Ok(Dashboard {
        today: Today {
            due_today: summaries(conn, "due_at >= ?1 AND due_at < ?2 ORDER BY due_at, title", params![start, end])?,
            overdue: summaries(conn, "due_at < ?1 ORDER BY due_at, title", params![start])?,
        },
        recent: summaries(
            conn,
            "1 ORDER BY last_activity_at DESC, id DESC LIMIT ?1",
            params![RECENT_LIMIT as i64],
        )?,
    })
}
```

- [ ] **Step 4: Tambah command**

Di `src-tauri/src/commands.rs`, tambahkan import:

```rust
use crate::dashboard::{self, Dashboard};
```

Lalu tambahkan fungsi setelah `list_inbox`:

```rust
#[tauri::command]
pub fn get_dashboard(db: State<'_, Db>) -> Result<Dashboard, AppError> {
    dashboard::get(&*db.conn()?, time::now_ms(), &jiff::tz::TimeZone::system())
}
```

Di `src-tauri/src/lib.rs`, tambahkan `commands::get_dashboard,` ke `generate_handler!` setelah `commands::list_inbox,`.

- [ ] **Step 5: Jalankan test dan clippy**

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test ; cd ..`
Expected: clippy bersih, `21 passed`.

- [ ] **Step 6: Commit**

```bash
git add src-tauri
git commit -m "feat: add dashboard query with today, overdue and recent items

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.3: Widget di frontend (TDD untuk sapaan dan tanggal)

**Files:**
- Modify: `src/format.ts`, `src/format.test.ts`, `src/api.ts`, `src/dashboard/Dashboard.tsx`, `src/App.tsx`
- Create: `src/shell/Card.tsx`, `src/dashboard/TodayWidget.tsx`, `src/dashboard/FinanceWidget.tsx`, `src/dashboard/RecentWidget.tsx`

**Interfaces:**
- Produces: `greeting(hour)`, `fullDate(ms)`, `api.getDashboard`, tipe `Dashboard`, `Card({ title, children })`, dan `Dashboard({ onOpen, focusCapture })`.

- [ ] **Step 1: Tulis test yang gagal**

Di `src/format.test.ts`, ganti baris import menjadi:

```ts
import { dateInputToMs, fullDate, greeting, msToDateInput, relativeTime, shortDate } from "./format";
```

Tambahkan di akhir file:

```ts
describe("greeting", () => {
  test("follows the hour boundaries", () => {
    expect(greeting(4)).toBe("Selamat pagi");
    expect(greeting(10)).toBe("Selamat pagi");
    expect(greeting(11)).toBe("Selamat siang");
    expect(greeting(14)).toBe("Selamat siang");
    expect(greeting(15)).toBe("Selamat sore");
    expect(greeting(17)).toBe("Selamat sore");
    expect(greeting(18)).toBe("Selamat malam");
    expect(greeting(3)).toBe("Selamat malam");
  });
});

describe("fullDate", () => {
  test("weekday, day and month in Indonesian", () => {
    expect(fullDate(at("2026-09-29T08:00:00+07:00"))).toBe("Selasa, 29 September");
  });
});
```

Run: `bun run test`
Expected: FAIL dengan `Export named 'fullDate' not found`.

- [ ] **Step 2: Implementasi di `src/format.ts`**

Tambahkan setelah fungsi `startOfDay`:

```ts
export function greeting(hour: number): string {
  if (hour >= 4 && hour < 11) return "Selamat pagi";
  if (hour >= 11 && hour < 15) return "Selamat siang";
  if (hour >= 15 && hour < 18) return "Selamat sore";
  return "Selamat malam";
}

/** "Selasa, 29 September" */
export function fullDate(ms: number): string {
  return new Date(ms).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
}
```

Run: `bun run test`
Expected: `6 pass, 0 fail`.

- [ ] **Step 3: Tambah ke `src/api.ts`**

Tambahkan interface setelah `ItemPatch`:

```ts
export interface Dashboard {
  today: { dueToday: ItemSummary[]; overdue: ItemSummary[] };
  recent: ItemSummary[];
}
```

Tambahkan ke objek `api`, setelah `listInbox`:

```ts
  getDashboard: () => invoke<Dashboard>("get_dashboard"),
```

- [ ] **Step 4: Tulis `src/shell/Card.tsx`**

```tsx
import type { ReactNode } from "react";

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children}
    </section>
  );
}
```

- [ ] **Step 5: Tulis ketiga widget**

`src/dashboard/TodayWidget.tsx`:

```tsx
import type { Dashboard } from "../api";
import { fullDate, greeting, shortDate } from "../format";
import { Card } from "../shell/Card";
import { ItemRow } from "../shell/ItemRow";

export function TodayWidget({ today, onOpen }: { today?: Dashboard["today"]; onOpen: (id: string) => void }) {
  const now = new Date();
  const empty = today && today.overdue.length === 0 && today.dueToday.length === 0;

  return (
    <Card title="Hari ini">
      <p className="text-sm text-neutral-500">
        {fullDate(now.getTime())} · {greeting(now.getHours())}
      </p>
      {today && today.overdue.length > 0 && (
        <>
          <h3 className="mt-3 text-xs font-semibold uppercase text-red-600">Terlambat</h3>
          {today.overdue.map((i) => (
            <ItemRow key={i.id} item={i} detail={shortDate(i.dueAt ?? 0)} onOpen={onOpen} />
          ))}
        </>
      )}
      {today && today.dueToday.length > 0 && (
        <>
          <h3 className="mt-3 text-xs font-semibold uppercase text-neutral-500">Jatuh tempo hari ini</h3>
          {today.dueToday.map((i) => (
            <ItemRow key={i.id} item={i} detail="hari ini" onOpen={onOpen} />
          ))}
        </>
      )}
      {empty && <p className="mt-3 text-sm text-neutral-500">Tidak ada jatuh tempo hari ini</p>}
    </Card>
  );
}
```

`src/dashboard/FinanceWidget.tsx`:

```tsx
import { Card } from "../shell/Card";

/** Fase 2 fills this from the finance module. */
export function FinanceWidget() {
  return (
    <Card title="Keuangan bulan ini">
      <p className="text-sm text-neutral-500">Modul keuangan belum aktif</p>
    </Card>
  );
}
```

`src/dashboard/RecentWidget.tsx`:

```tsx
import type { ItemSummary } from "../api";
import { relativeTime } from "../format";
import { Card } from "../shell/Card";
import { ItemRow } from "../shell/ItemRow";

export function RecentWidget({ items, onOpen }: { items?: ItemSummary[]; onOpen: (id: string) => void }) {
  const now = Date.now();
  return (
    <Card title="Item terbaru">
      {items?.length === 0 && <p className="text-sm text-neutral-500">Belum ada item</p>}
      {items?.map((i) => (
        <ItemRow key={i.id} item={i} detail={relativeTime(i.lastActivityAt, now)} onOpen={onOpen} />
      ))}
    </Card>
  );
}
```

- [ ] **Step 6: Tulis ulang `src/dashboard/Dashboard.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type Dashboard as DashboardData } from "../api";
import { useToast } from "../shell/toast";
import { FinanceWidget } from "./FinanceWidget";
import { QuickCapture } from "./QuickCapture";
import { RecentWidget } from "./RecentWidget";
import { TodayWidget } from "./TodayWidget";

export function Dashboard({ onOpen, focusCapture }: { onOpen: (id: string) => void; focusCapture: number }) {
  const toast = useToast();
  const [data, setData] = useState<DashboardData | null>(null);

  const load = useCallback(() => {
    api.getDashboard().then(setData, (e) => toast(errorMessage(e), "error"));
  }, [toast]);

  useEffect(load, [load]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <QuickCapture onSaved={load} focusSignal={focusCapture} />
      <div className="grid grid-cols-2 gap-4">
        <TodayWidget today={data?.today} onOpen={onOpen} />
        <FinanceWidget />
        <div className="col-span-2">
          <RecentWidget items={data?.recent} onOpen={onOpen} />
        </div>
      </div>
    </div>
  );
}
```

Di `src/App.tsx`, ganti `<Dashboard focusCapture={focusCapture} />` menjadi:

```tsx
<Dashboard onOpen={openItem} focusCapture={focusCapture} />
```

- [ ] **Step 7: Typecheck, test, build, lalu commit**

Run: `bun run typecheck && bun run test && bun run build`
Expected: semua lulus.

```bash
git add src
git commit -m "feat: add Today, Finance and Recent dashboard widgets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.4: E2E dashboard

**Files:**
- Modify: `scripts/e2e-smoke.sh`

- [ ] **Step 1: Tambahkan fungsi berikut setelah `check_items`, lalu panggil `check_dashboard` sebelum baris `echo "PASS..."`**

```bash
check_dashboard() {
  fresh
  start_app
  xdotool key ctrl+n
  xdotool type --delay 20 'tugas hari ini'
  xdotool key Return
  sleep 1
  xdotool type --delay 20 'tugas terlambat'
  xdotool key Return
  sleep 1
  sql "UPDATE items SET due_at = CAST(strftime('%s', 'now', 'localtime', 'start of day', 'utc') AS INTEGER) * 1000 WHERE title = 'tugas hari ini'"
  sql "UPDATE items SET due_at = CAST(strftime('%s', 'now', 'localtime', 'start of day', '-1 day', 'utc') AS INTEGER) * 1000 WHERE title = 'tugas terlambat'"
  click 43 118          # Inbox, then back to Dashboard so it reloads
  click 60 78
  shot 5-dashboard      # expect: Terlambat + Jatuh tempo hari ini + both in Item terbaru
  stop_app
}
```

- [ ] **Step 2: Jalankan dan periksa screenshot**

Run: `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`
Expected: `PASS`. Di `5-dashboard.png`, widget "Hari ini" menampilkan tanggal dan sapaan, bagian TERLAMBAT berisi "tugas terlambat" (tanggal kemarin), dan bagian JATUH TEMPO HARI INI berisi "tugas hari ini". "Keuangan bulan ini" menampilkan "Modul keuangan belum aktif". "Item terbaru" berisi kedua item dengan keterangan "baru saja".

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-smoke.sh
git commit -m "test: cover dashboard widgets in e2e smoke test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4.5: Buka PR #4

- [ ] **Step 1: Verifikasi penuh** (sesuai "Siklus setiap PR" langkah 3).
- [ ] **Step 2: Push dan buat PR**

```bash
git push -u origin feat/4-dashboard
gh pr create --title "Widget dashboard" --body "$(cat <<'EOF'
## Ringkasan
- get_dashboard: jatuh tempo hari ini + terlambat (batas hari lokal via jiff), 8 item terbaru menurut aktivitas terakhir
- Widget Hari ini (tanggal + sapaan), Keuangan (belum aktif), Item terbaru

## Verifikasi
- cargo test: 21 passed; bun test: 6 pass
- e2e-smoke: PASS (screenshot 5-dashboard)

Closes #4

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Review sendiri, serahkan ke user, merge setelah user bilang "merge"**

```bash
gh pr merge --squash --delete-branch && git switch main && git pull
```

---

## PR #5: Backup dan Pengaturan (`feat/5-backup-settings`, Closes #5)

### Task 5.1: Modul backup (TDD)

**Files:**
- Create: `src-tauri/src/backup.rs`
- Modify: `src-tauri/src/time.rs`, `src-tauri/src/lib.rs` (`mod backup;`)

**Interfaces:**
- Consumes: `db::vacuum_into`.
- Produces:
  - `backup::daily(&Connection, dir, today) -> Result<Option<PathBuf>, AppError>`
  - `backup::manual(&Connection, dir, stamp) -> Result<PathBuf, AppError>`
  - `backup::rotate(dir)`
  - `backup::KEEP = 7`
  - `time::today_stamp() -> String` dan `time::now_stamp() -> String`

- [ ] **Step 1: Buat branch, lalu tulis test yang gagal**

```bash
git switch main && git pull && git switch -c feat/5-backup-settings
```

Buat `src-tauri/src/backup.rs` berisi modul test saja, lalu tambahkan `mod backup;` di `lib.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory;
    use crate::items::{capture_note, list_inbox};

    #[test]
    fn daily_backup_is_made_once_per_day_and_readable() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_in_memory();
        capture_note(&conn, "penting", 1000).unwrap();

        let first = daily(&conn, dir.path(), "2026-09-29").unwrap();
        let second = daily(&conn, dir.path(), "2026-09-29").unwrap();

        let path = first.expect("first call creates a backup");
        assert!(second.is_none());
        let copy = Connection::open(path).unwrap();
        assert_eq!(list_inbox(&copy).unwrap()[0].title, "penting");
    }

    #[test]
    fn rotation_keeps_newest_seven() {
        let dir = tempfile::tempdir().unwrap();
        for day in 1..=9 {
            std::fs::write(dir.path().join(format!("anchoa-2026-09-0{day}.db")), b"").unwrap();
        }
        std::fs::write(dir.path().join("notes.txt"), b"").unwrap();

        rotate(dir.path()).unwrap();

        let mut left: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(left.len(), KEEP + 1);
        assert_eq!(left[0], "anchoa-2026-09-03.db");
        assert!(left.contains(&"notes.txt".to_string()));
    }

    #[test]
    fn manual_backup_joins_the_rotation() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_in_memory();
        for day in 1..=7 {
            std::fs::write(dir.path().join(format!("anchoa-2026-09-0{day}.db")), b"").unwrap();
        }

        let path = manual(&conn, dir.path(), "2026-09-29-101500").unwrap();

        assert!(path.exists());
        assert!(!dir.path().join("anchoa-2026-09-01.db").exists());
    }
}
```

Run: `cd src-tauri && cargo test backup:: ; cd ..`
Expected: FAIL saat compile, dengan `cannot find function 'daily'`.

- [ ] **Step 2: Implementasi di atas modul test**

```rust
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::db::vacuum_into;
use crate::error::AppError;

/// Daily and manual backups share one rotation.
pub const KEEP: usize = 7;

/// Creates `anchoa-<today>.db` unless it already exists. Returns the new file.
pub fn daily(conn: &Connection, dir: &Path, today: &str) -> Result<Option<PathBuf>, AppError> {
    let dest = dir.join(format!("anchoa-{today}.db"));
    if dest.exists() {
        return Ok(None);
    }
    write(conn, dir, &dest)?;
    Ok(Some(dest))
}

/// Creates `anchoa-<stamp>.db` now.
pub fn manual(conn: &Connection, dir: &Path, stamp: &str) -> Result<PathBuf, AppError> {
    let dest = dir.join(format!("anchoa-{stamp}.db"));
    write(conn, dir, &dest)?;
    Ok(dest)
}

fn write(conn: &Connection, dir: &Path, dest: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(dir)?;
    vacuum_into(conn, dest)?;
    rotate(dir)
}

/// Keeps the newest `KEEP` backups. Names start with the date, so name order is age order.
pub fn rotate(dir: &Path) -> Result<(), AppError> {
    let mut backups: Vec<PathBuf> = std::fs::read_dir(dir)?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("anchoa-") && name.ends_with(".db"))
        })
        .collect();
    backups.sort();
    let excess = backups.len().saturating_sub(KEEP);
    for old in &backups[..excess] {
        std::fs::remove_file(old)?;
    }
    Ok(())
}
```

Di `src-tauri/src/time.rs`, ganti import menjadi `use jiff::{Timestamp, Zoned, tz::TimeZone};`, lalu tambahkan setelah `day_bounds`:

```rust
/// Local date for daily backup names, e.g. `2026-09-29`.
pub fn today_stamp() -> String {
    Zoned::now().strftime("%Y-%m-%d").to_string()
}

/// Local date and time for manual backup names, e.g. `2026-09-29-142501`.
pub fn now_stamp() -> String {
    Zoned::now().strftime("%Y-%m-%d-%H%M%S").to_string()
}
```

- [ ] **Step 3: Jalankan test**

Run: `cd src-tauri && cargo test ; cd ..`
Expected: `24 passed`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri
git commit -m "feat: add daily and manual backups with 7-file rotation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5.2: Backup saat start dan command backup

**Files:**
- Modify: `src-tauri/src/db.rs` (field `backup_error`), `src-tauri/src/commands.rs` (isi penuh), `src-tauri/src/lib.rs` (isi penuh)

**Interfaces:**
- Produces:
  - `db_status() -> { path, error, backupError }`
  - `backup_now() -> string` (path)
  - `data_paths() -> { dataDir, backupDir, logDir }`
  - `open_folder(kind: "data" | "backup" | "log")`

- [ ] **Step 1: Tambah field `backup_error` di `src-tauri/src/db.rs`**

Isi `struct Db` dan `open_at` menjadi:

```rust
pub struct Db {
    conn: Option<Mutex<Connection>>,
    pub path: PathBuf,
    pub open_error: Option<String>,
    pub backup_error: Option<String>,
}

impl Db {
    pub fn open_at(path: PathBuf) -> Db {
        match open(&path) {
            Ok(conn) => Db { conn: Some(Mutex::new(conn)), path, open_error: None, backup_error: None },
            Err(e) => Db { conn: None, path, open_error: Some(e.to_string()), backup_error: None },
        }
    }
```

`conn()` tidak berubah.

- [ ] **Step 2: Tulis ulang `src-tauri/src/commands.rs`**

```rust
//! Thin Tauri glue: every function here only resolves state and delegates.
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::dashboard::{self, Dashboard};
use crate::db::Db;
use crate::error::AppError;
use crate::items::{self, Item, ItemPatch, ItemSummary};
use crate::{backup, time};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStatus {
    pub path: String,
    pub error: Option<String>,
    pub backup_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataPaths {
    pub data_dir: String,
    pub backup_dir: String,
    pub log_dir: String,
}

pub fn backup_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(app.path().app_data_dir()?.join("backups"))
}

#[tauri::command]
pub fn db_status(db: State<'_, Db>) -> DbStatus {
    DbStatus { path: db.path.display().to_string(), error: db.open_error.clone(), backup_error: db.backup_error.clone() }
}

#[tauri::command]
pub fn capture_note(db: State<'_, Db>, text: String) -> Result<Item, AppError> {
    items::capture_note(&*db.conn()?, &text, time::now_ms())
}

#[tauri::command]
pub fn open_item(db: State<'_, Db>, id: String) -> Result<Item, AppError> {
    items::open(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn update_item(db: State<'_, Db>, id: String, patch: ItemPatch) -> Result<Item, AppError> {
    items::update(&*db.conn()?, &id, &patch, time::now_ms())
}

#[tauri::command]
pub fn delete_item(db: State<'_, Db>, id: String) -> Result<(), AppError> {
    items::delete(&*db.conn()?, &id, time::now_ms())
}

#[tauri::command]
pub fn list_inbox(db: State<'_, Db>) -> Result<Vec<ItemSummary>, AppError> {
    items::list_inbox(&*db.conn()?)
}

#[tauri::command]
pub fn get_dashboard(db: State<'_, Db>) -> Result<Dashboard, AppError> {
    dashboard::get(&*db.conn()?, time::now_ms(), &jiff::tz::TimeZone::system())
}

#[tauri::command]
pub fn backup_now(app: AppHandle, db: State<'_, Db>) -> Result<String, AppError> {
    let path = backup::manual(&*db.conn()?, &backup_dir(&app)?, &time::now_stamp())?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn data_paths(app: AppHandle) -> Result<DataPaths, AppError> {
    Ok(DataPaths {
        data_dir: app.path().app_data_dir()?.display().to_string(),
        backup_dir: backup_dir(&app)?.display().to_string(),
        log_dir: app.path().app_log_dir()?.display().to_string(),
    })
}

/// Opens one of the app's own folders in the file manager. The frontend
/// never passes a path, so it cannot open anything else.
#[tauri::command]
pub fn open_folder(app: AppHandle, kind: String) -> Result<(), AppError> {
    let dir = match kind.as_str() {
        "data" => app.path().app_data_dir()?,
        "backup" => backup_dir(&app)?,
        "log" => app.path().app_log_dir()?,
        other => return Err(AppError::Other(format!("folder tidak dikenal: {other}"))),
    };
    std::fs::create_dir_all(&dir)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))
}
```

- [ ] **Step 3: Tulis ulang `src-tauri/src/lib.rs`**

```rust
mod backup;
mod commands;
mod dashboard;
mod db;
mod error;
mod gpu;
mod items;
mod time;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Must stay first: it may call set_var, which is only sound before other threads start.
    let gpu_node = gpu::apply_linux_workaround();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            if let Some(node) = &gpu_node {
                log::info!("NVIDIA workaround: WEBKIT_WEB_RENDER_DEVICE_FILE={node}");
            }
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let mut db = db::Db::open_at(data_dir.join("anchoa.db"));
            match &db.open_error {
                Some(e) => log::error!("database open failed: {e}"),
                None => {
                    let result = backup::daily(&*db.conn()?, &data_dir.join("backups"), &time::today_stamp());
                    match result {
                        Ok(Some(path)) => log::info!("daily backup: {}", path.display()),
                        Ok(None) => {}
                        Err(e) => {
                            log::error!("daily backup failed: {e}");
                            db.backup_error = Some(e.to_string());
                        }
                    }
                }
            }
            app.manage(db);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_status,
            commands::capture_note,
            commands::open_item,
            commands::update_item,
            commands::delete_item,
            commands::list_inbox,
            commands::get_dashboard,
            commands::backup_now,
            commands::data_paths,
            commands::open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: Clippy dan test**

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test ; cd ..`
Expected: clippy bersih, `24 passed`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri
git commit -m "feat: run daily backup at startup and expose backup commands

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5.3: Halaman Pengaturan dan toast backup

**Files:**
- Create: `src/settings/Settings.tsx`
- Modify: `src/api.ts`, `src/shell/Sidebar.tsx`, `src/App.tsx`

- [ ] **Step 1: Perbarui `src/api.ts`**

Ganti `DbStatus` dan `FolderKind` menjadi:

```ts
export interface DbStatus {
  path: string;
  error: string | null;
  backupError: string | null;
}

export interface DataPaths {
  dataDir: string;
  backupDir: string;
  logDir: string;
}

export type FolderKind = "data" | "backup" | "log";
```

Tambahkan ke objek `api`, setelah `getDashboard`:

```ts
  backupNow: () => invoke<string>("backup_now"),
  dataPaths: () => invoke<DataPaths>("data_paths"),
```

- [ ] **Step 2: Tulis `src/settings/Settings.tsx`**

```tsx
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { api, errorMessage, type DataPaths, type FolderKind } from "../api";
import { useToast } from "../shell/toast";

const BUTTON = "rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800";

export function Settings() {
  const toast = useToast();
  const [paths, setPaths] = useState<DataPaths | null>(null);
  const [version, setVersion] = useState("");

  useEffect(() => {
    api.dataPaths().then(setPaths, (e) => toast(errorMessage(e), "error"));
    getVersion().then(setVersion);
  }, [toast]);

  async function backup() {
    try {
      toast(`Backup dibuat: ${await api.backupNow()}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const open = (kind: FolderKind) => api.openFolder(kind).catch((e) => toast(errorMessage(e), "error"));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-xl font-bold">Pengaturan</h1>
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Data</h2>
        <p className="break-all font-mono text-xs text-neutral-500">{paths?.dataDir}</p>
        <div className="flex gap-2">
          <button onClick={() => void backup()} className={BUTTON}>
            Backup sekarang
          </button>
          <button onClick={() => void open("backup")} className={BUTTON}>
            Buka folder backup
          </button>
          <button onClick={() => void open("data")} className={BUTTON}>
            Buka folder data
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          Backup harian dibuat otomatis saat aplikasi dibuka; 7 backup terbaru disimpan.
        </p>
      </section>
      <p className="text-sm text-neutral-500">Anchoa versi {version}</p>
    </div>
  );
}
```

`getVersion` sudah diizinkan oleh `core:default`.

- [ ] **Step 3: Tambahkan Pengaturan ke `src/shell/Sidebar.tsx`**

Ganti tipe menjadi `export type TopPage = "dashboard" | "inbox" | "settings";`, lalu tambahkan setelah `{link("inbox", "Inbox")}`:

```tsx
      <div className="mt-auto">{link("settings", "Pengaturan")}</div>
```

- [ ] **Step 4: Tulis ulang `src/App.tsx`**

```tsx
import { useEffect, useState } from "react";
import { api, type DbStatus } from "./api";
import { Dashboard } from "./dashboard/Dashboard";
import { Inbox } from "./inbox/Inbox";
import { ItemPage } from "./item/ItemPage";
import { Settings } from "./settings/Settings";
import { AiColumn } from "./shell/AiColumn";
import { ErrorScreen } from "./shell/ErrorScreen";
import { Sidebar, type TopPage } from "./shell/Sidebar";
import { useToast } from "./shell/toast";

type Page = { name: TopPage } | { name: "item"; id: string };

export function App() {
  const toast = useToast();
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [stack, setStack] = useState<Page[]>([{ name: "dashboard" }]);
  const [focusCapture, setFocusCapture] = useState(0);
  const page = stack[stack.length - 1];

  useEffect(() => {
    api.dbStatus().then((s) => {
      setStatus(s);
      if (s.backupError) toast(`Backup harian gagal: ${s.backupError}`, "error");
    });
  }, [toast]);

  // Ctrl+N: jump to the dashboard and focus quick capture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setStack([{ name: "dashboard" }]);
        setFocusCapture((n) => n + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!status) return null;
  if (status.error) return <ErrorScreen path={status.path} message={status.error} />;

  const openItem = (id: string) => setStack((s) => [...s, { name: "item", id }]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  return (
    <div className="flex h-full">
      <Sidebar current={page.name} onSelect={(name) => setStack([{ name }])} />
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {page.name === "dashboard" && <Dashboard onOpen={openItem} focusCapture={focusCapture} />}
        {page.name === "inbox" && <Inbox onOpen={openItem} />}
        {page.name === "item" && <ItemPage key={page.id} id={page.id} onBack={back} />}
        {page.name === "settings" && <Settings />}
      </main>
      <AiColumn />
    </div>
  );
}
```

- [ ] **Step 5: Typecheck, test, build, lalu commit**

Run: `bun run typecheck && bun run test && bun run build`
Expected: semua lulus.

```bash
git add src
git commit -m "feat: add settings page with manual backup and folder shortcuts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5.4: E2E backup

**Files:**
- Modify: `scripts/e2e-smoke.sh`

- [ ] **Step 1: Tambahkan fungsi berikut setelah `check_dashboard`, lalu panggil `check_backup` sebelum baris `echo "PASS..."`**

```bash
check_backup() {
  fresh
  start_app
  ls "$APPDATA"/backups/anchoa-*.db >/dev/null 2>&1 || fail "no daily backup at startup"
  click 63 770          # sidebar: Pengaturan
  click 310 158         # Backup sekarang
  shot 6-settings
  [ "$(ls "$APPDATA"/backups/anchoa-*.db | wc -l)" -eq 2 ] || fail "manual backup was not created"
  stop_app
}
```

- [ ] **Step 2: Jalankan**

Run: `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`
Expected: `PASS`. `6-settings.png` menampilkan path folder data, tiga tombol, dan "Anchoa versi 0.1.0".

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-smoke.sh
git commit -m "test: cover daily and manual backup in e2e smoke test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5.5: Buka PR #5

- [ ] **Step 1: Verifikasi penuh** (sesuai "Siklus setiap PR" langkah 3).
- [ ] **Step 2: Push dan buat PR**

```bash
git push -u origin feat/5-backup-settings
gh pr create --title "Backup dan halaman Pengaturan" --body "$(cat <<'EOF'
## Ringkasan
- Backup harian saat start (VACUUM INTO), backup manual, rotasi 7 file bersama
- Backup gagal: dicatat di log + toast, app tetap jalan
- Halaman Pengaturan: path data, Backup sekarang, buka folder backup/data, versi

## Verifikasi
- cargo test: 24 passed; bun test: 6 pass
- e2e-smoke: PASS (backup harian ada, backup manual menambah file)

Closes #5

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Review sendiri, serahkan ke user, merge setelah user bilang "merge"**

```bash
gh pr merge --squash --delete-branch && git switch main && git pull
```

---

## PR #6: Rilis v0.1.0 (`feat/6-release`, Closes #6)

### Task 6.1: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Buat branch dan tulis `README.md`**

```bash
git switch main && git pull && git switch -c feat/6-release
```

````markdown
# Anchoa

Aplikasi desktop untuk mengelola semuanya di satu tempat (catatan, task, keuangan, project), bergaya Notion/Obsidian. Dibangun dengan Tauri 2, React, dan SQLite. Saat ini untuk Fedora Linux.

## Instal

Unduh file `.rpm` dari halaman Releases, lalu:

```bash
sudo dnf install ./Anchoa-0.1.0-1.x86_64.rpm
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

Rencana dan spec ada di `docs/superpowers/`.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with install, restore and development steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6.2: Build RPM dan uji instalasi

- [ ] **Step 1: Build rilis**

Run: `bun tauri build`
Expected: `Finished 1 bundle at: .../src-tauri/target/release/bundle/rpm/Anchoa-0.1.0-1.x86_64.rpm`. Kalau nama filenya berbeda, pakai nama sebenarnya di langkah berikut dan di README.

- [ ] **Step 2: E2E terhadap binary rilis**

Run: `scripts/e2e-smoke.sh src-tauri/target/release/anchoa`
Expected: `PASS`.

- [ ] **Step 3: Instalasi dan cek di layar asli (user)**

`sudo` butuh terminal biasa, karena prefix `!` tidak bisa meminta password. Minta user menjalankan ini di terminal biasa:

```bash
sudo dnf install ./src-tauri/target/release/bundle/rpm/Anchoa-0.1.0-1.x86_64.rpm
```

Lalu minta user memastikan hal berikut di layar asli:
1. Anchoa muncul di menu aplikasi dan jendelanya tampil normal di laptop NVIDIA-primary.
2. Quick capture berjalan, lalu setelah app ditutup dan dibuka lagi, item masih ada.
3. Membuka Anchoa untuk kedua kalinya hanya memfokuskan jendela yang sudah terbuka.
4. `~/.local/share/io.github.syharipf.anchoa/backups/` berisi backup hari ini.

### Task 6.3: PR, merge, dan rilis

- [ ] **Step 1: Push dan buat PR**

```bash
git push -u origin feat/6-release
gh pr create --title "Rilis v0.1.0" --body "$(cat <<'EOF'
## Ringkasan
- README: instal, lokasi data, langkah restore backup, perintah pengembangan

## Verifikasi
- bun tauri build: RPM terbentuk
- e2e-smoke terhadap binary rilis: PASS
- Instalasi RPM di Fedora (user): <hasil cek user>

Closes #6

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Merge setelah user bilang "merge"**

```bash
gh pr merge --squash --delete-branch && git switch main && git pull
```

- [ ] **Step 3: Buat GitHub Release dari `main`**

```bash
bun tauri build
gh release create v0.1.0 src-tauri/target/release/bundle/rpm/Anchoa-0.1.0-1.x86_64.rpm \
  --target main --title "Anchoa v0.1.0 — Fase 1" \
  --notes "Fondasi + Dashboard: quick capture (Ctrl+N), Inbox, halaman item dengan autosave, dashboard (Hari ini, Keuangan, Item terbaru), backup harian dan manual. Fedora x86_64."
```

Expected: URL rilis tampil. Milestone "Fase 1" berisi 6 issue yang semuanya sudah tertutup.

- [ ] **Step 4: Tutup milestone**

```bash
gh api -X PATCH repos/Syharipf/Anchoa/milestones/1 -f state=closed
```

---

## Cakupan spec

| Bagian spec | Task |
|---|---|
| §3 Scope: shell, kolom AI, tema sistem | 1.1 |
| §3 CI Linux | 1.4, 3.1 |
| §4 Struktur folder, `api.ts` sebagai satu-satunya pemanggil `invoke` | 1.1, 2.4, 3.2 |
| §4 Plugin single-instance, log, opener; CSP ketat | 1.2, 2.4 |
| §4 Identifier dan folder data | 1.2, 2.4 |
| §5 Tabel `items`, index, UUIDv7, soft delete, `opened_at` tidak mengubah `updated_at` | 2.1, 2.3 |
| §5 Jatuh tempo = 00:00 lokal | 3.1 (`dateInputToMs`) |
| §6 Command | 2.4, 4.2, 5.2 |
| §6 `due_today`, `overdue`, `recent` (8, urut aktivitas) | 4.2 |
| §7 Quick capture, `Ctrl+N`, toast, teks tidak hilang saat gagal | 3.3 |
| §7 Hari ini (sapaan, terlambat, kosong), Keuangan (belum aktif), Item terbaru | 4.3 |
| §7 Format waktu relatif | 3.1 |
| §7 Inbox, halaman item (autosave 500 ms + blur, status, hapus dengan konfirmasi, Kembali) | 3.3 |
| §7 Pengaturan | 5.3 |
| §8 Perbaikan GPU Linux | 1.2 |
| §9 DB gagal dibuka tidak ditimpa, pragma, migrasi transaksional, DB dari versi lebih baru ditolak | 2.2, 3.2, 3.4 |
| §10 Backup sebelum migrasi, harian, manual, rotasi 7, restore di README | 2.2, 5.1, 5.2, 6.1 |
| §11 Test Rust dan frontend, E2E | semua PR |
| §12 Kriteria selesai | 6.2 |
