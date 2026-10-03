# Anchoa UI lanjutan (kerangka global): Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementasi oleh task role `Coder` (satu task per run). Review oleh task role `reviewer`.

**Goal:** Menyamakan kerangka aplikasi dengan paket desain lengkap. Isinya nav 8 modul, halaman "menyusul", asisten mini, top bar dengan command palette, panel notifikasi, dan dashboard bento.

**Architecture:**
- Daftar halaman ada di satu modul data, `src/shell/nav.ts`. Sidebar, halaman menyusul, palette, dan kartu modul di dashboard membacanya.
- Data dashboard dimuat sekali di `App` lewat hook `useDashboard`, lalu dibagi ke Dashboard, palette, lonceng, dan panel notifikasi.
- Logika yang bisa diuji dipisah ke fungsi murni: `paletteResults`, `reminders`, `summaryLine`, dan `upcomingLabel`.
- Backend hanya bertambah field `upcoming` di `get_dashboard`.

**Tech Stack:** Tauri 2, Rust 2024, rusqlite, jiff 0.2, React 19, TypeScript, Tailwind CSS 4, bun test.

**Spec:** `docs/superpowers/specs/2026-09-30-anchoa-ui-lanjutan-design.md`

## Global Constraints

- Tema gelap saja. Semua teks UI dalam Bahasa Indonesia; kode, komentar, dan nama file dalam bahasa Inggris.
- Props komponen React dibungkus `Readonly<...>`. Jangan pakai `Math.random()`. Script bash memakai `[[ ... ]]`.
- Tidak ada dependency baru.
- Animasi hanya `transform` dan `opacity`. Setiap elemen beranimasi diberi atribut `data-anim`, supaya aturan `prefers-reduced-motion` di `src/index.css` mematikannya. Animasi berulang berhenti saat idle dan saat `document.visibilityState` bukan `visible`.
- Frontend tidak menyentuh DB. Semua panggilan backend lewat `src/api.ts`. Batas hari dihitung di Rust.
- Jendela: awal 1280×800, minimum 1100×680. Tinggi nav harus muat di 680px.
- Warna overlay dari artboard: latar redup palette `#05070A` 80%, panel notifikasi `#05070A` 60%, border popup `#2E3440`, sorotan opsi palette `#232833`, tile ikon aktif `#2E3440`.
- Nav: tombol 48×48, radius 12, gap 6px, ikon 20px, `aria-current="page"` untuk halaman aktif, `title` dan `aria-label` di setiap tombol.
- Fase modul: Email 8, Jadwal 3, Keuangan 2, Proyek 3, Berkas 6, Unduhan 7. Suara dan asisten sungguhan: Fase 5.
- Palette: 640px, top 110px. Panel notifikasi: 400px, mulai di kanan nav (72px). Asisten mini: tombol 60px, popup 304px.
- E2E berjalan di Xvfb `:99` dan tidak pernah menyentuh display `:0`. Setelah layout berubah, koordinat klik diukur ulang dari screenshot `~/.cache/anchoa-e2e/`.
- Perintah pemeriksaan:
  - `bun run typecheck`
  - `bun run test`
  - `cd src-tauri && cargo test`
  - `cd src-tauri && cargo clippy --all-targets -- -D warnings`
  - `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`

## Koordinat nav setelah UI-5

Nav memakai `py-4`, logo 40px dengan `mb-2`, dan gap 6px. Titik tengah tombol di x = 36:

| Tombol | y |
|---|---|
| Dashboard | 94 |
| Inbox | 148 |
| Email | 202 |
| Jadwal | 256 |
| Keuangan | 310 |
| Proyek | 364 |
| Berkas | 418 |
| Unduhan | 472 |
| Notifikasi (mulai UI-7) | 652 |
| Profil | 706 |
| Pengaturan | 760 |

Tombol asisten mini (tertutup) ada di x = 1226, y = 746.

## Prosedur penutup PR

Task terakhir setiap PR menjalankan langkah ini. Nomor issue dan nama branch ditulis di task tersebut.

1. Jalankan semua perintah pemeriksaan di Global Constraints, lalu simpan ekor outputnya.
2. Buka screenshot E2E yang disebut di task, lalu cocokkan dengan artboard.
3. Review (task role `reviewer`, spec dan plan sebagai konteks). Verifikasi temuan, perbaiki yang benar, commit.
Periksa setiap temuan; perbaiki yang benar, lalu commit.
4. `git push -u origin <branch>`, lalu `gh pr create --base <base>`. Body PR memuat ringkasan, output pemeriksaan, daftar screenshot, hasil review, `Closes #<issue>`, dan baris atribusi.
5. Jangan merge. Merge hanya kalau user bilang.

---

# PR UI-5: nav, halaman menyusul, asisten mini

Branch `feat/<issue UI-5>-ui-5-kerangka`, dibuat dari `docs/ui-lanjutan-plan`.

### Task 1: Daftar halaman dan nav 10 tombol

**Files:**
- Create: `src/shell/nav.ts`
- Modify: `src/shell/Sidebar.tsx` (seluruh file)
- Modify: `src/App.tsx` (tipe `Page`)
- Modify: `scripts/e2e-smoke.sh` (koordinat nav)

**Interfaces:**
- Produces: `type PageId`, `interface NavPage { id; label; fase?; about?; bottom? }`, `PAGES: readonly NavPage[]`, `pageInfo(id: PageId): NavPage`, `assistantHint(page: NavPage | null): string`. `Sidebar` menerima `{ current: string; onSelect: (page: PageId) => void; inboxDot?: boolean }`.

- [ ] **Step 1: Buat `src/shell/nav.ts`**

```ts
// Every top-level page, in nav order (docs/design/DESIGN.md §1).

export type PageId =
  | "dashboard"
  | "inbox"
  | "email"
  | "jadwal"
  | "keuangan"
  | "proyek"
  | "berkas"
  | "unduhan"
  | "profil"
  | "settings";

export interface NavPage {
  id: PageId;
  label: string;
  /** The fase that builds this module. */
  fase?: number;
  /** Set only on pages that are not built yet: shown on their placeholder page. */
  about?: string;
  /** Sits at the bottom of the nav rail. */
  bottom?: true;
}

export const PAGES: readonly NavPage[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "inbox", label: "Inbox" },
  {
    id: "email",
    label: "Email",
    fase: 8,
    about: "Kotak masuk IMAP dengan ringkasan dari asisten, saran balasan, dan dikte suara.",
  },
  {
    id: "jadwal",
    label: "Jadwal",
    fase: 3,
    about: "Kalender bulanan dan timeline 8 minggu untuk proyek, tagihan, dan urusan pribadi.",
  },
  {
    id: "keuangan",
    label: "Keuangan",
    fase: 2,
    about: "Saldo, pemasukan, pengeluaran, akun, dan riwayat transaksi.",
  },
  {
    id: "proyek",
    label: "Proyek",
    fase: 3,
    about: "Daftar proyek dengan progres, tenggat terdekat, dan kanban Rencana, Dikerjakan, Selesai.",
  },
  {
    id: "berkas",
    label: "Berkas",
    fase: 6,
    about: "Pengelola file dengan pratinjau foto, video, PDF, dan teks.",
  },
  {
    id: "unduhan",
    label: "Unduhan",
    fase: 7,
    about: "Unduh file, video, dan audio lewat antrean dengan status yang jelas.",
  },
  {
    id: "profil",
    label: "Profil",
    about:
      "Profil tumbuh bersama modulnya: akun email, suara asisten, dan notifikasi. Pengaturan GitHub dan backup ada di Pengaturan.",
    bottom: true,
  },
  { id: "settings", label: "Pengaturan", bottom: true },
];

const BY_ID = Object.fromEntries(PAGES.map((p) => [p.id, p])) as Record<PageId, NavPage>;

export function pageInfo(id: PageId): NavPage {
  return BY_ID[id];
}

/** One line for the mini assistant on each page. */
export function assistantHint(page: NavPage | null): string {
  if (page?.fase) return `${page.label} hadir di Fase ${page.fase}. Asisten suara menyusul di Fase 5.`;
  return "Asisten suara aktif di Fase 5. Untuk sekarang, coba ketuk mikrofon.";
}
```

- [ ] **Step 2: Tulis ulang `src/shell/Sidebar.tsx`**

