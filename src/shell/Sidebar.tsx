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