```tsx
import type { ReactNode } from "react";
import { PAGES, type PageId } from "./nav";

/** Nav icons on a 24×24 grid, taken from docs/design/artboards/Main.dc.html. */
const ICON: Record<PageId, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 13h5l2 3h4l2-3h5" />
      <path d="M5 5h14l2 8v6H3v-6z" />
    </>
  ),
  email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  jadwal: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  keuangan: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M16 12.5h2M3 10h18" />
    </>
  ),
  proyek: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M8 7v7M12 7v4M16 7v10" />
    </>
  ),
  berkas: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  unduhan: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  profil: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </>
  ),
};

const BUTTON = "relative flex h-12 w-12 items-center justify-center rounded-xl transition-colors";

function NavIcon({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Icon-only navigation rail (72px). Sized to fit the 680px minimum window height. */
export function Sidebar({
  current,
  onSelect,
  inboxDot = false,
}: Readonly<{ current: string; onSelect: (page: PageId) => void; inboxDot?: boolean }>) {
  const link = (id: PageId, label: string) => (
    <button
      key={id}
      onClick={() => onSelect(id)}
      aria-label={label}
      title={label}
      aria-current={current === id ? "page" : undefined}
      className={`${BUTTON} ${current === id ? "bg-surface-2 text-accent" : "text-muted hover:bg-surface-2"}`}
    >
      <NavIcon>{ICON[id]}</NavIcon>
      {id === "inbox" && inboxDot && <span className="absolute top-[9px] right-[9px] h-[7px] w-[7px] rounded-full bg-accent" />}
    </button>
  );

  return (
    <nav aria-label="Menu utama" className="flex w-[72px] shrink-0 flex-col items-center gap-1.5 border-r border-line bg-sidebar py-4">
      {/* Placeholder until the real Anchoa logo file exists. */}
      <svg width="40" height="40" viewBox="0 0 40 40" role="img" aria-label="Logo Anchoa" className="mb-2 shrink-0">
        <rect width="40" height="40" rx="12" className="fill-accent" />
        <text x="20" y="26" textAnchor="middle" className="fill-canvas font-display text-lg font-semibold">
          A
        </text>
      </svg>
      {PAGES.filter((p) => !p.bottom).map((p) => link(p.id, p.label))}
      <div className="mt-auto flex flex-col gap-1.5">{PAGES.filter((p) => p.bottom).map((p) => link(p.id, p.label))}</div>
    </nav>
  );
}
```

- [ ] **Step 3: Ganti tipe halaman di `src/App.tsx`**

Ganti `import { Sidebar, type TopPage } from "./shell/Sidebar";` menjadi dua baris berikut:

```tsx
import { type PageId } from "./shell/nav";
import { Sidebar } from "./shell/Sidebar";
```

Ganti `type Page = { name: TopPage } | { name: "item"; id: string };` menjadi:

```tsx
type Page = { name: PageId } | { name: "item"; id: string };
```

- [ ] **Step 4: Sesuaikan koordinat nav di `scripts/e2e-smoke.sh`**

Ganti koordinat klik nav sesuai tabel "Koordinat nav setelah UI-5":
- setiap `click 36 164` (Inbox) menjadi `click 36 148`;
- `click 36 108` (Dashboard) menjadi `click 36 94`;
- setiap `click 36 756` (Pengaturan) menjadi `click 36 760`.

Komentar di baris tersebut tetap.

- [ ] **Step 5: Pemeriksaan**

Run: `bun run typecheck && bun run test`
Expected: exit 0. Semua test lama lolos.

- [ ] **Step 6: Commit**

```bash
git add src/shell/nav.ts src/shell/Sidebar.tsx src/App.tsx scripts/e2e-smoke.sh
git commit -m "feat(shell): nav rail with all eight modules, Profil and Pengaturan"
```

### Task 2: Halaman menyusul, dan aside hanya di Dashboard

**Files:**
- Create: `src/shell/ComingSoon.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `NavPage`, `pageInfo`, `PageId` dari Task 1.
- Produces: `ComingSoon({ page: NavPage; onOpenSettings: () => void })`.

- [ ] **Step 1: Buat `src/shell/ComingSoon.tsx`**

```tsx
import type { NavPage } from "./nav";
import { H1, PANEL, SECONDARY } from "./ui";

/** Placeholder for a page that a later fase builds (spec UI lanjutan U1, U11). */
export function ComingSoon({ page, onOpenSettings }: Readonly<{ page: NavPage; onOpenSettings: () => void }>) {
  return (
    <div className="flex max-w-3xl flex-col gap-[18px]">
      <h1 className={H1}>{page.label}</h1>
      <section className={`${PANEL} flex flex-col items-start gap-2`}>
        <span className="text-xs tracking-[0.08em] text-accent uppercase">
          {page.fase ? `Hadir di Fase ${page.fase}` : "Menyusul"}
        </span>
        <p className="m-0 text-sm leading-relaxed text-ink">{page.about}</p>
        {page.id === "profil" && (
          <button onClick={onOpenSettings} className={`${SECONDARY} mt-2`}>
            Buka Pengaturan
          </button>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Pasang di `src/App.tsx`**

Tambahkan import `ComingSoon` dan `pageInfo`:

```tsx
import { ComingSoon } from "./shell/ComingSoon";
import { pageInfo, type PageId } from "./shell/nav";
```

Di dalam `App`, tepat setelah `const back = ...`, tambahkan:

```tsx
  const info = page.name === "item" ? null : pageInfo(page.name);
  const openSettings = () => setStack([{ name: "settings" }]);
```

Di dalam `<main>`, setelah baris `Settings`, tambahkan:

```tsx
        {info?.about && <ComingSoon page={info} onOpenSettings={openSettings} />}
```

Ganti baris `<Aside ... />` menjadi:

```tsx
      {page.name === "dashboard" && <Aside contributionsVersion={contributionsVersion} onOpenSettings={openSettings} />}
```

- [ ] **Step 3: Pemeriksaan**

Run: `bun run typecheck && bun run test`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/shell/ComingSoon.tsx src/App.tsx
git commit -m "feat(shell): placeholder pages and side panel only on the dashboard"
```

### Task 3: Asisten mini

**Files:**
- Modify: `src/assistant/School.tsx`
- Modify: `src/assistant/AssistantStage.tsx` (pemanggilan `School`)
- Create: `src/assistant/AssistantMini.tsx`
- Modify: `src/index.css` (keyframes)
- Modify: `src/App.tsx`
- Modify: `scripts/e2e-smoke.sh` (`check_nav` baru)

**Interfaces:**
- Consumes: `assistantHint`, `pageInfo` dari Task 1; `usePageVisible` yang sudah ada.
- Produces:
  - `School({ color; dimmed; running; size?: number; period?: string; className?: string })`;
  - `AssistantMini({ hint: string; onOpenFull: () => void })`;
  - keyframes `anchoa-pop` dan `anchoa-slide` di `src/index.css` (dipakai UI-6 dan UI-7).

- [ ] **Step 1: Beri `School` prop ukuran, durasi, dan posisi**

Ganti signature dan elemen `<svg>` di `src/assistant/School.tsx`:

```tsx
/** Ring of anchovies around the avatar, rotated as one element. */
export function School({
  color,
  dimmed,
  running,
  size = 300,
  period = "48s",
  className = "",
}: Readonly<{ color: string; dimmed: boolean; running: boolean; size?: number; period?: string; className?: string }>) {
  return (
    <svg
      data-anim
      width={size}
      height={size}
      viewBox="0 0 300 300"
      aria-hidden="true"
      className={className}
      style={{
        color,
        fill: "currentColor",
        opacity: dimmed ? 0.45 : 1,
        transition: "color 0.4s, opacity 0.4s",
        animation: `anchoa-school ${period} linear infinite`,
        animationPlayState: running ? "running" : "paused",
      }}
    >
```

Isi `<svg>` (loop `FISH.map`) tidak berubah.

- [ ] **Step 2: Stage tetap di posisi lamanya**

Di `src/assistant/AssistantStage.tsx`, ganti pemanggilan `School` menjadi:

```tsx
        <School
          color={status.color}
          dimmed={mode === "idle"}
          running={running}
          className="absolute bottom-[123px] left-1/2 -ml-[150px]"
        />
```

- [ ] **Step 3: Tambahkan keyframes di `src/index.css`**

Tambahkan setelah `@keyframes anchoa-pulse { ... }`:

```css
@keyframes anchoa-pop {
  from {
    transform: translateY(8px) scale(0.98);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}

@keyframes anchoa-slide {
  from {
    transform: translateX(-12px);
    opacity: 0;
  }
  to {
    transform: none;
    opacity: 1;
  }
}
```

- [ ] **Step 4: Buat `src/assistant/AssistantMini.tsx`**

```tsx
import { useState, type ReactNode } from "react";
import { FIELD } from "../shell/ui";
import { School } from "./School";
import { usePageVisible } from "./usePageVisible";

const ROUND = "flex items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95";
const ICON_BUTTON = "flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2";

function Icon({ size, children }: Readonly<{ size: number; children: ReactNode }>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const FACE = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 10h.01M15 10h.01M9 15c1.7 1.3 4.3 1.3 6 0" />
  </>
);
const MIC = (
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </>
);

/**
 * Collapsed assistant for every page except the dashboard (DESIGN.md §1).
 * State is local: leaving the page puts the assistant back to idle (spec U7).
 */
export function AssistantMini({ hint, onOpenFull }: Readonly<{ hint: string; onOpenFull: () => void }>) {
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [typing, setTyping] = useState(false);
  const visible = usePageVisible();

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Buka asisten"
        title="Asisten"
        className={`${ROUND} fixed right-6 bottom-6 z-30 h-[60px] w-[60px] border border-line bg-surface-2 text-muted shadow-[0_16px_40px_rgb(0_0_0/0.45)]`}
      >
        <Icon size={28}>{FACE}</Icon>
        <span className="absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-canvas">
          <Icon size={11}>{MIC}</Icon>
        </span>
      </button>
    );
  }

  const collapse = () => {
    setOpen(false);
    setListening(false);
    setTyping(false);
  };

  return (
    <section
      aria-label="Asisten"
      data-anim
      style={{ animation: "anchoa-pop 0.2s ease-out" }}
      className="fixed right-6 bottom-6 z-30 flex w-[304px] flex-col gap-3 rounded-[18px] border border-[#2e3440] bg-surface p-4 shadow-[0_16px_40px_rgb(0_0_0/0.45)]"
    >
      <div className="flex items-center gap-3">
        <div className="relative h-11 w-11 shrink-0">
          <School
            size={72}
            period="12s"
            color={listening ? "var(--color-danger)" : "var(--color-muted)"}
            dimmed={!listening}
            running={listening && visible}
            className="absolute top-1/2 left-1/2 -mt-9 -ml-9"
          />
          <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-muted">
            <Icon size={24}>{FACE}</Icon>
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-display text-sm font-semibold">Anchoa</span>
          <span aria-live="polite" className={`text-xs ${listening ? "text-danger" : "text-muted"}`}>
            {listening ? "Mendengarkan…" : "Siap"}
          </span>
        </div>
        <button onClick={onOpenFull} aria-label="Buka asisten penuh" title="Buka asisten penuh" className={ICON_BUTTON}>
          <Icon size={16}>
            <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
          </Icon>
        </button>
        <button onClick={collapse} aria-label="Kecilkan asisten" title="Kecilkan" className={ICON_BUTTON}>
          <Icon size={16}>
            <path d="M5 12h14" />
          </Icon>
        </button>
      </div>

      <p className="m-0 text-sm leading-snug text-ink">
        {listening ? "Pengenalan suara hadir di Fase 5. Ketuk lagi untuk berhenti." : hint}
      </p>

      {typing && (
        <label className={`${FIELD} flex items-center gap-2 py-1.5 pr-1.5`}>
          <input
            aria-label="Ketik pesan ke asisten"
            placeholder="Ketik pesan…"
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-muted focus-visible:outline-none"
          />
          <button aria-label="Kirim" title="Asisten aktif di Fase 5" disabled className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-disabled">
            <Icon size={16}>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </Icon>
          </button>
        </label>
      )}

      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => setTyping((t) => !t)}
          aria-label="Ketik pesan"
          aria-pressed={typing}
          className={`${ROUND} h-9 w-9 border border-line ${typing ? "bg-surface-2 text-accent" : "text-muted"}`}
        >
          <Icon size={17}>
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
          </Icon>
        </button>
        <button
          onClick={() => setListening((l) => !l)}
          aria-label={listening ? "Berhenti mendengarkan" : "Ketuk untuk bicara"}
          aria-pressed={listening}
          className={`${ROUND} h-11 w-11 text-canvas ${listening ? "bg-danger" : "bg-accent"}`}
        >
          <Icon size={20}>{MIC}</Icon>
        </button>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Pasang di `src/App.tsx`**

Tambahkan import:

```tsx
import { AssistantMini } from "./assistant/AssistantMini";
```

Tambahkan `assistantHint` ke import dari `./shell/nav` sehingga menjadi `import { assistantHint, pageInfo, type PageId } from "./shell/nav";`.

Ganti baris Aside dari Task 2 menjadi:

```tsx
      {page.name === "dashboard" ? (
        <Aside contributionsVersion={contributionsVersion} onOpenSettings={openSettings} />
      ) : (
        <AssistantMini key={page.name} hint={assistantHint(info)} onOpenFull={() => setStack([{ name: "dashboard" }])} />
      )}
```

- [ ] **Step 6: Tambahkan `check_nav` ke `scripts/e2e-smoke.sh`**

Tambahkan fungsi berikut setelah `check_corrupt_db`:

```bash
check_nav() {
  fresh
  start_app
  for y in 202 256 310 364 418 472 706; do
    click 36 "$y"
    shot "3-nav-$y"     # expect: placeholder page (Email … Unduhan, then Profil)
  done
  click 36 148          # Inbox: the mini assistant replaces the side panel
  shot 3-mini-closed    # expect: round 60px button bottom right, lime mic badge
  click 1226 746        # open the mini assistant
  shot 3-mini-open      # expect: 304px popup, "Siap", keyboard and mic buttons
  xdotool search --name '^Anchoa$' >/dev/null || fail "app window disappeared"
  stop_app
}
```

Tambahkan `check_nav` ke daftar pemanggilan di bawah, setelah `check_corrupt_db`.

- [ ] **Step 7: Pemeriksaan**

Run: `bun run typecheck && bun run test`
Expected: exit 0.

Run: `bun tauri build --debug --no-bundle && E2E_ONLY=check_nav scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`
Expected: `PASS (check_nav)`. Buka `~/.cache/anchoa-e2e/3-mini-open.png` dan pastikan popup asisten mini tampil.

- [ ] **Step 8: Commit**

```bash
git add src/assistant src/index.css src/App.tsx scripts/e2e-smoke.sh
git commit -m "feat(assistant): mini assistant on pages without the side panel"
```

### Task 4: Penutup PR UI-5

- [ ] Jalankan "Prosedur penutup PR" dengan `<base>` = `docs/ui-lanjutan-plan`.
  - Screenshot yang dicek: `1-shell`, `3-nav-*`, `3-mini-open`, `4-inbox`, `5-dashboard`, `6-settings`, `8-assistant-*`.
  - Judul PR: "UI-5: nav 8 modul, halaman menyusul, asisten mini".

---

# PR UI-6: top bar dan command palette

Branch `feat/<issue UI-6>-ui-6-palette`, dibuat dari branch UI-5.

### Task 5: Hasil palette (fungsi murni)

**Files:**
- Create: `src/palette/results.ts`
- Test: `src/palette/results.test.ts`

**Interfaces:**
- Consumes: `PAGES`, `PageId` (Task 1), `ItemSummary` dari `src/api.ts`.
- Produces: `type PaletteOption`, `interface PaletteGroup { title: string; options: PaletteOption[] }`, `RECENT_IN_PALETTE = 5`, `paletteResults(query: string, recent: ItemSummary[]): PaletteGroup[]`.

- [ ] **Step 1: Tulis test yang gagal di `src/palette/results.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import type { ItemSummary } from "../api";
import { paletteResults } from "./results";

const note = (id: string, title: string): ItemSummary => ({ id, type: "note", title, dueAt: null, lastActivityAt: 1 });
const recent = ["a", "b", "c", "d", "e", "f", "g"].map((id) => note(id, `catatan ${id}`));
const titles = (q: string, r: ItemSummary[] = recent) => paletteResults(q, r).map((g) => g.title);

describe("paletteResults", () => {
  test("an empty query lists every page and the five most recent items", () => {
    const groups = paletteResults("", recent);
    expect(groups.map((g) => g.title)).toEqual(["Buka halaman", "Terbaru"]);
    expect(groups[0].options.map((o) => o.label)).toEqual([
      "Dashboard", "Inbox", "Email", "Jadwal", "Keuangan", "Proyek", "Berkas", "Unduhan", "Profil", "Pengaturan",
    ]);
    expect(groups[1].options).toHaveLength(5);
  });

  test("whitespace alone does not offer to save a note", () => {
    expect(titles("   ")).toEqual(["Buka halaman", "Terbaru"]);
  });

  test("filtering ignores case and ends with the save option", () => {
    const groups = paletteResults("KEU", recent);
    expect(groups.map((g) => g.title)).toEqual(["Buka halaman", "Inbox"]);
    expect(groups[0].options.map((o) => o.label)).toEqual(["Keuangan"]);
    expect(groups[1].options[0]).toMatchObject({ kind: "capture", text: "KEU", label: "Simpan ke Inbox: “KEU”" });
  });

  test("text that matches nothing leaves only the save option", () => {
    const groups = paletteResults("  beli susu  ", recent);
    expect(groups).toHaveLength(1);
    expect(groups[0].options).toEqual([
      { kind: "capture", id: "capture", label: "Simpan ke Inbox: “beli susu”", sub: "Enter", text: "beli susu" },
    ]);
  });

  test("recent items match on their title", () => {
    const groups = paletteResults("catatan b", recent);
    expect(groups[0]).toMatchObject({ title: "Terbaru", options: [{ kind: "item", itemId: "b" }] });
  });

  test("no recent items means no Terbaru group", () => {
    expect(titles("", [])).toEqual(["Buka halaman"]);
  });
});
```

- [ ] **Step 2: Pastikan test gagal**

Run: `TZ=Asia/Jakarta bun test src/palette/results.test.ts`
Expected: FAIL karena modul `./results` tidak ditemukan.

- [ ] **Step 3: Implementasi `src/palette/results.ts`**

```ts
import type { ItemSummary } from "../api";
import { PAGES, type PageId } from "../shell/nav";

export type PaletteOption =
  | { kind: "page"; id: string; label: string; sub: string; page: PageId }
  | { kind: "item"; id: string; label: string; sub: string; itemId: string }
  | { kind: "capture"; id: string; label: string; sub: string; text: string };

export interface PaletteGroup {
  title: string;
  options: PaletteOption[];
}

export const RECENT_IN_PALETTE = 5;

/**
 * Groups shown in the command palette (spec UI lanjutan U4). A non-empty query
 * filters by case-insensitive substring and always ends with "Simpan ke Inbox",
 * so text that matches nothing is saved by Enter, as quick capture always was.
 */
export function paletteResults(query: string, recent: ItemSummary[]): PaletteGroup[] {
  const text = query.trim();
  const needle = text.toLowerCase();
  const matches = (o: PaletteOption) => `${o.label} ${o.sub}`.toLowerCase().includes(needle);

  const pages: PaletteOption[] = PAGES.map((p) => ({
    kind: "page",
    id: `page-${p.id}`,
    label: p.label,
    sub: p.fase ? `Fase ${p.fase}` : "",
    page: p.id,
  }));
  const items: PaletteOption[] = recent.slice(0, RECENT_IN_PALETTE).map((i) => ({
    kind: "item",
    id: `item-${i.id}`,
    label: i.title || "Tanpa judul",
    sub: "Catatan",
    itemId: i.id,
  }));

  const groups: PaletteGroup[] = [
    { title: "Buka halaman", options: pages.filter(matches) },
    { title: "Terbaru", options: items.filter(matches) },
  ];
  if (text) {
    groups.push({
      title: "Inbox",
      options: [{ kind: "capture", id: "capture", label: `Simpan ke Inbox: “${text}”`, sub: "Enter", text }],
    });
  }
  return groups.filter((g) => g.options.length > 0);
}
```

- [ ] **Step 4: Pastikan test lolos**

Run: `TZ=Asia/Jakarta bun test src/palette/results.test.ts`
Expected: PASS, 6 test.

- [ ] **Step 5: Commit**

```bash
git add src/palette
git commit -m "feat(palette): filter pages and recent items, end with save to Inbox"
```

### Task 6: Komponen command palette

**Files:**
- Create: `src/palette/CommandPalette.tsx`

**Interfaces:**
- Consumes: `paletteResults`, `PaletteOption` (Task 5), `api.captureNote`, `errorMessage`, `useToast`, keyframe `anchoa-pop` (Task 3).
- Produces: `CommandPalette({ recent: ItemSummary[]; onClose: () => void; onNavigate: (page: PageId) => void; onOpenItem: (id: string) => void; onCaptured: () => void })`.

- [ ] **Step 1: Buat `src/palette/CommandPalette.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { api, errorMessage, type ItemSummary } from "../api";
import type { PageId } from "../shell/nav";
import { useToast } from "../shell/toast";
import { paletteResults, type PaletteOption } from "./results";

const OPTION_ICON: Record<PaletteOption["kind"], ReactNode> = {
  page: <path d="M5 12h14M13 6l6 6-6 6" />,
  item: <path d="M6 3h9l3 3v15H6zM9 11h6M9 15h6" />,
  capture: <path d="M12 5v14M5 12h14" />,
};

const KBD = "rounded border border-disabled px-[5px] font-mono";

/** Ctrl K palette (docs/design/artboards/CommandPalette.dc.html, spec UI lanjutan U4). */
export function CommandPalette({
  recent,
  onClose,
  onNavigate,
  onOpenItem,
  onCaptured,
}: Readonly<{
  recent: ItemSummary[];
  onClose: () => void;
  onNavigate: (page: PageId) => void;
  onOpenItem: (id: string) => void;
  onCaptured: () => void;
}>) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => paletteResults(query, recent), [query, recent]);
  const flat = groups.flatMap((g) => g.options);
  const current = Math.min(active, flat.length - 1);

  // Focus the input, then give focus back to whatever had it before the palette opened.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => previous?.focus();
  }, []);

  async function run(option: PaletteOption) {
    if (option.kind === "page") {
      onNavigate(option.page);
      onClose();
    } else if (option.kind === "item") {
      onOpenItem(option.itemId);
      onClose();
    } else if (!saving) {
      setSaving(true);
      try {
        await api.captureNote(option.text);
        toast("Tersimpan ke Inbox");
        onCaptured();
        onClose();
      } catch (e) {
        // Stay open with the text in place so nothing typed is lost.
        toast(errorMessage(e), "error");
      } finally {
        setSaving(false);
      }
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(current + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const option = flat[current];
      if (option) void run(option);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-40">
      <button aria-label="Tutup command palette" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-[#05070a]/80" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        data-anim
        style={{ animation: "anchoa-pop 0.16s ease-out" }}
        className="absolute top-[110px] left-1/2 -ml-[320px] flex w-[640px] flex-col overflow-hidden rounded-2xl border border-[#2e3440] bg-surface shadow-[0_24px_60px_rgb(0_0_0/0.65)]"
      >
        <div className="flex h-[58px] items-center gap-3 border-b border-line pr-3 pl-[18px]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={flat[current] ? `palette-${flat[current].id}` : undefined}
            aria-label="Cari perintah atau halaman"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Ketik halaman, catatan, atau tulis ide…"
            className="min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none placeholder:text-muted focus-visible:outline-none"
          />
          <kbd className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted">Esc</kbd>
        </div>

        <div id="palette-list" role="listbox" aria-label="Hasil" className="max-h-[440px] overflow-y-auto px-2 pt-1.5 pb-2">
          {groups.map((g) => (
            <div key={g.title} role="group" aria-label={g.title}>
              <div role="presentation" className="px-2.5 pt-2.5 pb-1 text-[11px] tracking-[0.08em] text-muted uppercase">
                {g.title}
              </div>
              {g.options.map((o) => {
                const index = flat.indexOf(o);
                const on = index === current;
                return (
                  <div
                    key={o.id}
                    id={`palette-${o.id}`}
                    role="option"
                    aria-selected={on}
                    tabIndex={-1}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => void run(o)}
                    className={`flex min-h-10 cursor-pointer items-center gap-3 rounded-[9px] px-2.5 text-sm ${on ? "bg-[#232833]" : ""}`}
                  >
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${on ? "bg-[#2e3440] text-accent" : "bg-surface-2 text-muted"}`}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        {OPTION_ICON[o.kind]}
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    <span className="text-xs text-muted">{o.sub}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <span className="sr-only" aria-live="polite">
          {flat.length} hasil
        </span>

        <div aria-hidden="true" className="flex items-center gap-4 border-t border-line bg-stage px-[18px] py-2.5 text-xs text-muted">
          <span>
            <kbd className={KBD}>↑↓</kbd> pilih
          </span>
          <span>
            <kbd className={KBD}>Enter</kbd> jalankan
          </span>
          <span>
            <kbd className={KBD}>Esc</kbd> tutup
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Pemeriksaan**

Run: `bun run typecheck && bun run test`
Expected: exit 0. Komponen belum dipakai, jadi layar belum berubah.

- [ ] **Step 3: Commit**

```bash
git add src/palette/CommandPalette.tsx
git commit -m "feat(palette): command palette dialog with keyboard and ARIA combobox"
```

### Task 7: Top bar, data dashboard di `App`, dan palette terpasang

**Files:**
- Create: `src/dashboard/useDashboard.ts`
- Create: `src/shell/TopBar.tsx`
- Move: `src/dashboard/Clock.tsx` → `src/shell/Clock.tsx`
- Delete: `src/dashboard/CommandBar.tsx`
- Modify: `src/dashboard/Dashboard.tsx` (seluruh file), `src/inbox/Inbox.tsx`, `src/App.tsx` (seluruh file)
- Modify: `scripts/e2e-smoke.sh`

**Interfaces:**
- Consumes: `CommandPalette` (Task 6), `ComingSoon`, `AssistantMini`, `pageInfo`, `assistantHint` (UI-5).
- Produces:
  - `useDashboard(): { data: Dashboard | null; reload: () => void; toggle: (task: DayTask) => void }`;
  - `TopBar({ onOpenPalette: () => void })`;
  - `Dashboard({ data: Dashboard | null; onToggle: (task: DayTask) => void; onOpen: (id: string) => void })`;
  - `Inbox({ onOpen })` tanpa `onCount`;
  - di `App`: `type Overlay = "palette" | null`.

- [ ] **Step 1: Buat `src/dashboard/useDashboard.ts`**

```ts
import { useCallback, useState } from "react";
import { api, errorMessage, type Dashboard, type DayTask } from "../api";
import { useToast } from "../shell/toast";

/** Dashboard data shared by the dashboard, the palette and (UI-7) the notification bell. */
export function useDashboard() {
  const toast = useToast();
  const [data, setData] = useState<Dashboard | null>(null);

  const reload = useCallback(() => {
    api.getDashboard().then(setData, (e) => toast(errorMessage(e), "error"));
  }, [toast]);

  // Tick immediately, then let the server's answer settle the counts.
  const toggle = useCallback(
    (task: DayTask) => {
      const done = task.completedAt === null;
      setData(
        (d) => d && { ...d, today: d.today.map((t) => (t.id === task.id ? { ...t, completedAt: done ? Date.now() : null } : t)) },
      );
      api.completeItem(task.id, done).then(reload, (e) => {
        toast(errorMessage(e), "error");
        reload();
      });
    },
    [reload, toast],
  );

  return { data, reload, toggle };
}
```

- [ ] **Step 2: Pindahkan `Clock` dan buat `src/shell/TopBar.tsx`**

Run: `git mv src/dashboard/Clock.tsx src/shell/Clock.tsx && git rm -q src/dashboard/CommandBar.tsx`

```tsx
import { Clock } from "./Clock";

/** Search-style button that opens the command palette, plus the clock (DESIGN.md §1). */
export function TopBar({ onOpenPalette }: Readonly<{ onOpenPalette: () => void }>) {
  return (
    <div className="flex items-center gap-4">
      <button
        onClick={onOpenPalette}
        aria-haspopup="dialog"
        className="flex h-[42px] flex-1 items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5 text-left text-sm text-muted transition-colors hover:border-field-focus"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <span className="flex-1">Cari atau jalankan perintah…</span>
        <kbd className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px]">Ctrl K</kbd>
      </button>
      <Clock />
    </div>
  );
}
```

- [ ] **Step 3: Tulis ulang `src/dashboard/Dashboard.tsx`**

```tsx
import type { Dashboard as DashboardData, DayTask } from "../api";
import { greeting } from "../format";
import { H1 } from "../shell/ui";
import { Kpis } from "./Kpis";
import { RecentPanel } from "./RecentPanel";
import { TodayPanel } from "./TodayPanel";

export function Dashboard({
  data,
  onToggle,
  onOpen,
}: Readonly<{ data: DashboardData | null; onToggle: (task: DayTask) => void; onOpen: (id: string) => void }>) {
  const now = new Date();
  const month = now.toLocaleDateString("id-ID", { month: "short" });

  return (
    <>
      <h1 className={H1}>{greeting(now.getHours())}</h1>
      <Kpis tasks={data?.today} inboxCount={data?.inboxCount ?? 0} month={month} />
      <div className="grid flex-1 grid-cols-2 items-start gap-3.5">
        <TodayPanel tasks={data?.today} onToggle={onToggle} onOpen={onOpen} />
        <RecentPanel items={data?.recent} onOpen={onOpen} />
      </div>
    </>
  );
}
```

- [ ] **Step 4: Hapus `onCount` dari `src/inbox/Inbox.tsx`**

Ganti signature dan effect:

```tsx
export function Inbox({ onOpen }: Readonly<{ onOpen: (id: string) => void }>) {
  const toast = useToast();
  const [items, setItems] = useState<ItemSummary[] | null>(null);

  useEffect(() => {
    api.listInbox().then(setItems, (e) => toast(errorMessage(e), "error"));
  }, [toast]);
```

- [ ] **Step 5: Tulis ulang `src/App.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import { api, type DbStatus } from "./api";
import { AssistantMini } from "./assistant/AssistantMini";
import { Dashboard } from "./dashboard/Dashboard";
import { useDashboard } from "./dashboard/useDashboard";
import { Inbox } from "./inbox/Inbox";
import { ItemPage } from "./item/ItemPage";
import { CommandPalette } from "./palette/CommandPalette";
import { Settings } from "./settings/Settings";
import { Aside } from "./shell/Aside";
import { ComingSoon } from "./shell/ComingSoon";
import { ErrorScreen } from "./shell/ErrorScreen";
import { assistantHint, pageInfo, type PageId } from "./shell/nav";
import { Sidebar } from "./shell/Sidebar";
import { TopBar } from "./shell/TopBar";
import { useToast } from "./shell/toast";

type Page = { name: PageId } | { name: "item"; id: string };
/** Only one overlay is open at a time. */
type Overlay = "palette" | null;

export function App() {
  const toast = useToast();
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [stack, setStack] = useState<Page[]>([{ name: "dashboard" }]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [contributionsVersion, setContributionsVersion] = useState(0);
  const onGithubChanged = useCallback(() => setContributionsVersion((v) => v + 1), []);
  const dashboard = useDashboard();
  const { reload } = dashboard;
  const page = stack[stack.length - 1];
  const ready = status !== null && status.error === null;

  useEffect(() => {
    api.dbStatus().then((s) => {
      setStatus(s);
      if (s.backupError) toast(`Backup harian gagal: ${s.backupError}`, "error");
    });
  }, [toast]);

  // The dashboard and the Inbox dot show counts that other pages change: refresh on every visit.
  useEffect(() => {
    const top = stack[stack.length - 1];
    if (ready && (top.name === "dashboard" || top.name === "inbox")) reload();
  }, [ready, stack, reload]);

  // Ctrl+K (Ctrl+N as an alias) opens the command palette over the current page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (key === "k" || key === "n")) {
        e.preventDefault();
        setOverlay("palette");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!status) return null;
  if (status.error) return <ErrorScreen path={status.path} message={status.error} />;

  const go = (name: PageId) => setStack([{ name }]);
  const openItem = (id: string) => setStack((s) => [...s, { name: "item", id }]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const info = page.name === "item" ? null : pageInfo(page.name);
  const data = dashboard.data;

  return (
    <div className="flex h-full bg-canvas">
      <Sidebar
        current={page.name}
        onSelect={(name) => {
          setOverlay(null);
          go(name);
        }}
        inboxDot={(data?.inboxCount ?? 0) > 0}
      />
      <main className="flex min-w-0 flex-1 flex-col gap-[18px] overflow-y-auto px-7 py-6">
        <TopBar onOpenPalette={() => setOverlay("palette")} />
        {page.name === "dashboard" && <Dashboard data={data} onToggle={dashboard.toggle} onOpen={openItem} />}
        {page.name === "inbox" && <Inbox onOpen={openItem} />}
        {page.name === "item" && <ItemPage key={page.id} id={page.id} onBack={back} />}
        {page.name === "settings" && <Settings onGithubChanged={onGithubChanged} />}
        {info?.about && <ComingSoon page={info} onOpenSettings={() => go("settings")} />}
      </main>
      {page.name === "dashboard" ? (
        <Aside contributionsVersion={contributionsVersion} onOpenSettings={() => go("settings")} />
      ) : (
        <AssistantMini key={page.name} hint={assistantHint(info)} onOpenFull={() => go("dashboard")} />
      )}
      {overlay === "palette" && (
        <CommandPalette
          recent={data?.recent ?? []}
          onClose={() => setOverlay(null)}
          onNavigate={go}
          onOpenItem={openItem}
          onCaptured={reload}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Sesuaikan `scripts/e2e-smoke.sh`**

1. Di `check_items`, tambahkan `sleep 0.3` setelah `xdotool key ctrl+n` supaya palette sempat terbuka sebelum mengetik.
2. Di `check_dashboard`, tambahkan `xdotool key ctrl+n` dan `sleep 0.3` sebelum `xdotool type --delay 20 'tugas terlambat'`, karena palette tertutup setelah Enter pertama.
3. Top bar (42px + gap 18px) sekarang ada di atas Inbox, halaman item, dan Pengaturan, jadi isinya turun 60px. Perkiraan koordinat baru:
   - baris Inbox pertama: `click 300 181` (sebelumnya 121);
   - textarea isi: `click 600 460` (sebelumnya 400);
   - Hapus: `click 848 94` (sebelumnya 34);
   - Ya, hapus: `click 781 98` (sebelumnya 38);
   - Backup sekarang: `click 186 247` (sebelumnya 187).

   Jalankan `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`. Kalau ada yang meleset, ukur ulang dari `4-inbox.png`, `4-item.png`, `4-confirm.png`, dan `6-settings.png`.
4. Tambahkan fungsi berikut setelah `check_items`, lalu panggil setelah `check_items` di daftar bawah:

```bash
check_palette() {
  fresh
  start_app
  xdotool key ctrl+k
  sleep 0.3
  shot 4-palette        # expect: Buka halaman (10 pages), no Terbaru yet
  xdotool type --delay 20 'keu'
  xdotool key Return
  sleep 0.7
  shot 4-palette-keuangan   # expect: Keuangan placeholder page, "Hadir di Fase 2"
  xdotool key ctrl+k
  sleep 0.3
  xdotool key Escape
  sleep 0.3
  shot 4-palette-closed     # expect: palette gone, Keuangan still open
  [[ "$(sql "SELECT COUNT(*) FROM items")" = 0 ]] || fail "opening a page must not save a note"
  stop_app
}
```

- [ ] **Step 7: Pemeriksaan**

Run: `bun run typecheck && bun run test`
Expected: exit 0.

Run: `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`
Expected: `PASS`. Periksa `4-palette.png` dan `5-dashboard.png`.

- [ ] **Step 8: Commit**

```bash
git add -A src scripts/e2e-smoke.sh
git commit -m "feat(shell): top bar opens the command palette on every page"
```

### Task 8: Penutup PR UI-6

- [ ] Jalankan "Prosedur penutup PR" dengan `<base>` = branch UI-5.
  - Screenshot: `4-palette*`, `4-inbox`, `4-item`, `5-dashboard*`.
  - Judul PR: "UI-6: top bar dan command palette".

---

# PR UI-7: panel notifikasi

Branch `feat/<issue UI-7>-ui-7-notifikasi`, dibuat dari branch UI-6.

### Task 9: Pengingat (fungsi murni)

**Files:**
- Create: `src/notifications/reminders.ts`
- Test: `src/notifications/reminders.test.ts`

**Interfaces:**
- Consumes: `DayTask` dari `src/api.ts`.
- Produces: `interface ReminderGroup { title: "Terlambat" | "Hari ini"; tasks: DayTask[] }`, `reminders(today: DayTask[]): ReminderGroup[]`, `reminderCount(today: DayTask[]): number`.

- [ ] **Step 1: Tulis test yang gagal di `src/notifications/reminders.test.ts`**

```ts
import { describe, expect, test } from "bun:test";
import type { DayTask } from "../api";
import { reminderCount, reminders } from "./reminders";

const task = (id: string, overdue: boolean, completedAt: number | null = null): DayTask => ({
  id,
  title: id,
  dueAt: 0,
  completedAt,
  overdue,
});

describe("reminders", () => {
  test("splits open tasks into late and due today, skipping done ones", () => {
    const today = [task("late", true), task("late-done", true, 5), task("today", false), task("today-done", false, 5)];
    expect(reminders(today)).toEqual([
      { title: "Terlambat", tasks: [task("late", true)] },
      { title: "Hari ini", tasks: [task("today", false)] },
    ]);
    expect(reminderCount(today)).toBe(2);
  });

  test("empty groups are left out", () => {
    expect(reminders([task("today", false)]).map((g) => g.title)).toEqual(["Hari ini"]);
    expect(reminders([])).toEqual([]);
    expect(reminderCount([])).toBe(0);
  });
});
```

- [ ] **Step 2: Pastikan test gagal**

Run: `TZ=Asia/Jakarta bun test src/notifications/reminders.test.ts`
Expected: FAIL karena modul `./reminders` tidak ditemukan.

- [ ] **Step 3: Implementasi `src/notifications/reminders.ts`**

```ts
import type { DayTask } from "../api";

export interface ReminderGroup {
  title: "Terlambat" | "Hari ini";
  tasks: DayTask[];
}

/** Notification panel content until modules store their own notifications (spec UI lanjutan U6). */
export function reminders(today: DayTask[]): ReminderGroup[] {
  const open = today.filter((t) => t.completedAt === null);
  const groups: ReminderGroup[] = [
    { title: "Terlambat", tasks: open.filter((t) => t.overdue) },
    { title: "Hari ini", tasks: open.filter((t) => !t.overdue) },
  ];
  return groups.filter((g) => g.tasks.length > 0);
}

export function reminderCount(today: DayTask[]): number {
  return today.filter((t) => t.completedAt === null).length;
}
```

- [ ] **Step 4: Pastikan test lolos**

Run: `TZ=Asia/Jakarta bun test src/notifications/reminders.test.ts`
Expected: PASS, 2 test.

- [ ] **Step 5: Commit**

```bash
git add src/notifications
git commit -m "feat(notifications): derive reminders from late and due-today tasks"
```

### Task 10: Panel notifikasi dan lonceng

**Files:**
- Create: `src/notifications/NotifPanel.tsx`
- Modify: `src/shell/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `scripts/e2e-smoke.sh`

**Interfaces:**
- Consumes: `reminders`, `reminderCount` (Task 9), `shortDate` dari `src/format.ts`, keyframe `anchoa-slide` (Task 3).
- Produces:
  - `NotifPanel({ today: DayTask[]; onClose: () => void; onOpenItem: (id: string) => void })`;
  - `Sidebar` mendapat prop `reminders: number`, `notificationsOpen: boolean`, `onToggleNotifications: () => void`;
  - `Overlay = "palette" | "notifications" | null`.

- [ ] **Step 1: Buat `src/notifications/NotifPanel.tsx`**

```tsx
import { useEffect, useRef } from "react";
import type { DayTask } from "../api";
import { shortDate } from "../format";
import { reminders } from "./reminders";

/** Panel beside the nav rail (docs/design/artboards/NotifPanel.dc.html, spec UI lanjutan U6). */
export function NotifPanel({
  today,
  onClose,
  onOpenItem,
}: Readonly<{ today: DayTask[]; onClose: () => void; onOpenItem: (id: string) => void }>) {
  const groups = reminders(today);
  const count = groups.reduce((n, g) => n + g.tasks.length, 0);
  const closeButton = useRef<HTMLButtonElement>(null);

  // Focus the panel, then give focus back to the bell when it closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previous?.focus();
  }, []);

  return (
    <div
      className="fixed inset-y-0 right-0 left-[72px] z-40"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <button aria-label="Tutup panel notifikasi" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-[#05070a]/60" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="notif-title"
        data-anim
        style={{ animation: "anchoa-slide 0.18s ease-out" }}
        className="absolute inset-y-0 left-0 flex w-[400px] flex-col border-r border-[#2e3440] bg-stage shadow-[16px_0_40px_rgb(0_0_0/0.4)]"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-[18px] pt-5 pb-3">
          <h2 id="notif-title" className="m-0 font-display text-xl font-semibold">
            Notifikasi
          </h2>
          <span className={`rounded-full px-2 py-px font-mono text-[11px] text-canvas ${count > 0 ? "bg-accent" : "bg-disabled"}`}>{count}</span>
          <button
            ref={closeButton}
            onClick={onClose}
            aria-label="Tutup"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-1 pb-3">
          {groups.map((g) => (
            <section key={g.title} aria-label={g.title} className="flex flex-col gap-1">
              <h3 className="m-0 px-2 pt-3 pb-0.5 text-[11px] font-normal tracking-[0.08em] text-muted uppercase">{g.title}</h3>
              {g.tasks.map((t) => (
                <div key={t.id} className="flex flex-col gap-1 rounded-[10px] bg-surface px-2.5 py-2.5">
                  <span className="text-[13px] font-semibold">{t.title || "Tanpa judul"}</span>
                  <span className={`text-xs ${t.overdue ? "text-danger" : "text-muted"}`}>
                    {t.overdue ? `Terlambat · jatuh tempo ${shortDate(t.dueAt)}` : "Jatuh tempo hari ini"}
                  </span>
                  <button
                    onClick={() => {
                      onOpenItem(t.id);
                      onClose();
                    }}
                    aria-label={`Buka ${t.title || "Tanpa judul"}`}
                    className="self-end text-xs text-accent hover:text-accent-hover"
                  >
                    Buka ›
                  </button>
                </div>
              ))}
            </section>
          ))}
          {count === 0 && <p className="m-0 px-4 py-12 text-center text-[13px] text-muted">Tidak ada pengingat.</p>}
        </div>

        <p className="m-0 border-t border-line px-[18px] py-3 text-xs text-muted">
          Pengingat dari tugas berjatuh tempo. Notifikasi lain menyusul bersama modulnya.
        </p>
      </aside>
    </div>
  );
}
```

`aria-label` "Buka <judul>" diawali teks yang terlihat ("Buka"), jadi aturan label-in-name tetap terpenuhi.

- [ ] **Step 2: Tambahkan lonceng di `src/shell/Sidebar.tsx`**

Tambahkan konstanta ikon setelah `ICON`:

```tsx
const BELL = (
  <>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </>
);
```

Ganti signature `Sidebar`:

```tsx
export function Sidebar({
  current,
  onSelect,
  inboxDot = false,
  reminders,
  notificationsOpen,
  onToggleNotifications,
}: Readonly<{
  current: string;
  onSelect: (page: PageId) => void;
  inboxDot?: boolean;
  reminders: number;
  notificationsOpen: boolean;
  onToggleNotifications: () => void;
}>) {
```

Ganti isi `<div className="mt-auto ...">` menjadi:

```tsx
      <div className="mt-auto flex flex-col gap-1.5">
        <button
          onClick={onToggleNotifications}
          aria-label={reminders > 0 ? `Notifikasi, ${reminders} pengingat` : "Notifikasi"}
          title="Notifikasi"
          aria-haspopup="dialog"
          aria-expanded={notificationsOpen}
          className={`${BUTTON} ${notificationsOpen ? "bg-surface-2 text-accent" : "text-muted hover:bg-surface-2"}`}
        >
          <NavIcon>{BELL}</NavIcon>
          {reminders > 0 && <span className="absolute top-[9px] right-[9px] h-[7px] w-[7px] rounded-full bg-danger" />}
        </button>
        {PAGES.filter((p) => p.bottom).map((p) => link(p.id, p.label))}
      </div>
```

- [ ] **Step 3: Pasang di `src/App.tsx`**

Tambahkan import:

```tsx
import { NotifPanel } from "./notifications/NotifPanel";
import { reminderCount } from "./notifications/reminders";
```

Ganti tipe overlay:

```tsx
type Overlay = "palette" | "notifications" | null;
```

Tambahkan prop ke `<Sidebar ...>`:

```tsx
        reminders={reminderCount(data?.today ?? [])}
        notificationsOpen={overlay === "notifications"}
        onToggleNotifications={() => setOverlay((o) => (o === "notifications" ? null : "notifications"))}
```

Tambahkan setelah blok `CommandPalette`:

```tsx
      {overlay === "notifications" && (
        <NotifPanel today={data?.today ?? []} onClose={() => setOverlay(null)} onOpenItem={openItem} />
      )}
```

- [ ] **Step 4: Tambahkan `check_notifications` ke `scripts/e2e-smoke.sh`**

Tambahkan setelah `check_dashboard`, lalu panggil setelah `check_dashboard` di daftar bawah:

```bash
check_notifications() {
  fresh
  start_app
  click 36 652          # bell with no reminders
  shot 7-notif-empty    # expect: "Tidak ada pengingat."
  xdotool key Escape
  xdotool key ctrl+n
  sleep 0.3
  xdotool type --delay 20 'tugas terlambat'
  xdotool key Return
  sleep 1
  sql "UPDATE items SET due_at = CAST(strftime('%s', 'now', 'localtime', 'start of day', '-2 day', 'utc') AS INTEGER) * 1000"
  click 36 148          # Inbox reloads the dashboard data behind the bell
  shot 7-notif-dot      # expect: coral dot on the bell
  click 36 652
  shot 7-notif-late     # expect: group "Terlambat" with "tugas terlambat"
  xdotool key Escape
  sleep 0.3
  shot 7-notif-closed
  xdotool search --name '^Anchoa$' >/dev/null || fail "app window disappeared"
  stop_app
}
```

- [ ] **Step 5: Pemeriksaan**

Run: `bun run typecheck && bun run test`
Expected: exit 0.

Run: `bun tauri build --debug --no-bundle && E2E_ONLY=check_notifications scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`
Expected: `PASS (check_notifications)`. `7-notif-late.png` menampilkan grup Terlambat.

- [ ] **Step 6: Commit**

```bash
git add src scripts/e2e-smoke.sh
git commit -m "feat(notifications): bell and reminder panel beside the nav rail"
```

### Task 11: Penutup PR UI-7

- [ ] Jalankan "Prosedur penutup PR" dengan `<base>` = branch UI-6.
  - Screenshot: `7-notif-*`.
  - Judul PR: "UI-7: panel notifikasi".

---

# PR UI-8: dashboard bento

Branch `feat/<issue UI-8>-ui-8-bento`, dibuat dari branch UI-7.

### Task 12: `upcoming` di backend

**Files:**
- Modify: `src-tauri/src/dashboard.rs`
- Modify: `src/api.ts`

**Interfaces:**
- Produces: Rust `pub struct UpcomingDay { pub date: String, pub tasks: Vec<DayTask> }`, `pub const UPCOMING_DAYS: i64 = 7`, dan field `Dashboard.upcoming: Vec<UpcomingDay>`. TypeScript `interface UpcomingDay { date: string; tasks: DayTask[] }` dan `Dashboard.upcoming: UpcomingDay[]`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `mod tests` pada `src-tauri/src/dashboard.rs`:

```rust
    #[test]
    fn upcoming_covers_the_next_seven_local_days() {
        let conn = open_in_memory();
        note_due(&conn, "hari ini", "2026-10-01T00:00:00+07:00");
        note_due(&conn, "besok", "2026-10-02T00:00:00+07:00");
        note_due(&conn, "besok juga", "2026-10-02T00:00:00+07:00");
        note_due(&conn, "hari ketujuh", "2026-10-08T00:00:00+07:00");
        note_due(&conn, "hari kedelapan", "2026-10-09T00:00:00+07:00");
        let done = note_due(&conn, "selesai", "2026-10-03T00:00:00+07:00");
        complete(&conn, &done, true, 2).unwrap();
        let gone = note_due(&conn, "dihapus", "2026-10-04T00:00:00+07:00");
        delete(&conn, &gone, 2).unwrap();

        // 01:30 on 1 Oct in Jakarta is still 30 Sep in UTC: tomorrow must be 2 Oct.
        let d = get(&conn, ms("2026-10-01T01:30:00+07:00"), &jakarta()).unwrap();

        let days: Vec<(&str, Vec<&str>)> = d
            .upcoming
            .iter()
            .map(|day| (day.date.as_str(), day.tasks.iter().map(|t| t.title.as_str()).collect()))
            .collect();
        assert_eq!(
            days,
            [
                ("2026-10-02", vec!["besok", "besok juga"]),
                ("2026-10-03", vec![]),
                ("2026-10-04", vec![]),
                ("2026-10-05", vec![]),
                ("2026-10-06", vec![]),
                ("2026-10-07", vec![]),
                ("2026-10-08", vec!["hari ketujuh"]),
            ]
        );
        assert!(d.upcoming.iter().flat_map(|day| &day.tasks).all(|t| !t.overdue && t.completed_at.is_none()));
    }
```

- [ ] **Step 2: Pastikan test gagal**

Run: `cd src-tauri && cargo test dashboard::tests::upcoming_covers_the_next_seven_local_days`
Expected: FAIL saat kompilasi dengan pesan `no field upcoming on type Dashboard`.

- [ ] **Step 3: Implementasi di `src-tauri/src/dashboard.rs`**

Ganti import jiff di atas file:

```rust
use jiff::{Timestamp, ToSpan, tz::TimeZone};
```

Tambahkan setelah struct `DayTask`:

```rust
pub const UPCOMING_DAYS: i64 = 7;

/// One column of the "7 hari ke depan" card.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpcomingDay {
    /// Local date, e.g. `2026-10-01`.
    pub date: String,
    pub tasks: Vec<DayTask>,
}
```

Tambahkan field di struct `Dashboard`, setelah `today`:

```rust
    pub upcoming: Vec<UpcomingDay>,
```

Tambahkan fungsi setelah `today_tasks`:

```rust
/// Open tasks due on each of the next seven local days, starting tomorrow.
fn upcoming(conn: &Connection, now: i64, tz: &TimeZone) -> Result<Vec<UpcomingDay>, AppError> {
    let today = Timestamp::from_millisecond(now)?.to_zoned(tz.clone()).date();
    let mut stmt = conn.prepare(
        "SELECT id, title, due_at FROM items
         WHERE deleted_at IS NULL AND completed_at IS NULL AND due_at >= ?1 AND due_at < ?2
         ORDER BY due_at, title, id",
    )?;
    let mut days = Vec::new();
    for offset in 1..=UPCOMING_DAYS {
        let date = today.checked_add(offset.days())?;
        let start = date.to_zoned(tz.clone())?.timestamp().as_millisecond();
        let end = date.tomorrow()?.to_zoned(tz.clone())?.timestamp().as_millisecond();
        let tasks = stmt
            .query_map(params![start, end], |r| {
                Ok(DayTask { id: r.get(0)?, title: r.get(1)?, due_at: r.get(2)?, completed_at: None, overdue: false })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        days.push(UpcomingDay { date: date.to_string(), tasks });
    }
    Ok(days)
}
```

Di `get`, tambahkan setelah `today: today_tasks(conn, start, end)?,`:

```rust
        upcoming: upcoming(conn, now, tz)?,
```

- [ ] **Step 4: Pastikan test lolos**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`
Expected: semua test lolos, clippy exit 0.

- [ ] **Step 5: Tambahkan tipe di `src/api.ts`**

Tambahkan setelah `interface DayTask`:

```ts
/** One day of the "7 hari ke depan" card; `date` is the local date, e.g. "2026-10-01". */
export interface UpcomingDay {
  date: string;
  tasks: DayTask[];
}
```

Tambahkan `upcoming: UpcomingDay[];` ke `interface Dashboard`, setelah `today`.

Run: `bun run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/dashboard.rs src/api.ts
git commit -m "feat(dashboard): open tasks for each of the next seven days"
```

### Task 13: Label hari dan ringkasan satu baris

**Files:**
- Modify: `src/format.ts`, `src/format.test.ts`
- Create: `src/dashboard/summary.ts`
- Test: `src/dashboard/summary.test.ts`

**Interfaces:**
- Produces: `upcomingLabel(date: string): { weekday: string; day: number }` di `format.ts`, dan `summaryLine(today: DayTask[], inboxCount: number): string` di `dashboard/summary.ts`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `src/format.test.ts`, dan tambahkan `upcomingLabel` ke import di atas file:

```ts
describe("upcomingLabel", () => {
  test("reads the local date without shifting it", () => {
    expect(upcomingLabel("2026-10-01")).toEqual({ weekday: "Kam", day: 1 });
    expect(upcomingLabel("2026-10-04")).toEqual({ weekday: "Min", day: 4 });
  });
});
```

Buat `src/dashboard/summary.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { DayTask } from "../api";
import { summaryLine } from "./summary";

const task = (overdue: boolean, completedAt: number | null = null): DayTask => ({
  id: String(overdue),
  title: "t",
  dueAt: 0,
  completedAt,
  overdue,
});

describe("summaryLine", () => {
  test("counts open tasks, late ones and Inbox notes", () => {
    expect(summaryLine([task(true), task(false), task(false), task(false, 9)], 2)).toBe(
      "3 tugas hari ini · 1 terlambat · 2 catatan di Inbox",
    );
  });

  test("quiet day", () => {
    expect(summaryLine([task(false, 9)], 0)).toBe("Tidak ada tugas tersisa hari ini · Inbox kosong");
  });
});
```

- [ ] **Step 2: Pastikan test gagal**

Run: `bun run test`
Expected: FAIL karena `upcomingLabel` dan `./summary` belum ada.

- [ ] **Step 3: Implementasi**

Tambahkan di akhir `src/format.ts`:

```ts
/** "2026-10-01" (a local date from the backend) to { weekday: "Kam", day: 1 }. */
export function upcomingLabel(date: string): { weekday: string; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).toLocaleDateString("id-ID", { weekday: "short" });
  return { weekday, day };
}
```

Buat `src/dashboard/summary.ts`:

```ts
import type { DayTask } from "../api";

/** One line under the greeting, e.g. "3 tugas hari ini · 1 terlambat · 2 catatan di Inbox". */
export function summaryLine(today: DayTask[], inboxCount: number): string {
  const open = today.filter((t) => t.completedAt === null);
  const late = open.filter((t) => t.overdue).length;
  const parts = [open.length === 0 ? "Tidak ada tugas tersisa hari ini" : `${open.length} tugas hari ini`];
  if (late > 0) parts.push(`${late} terlambat`);
  parts.push(inboxCount === 0 ? "Inbox kosong" : `${inboxCount} catatan di Inbox`);
  return parts.join(" · ");
}
```

- [ ] **Step 4: Pastikan test lolos**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/format.ts src/format.test.ts src/dashboard/summary.ts src/dashboard/summary.test.ts
git commit -m "feat(dashboard): weekday labels and the one-line summary"
```

### Task 14: Bento

**Files:**
- Create: `src/dashboard/UpcomingCard.tsx`, `src/dashboard/ModuleCard.tsx`
- Modify: `src/dashboard/TodayPanel.tsx`, `src/dashboard/RecentPanel.tsx`, `src/dashboard/Dashboard.tsx` (seluruh file), `src/App.tsx`
- Delete: `src/dashboard/Kpis.tsx`
- Modify: `scripts/e2e-smoke.sh`

**Interfaces:**
- Consumes: `UpcomingDay` (Task 12), `upcomingLabel`, `summaryLine` (Task 13), `pageInfo`, `NavPage`, `PageId` (Task 1).
- Produces: `Dashboard({ data; onToggle; onOpen; onSelect: (page: PageId) => void })`.

- [ ] **Step 1: Kartu Hari ini membawa bar segmen**

Di `src/dashboard/TodayPanel.tsx`, tambahkan fungsi berikut di atas `TodayPanel`. Fungsi ini dipindah dari `Kpis.tsx`:

```tsx
function segmentColor(t: DayTask): string {
  if (t.completedAt !== null) return "bg-accent";
  return t.overdue ? "bg-danger" : "bg-line";
}
```

Ganti `<section className={`${PANEL} flex flex-col gap-1`}>` menjadi `<section className={`${PANEL} col-span-2 flex flex-col gap-1`}>`. Ganti blok header (`<div className="mb-2 flex items-baseline justify-between"> … </div>`) menjadi:

```tsx
      <div className="flex items-baseline justify-between">
        <h2 className={H2}>Hari ini</h2>
        <span className="font-mono text-xs text-muted">
          {done}/{list.length} selesai
        </span>
      </div>
      <div aria-hidden="true" className="mb-2 flex gap-1 py-1">
        {list.map((t) => (
          <span key={t.id} className={`h-1 flex-1 rounded-sm transition-colors ${segmentColor(t)}`} />
        ))}
      </div>
```

- [ ] **Step 2: Catatan terbaru (3 item)**

Di `src/dashboard/RecentPanel.tsx`, ganti judul `Item terbaru` menjadi `Catatan terbaru`, dan ganti `items?.map(` menjadi `items?.slice(0, 3).map(`. Tambahkan komentar di atas fungsi:

```tsx
/** Fills the "Berkas terbaru" slot of the bento until Berkas lands in Fase 6 (spec U9). */
```

- [ ] **Step 3: Buat `src/dashboard/ModuleCard.tsx`**

```tsx
import type { NavPage, PageId } from "../shell/nav";
import { H2, PANEL } from "../shell/ui";

/** Bento card for a module that a later fase builds; opens its placeholder page. */
export function ModuleCard({ page, onSelect }: Readonly<{ page: NavPage; onSelect: (id: PageId) => void }>) {
  return (
    <button onClick={() => onSelect(page.id)} className={`${PANEL} flex flex-col items-start gap-1.5 text-left transition-colors hover:bg-surface-2`}>
      <h2 className={H2}>{page.label}</h2>
      <span className="text-xs text-accent">Hadir di Fase {page.fase}</span>
      <span className="line-clamp-2 text-xs leading-relaxed text-muted">{page.about}</span>
    </button>
  );
}
```

- [ ] **Step 4: Buat `src/dashboard/UpcomingCard.tsx`**

```tsx
import type { UpcomingDay } from "../api";
import { upcomingLabel } from "../format";
import { H2, PANEL } from "../shell/ui";

/** Next seven days: weekday, date, one dot per task, first task, "+n lagi" (spec U10). */
export function UpcomingCard({ days, onOpen }: Readonly<{ days?: UpcomingDay[]; onOpen: (id: string) => void }>) {
  return (
    <section className={`${PANEL} col-span-2 flex flex-col gap-3`}>
      <h2 className={H2}>7 hari ke depan</h2>
      <div className="grid grid-cols-7 gap-2">
        {days?.map((d) => {
          const { weekday, day } = upcomingLabel(d.date);
          const first = d.tasks[0];
          return (
            <div key={d.date} className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-stage px-2 py-2.5">
              <span className="text-[11px] tracking-[0.08em] text-muted uppercase">{weekday}</span>
              <span className="font-mono text-lg leading-none">{day}</span>
              <span aria-hidden="true" className="flex h-1.5 gap-1">
                {d.tasks.slice(0, 4).map((t) => (
                  <span key={t.id} className="h-1.5 w-1.5 rounded-full bg-accent" />
                ))}
              </span>
              {first ? (
                <button onClick={() => onOpen(first.id)} className="truncate text-left text-xs text-ink hover:text-accent">
                  {first.title || "Tanpa judul"}
                </button>
              ) : (
                <span className="text-xs text-disabled">—</span>
              )}
              {d.tasks.length > 1 && <span className="text-[11px] text-muted">+{d.tasks.length - 1} lagi</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Tulis ulang `src/dashboard/Dashboard.tsx` dan hapus `Kpis.tsx`**

Run: `git rm -q src/dashboard/Kpis.tsx`

```tsx
import type { Dashboard as DashboardData, DayTask } from "../api";
import { greeting } from "../format";
import { pageInfo, type PageId } from "../shell/nav";
import { H1, SECONDARY } from "../shell/ui";
import { ModuleCard } from "./ModuleCard";
import { RecentPanel } from "./RecentPanel";
import { summaryLine } from "./summary";
import { TodayPanel } from "./TodayPanel";
import { UpcomingCard } from "./UpcomingCard";

/** Bento recap from docs/design/artboards/Main.dc.html (spec UI lanjutan U9). */
export function Dashboard({
  data,
  onToggle,
  onOpen,
  onSelect,
}: Readonly<{
  data: DashboardData | null;
  onToggle: (task: DayTask) => void;
  onOpen: (id: string) => void;
  onSelect: (page: PageId) => void;
}>) {
  const now = new Date();
  const moduleCard = (id: PageId) => <ModuleCard page={pageInfo(id)} onSelect={onSelect} />;

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className={H1}>{greeting(now.getHours())}</h1>
          <p className="m-0 truncate text-sm text-muted">{data ? summaryLine(data.today, data.inboxCount) : " "}</p>
        </div>
        <button disabled title="Hadir di Fase 5" className={`${SECONDARY} shrink-0 disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent`}>
          Dengarkan rekap
        </button>
      </div>
      <div className="grid grid-cols-3 items-start gap-3.5">
        <TodayPanel tasks={data?.today} onToggle={onToggle} onOpen={onOpen} />
        {moduleCard("keuangan")}
        <UpcomingCard days={data?.upcoming} onOpen={onOpen} />
        {moduleCard("email")}
        {moduleCard("proyek")}
        {moduleCard("unduhan")}
        <RecentPanel items={data?.recent} onOpen={onOpen} />
      </div>
    </>
  );
}
```

- [ ] **Step 6: Oper `onSelect` dari `src/App.tsx`**

Ganti baris Dashboard:

```tsx
        {page.name === "dashboard" && <Dashboard data={data} onToggle={dashboard.toggle} onOpen={openItem} onSelect={go} />}
```

- [ ] **Step 7: Sesuaikan `check_dashboard` di `scripts/e2e-smoke.sh`**

1. Setelah capture kedua, tambahkan capture ketiga:

   ```bash
   xdotool key ctrl+n
   sleep 0.3
   xdotool type --delay 20 'tugas besok'
   xdotool key Return
   sleep 1
   ```

   Lalu setelah dua `UPDATE` yang ada, tambahkan:

   ```bash
   sql "UPDATE items SET due_at = CAST(strftime('%s', 'now', 'localtime', 'start of day', '+1 day', 'utc') AS INTEGER) * 1000 WHERE title = 'tugas besok'"
   ```

2. Ganti komentar screenshot:
   - `shot 5-dashboard      # expect: bento, "2 tugas hari ini · 1 terlambat", "tugas besok" in the first upcoming column`
   - `shot 5-dashboard-done # expect: row struck through, "1/2 selesai"`
3. Jalankan `bun tauri build --debug --no-bundle && E2E_ONLY=check_dashboard scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`. Kalau centang tugas gagal, ukur ulang posisi checkbox baris pertama dari `5-dashboard.png`, lalu perbarui `click 137 374`.

- [ ] **Step 8: Pemeriksaan**

Run: `bun run typecheck && bun run test && (cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings)`
Expected: exit 0.

Run: `bun tauri build --debug --no-bundle && scripts/e2e-smoke.sh src-tauri/target/debug/anchoa`
Expected: `PASS`.

- [ ] **Step 9: Commit**

```bash
git add -A src scripts/e2e-smoke.sh
git commit -m "feat(dashboard): bento recap with next seven days and module cards"
```

### Task 15: Penutup PR UI-8

- [ ] Jalankan "Prosedur penutup PR" dengan `<base>` = branch UI-7.
  - Screenshot: `5-dashboard*` dan `9-github-*` (aside tidak boleh berubah).
  - Judul PR: "UI-8: dashboard bento".
  - Body PR mencatat bahwa migrasi DB tidak berubah (`user_version` tetap 3), karena `upcoming` hanya berupa query.
