import { useCallback, useEffect, useState, type ReactNode } from "react";
import { PAGES, type PageId } from "./nav";
import { AnchoaLogo } from "../brand/AnchoaLogo";

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
  jurnal: (
    <>
      <path d="M6 3h11a2 2 0 0 1 2 2v16H8a2 2 0 0 1-2-2z" />
      <path d="M6 17a2 2 0 0 1 2-2h11" />
      <path d="M10 7h5M10 10h3" />
    </>
  ),
  catatan: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8M16 17H8M10 9H8" />
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
  habit: (
    <path d="M12 2.5c.8 3.2 5 5.3 5 10a5 5 0 0 1-10 0c0-2.3 1.1-3.9 2.4-5 .1 1.7.9 2.8 2.1 3.2-.6-3 .1-5.9.5-8.2z" />
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

const BELL = (
  <>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </>
);

const CHEVRON_LEFT = <path d="M15 6l-6 6 6 6" />;
const CHEVRON_RIGHT = <path d="M9 6l6 6-6 6" />;

const COLLAPSED_KEY = "anchoa.sidebar.collapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // Ignore localStorage write errors.
  }
}

const BUTTON = "relative flex h-12 w-12 items-center justify-center rounded-xl transition-colors";

function NavIcon({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Sidebar navigation rail with collapsed/expanded behavior per DESIGN.md.
 *  Closed: 72px rail, icons only, no labels.
 *  Open: semi-transparent layer, circular icon arrangement, labels appear.
 */
export function Sidebar({
  current,
  onSelect,
  reminders,
  notificationsOpen,
  onToggleNotifications,
}: Readonly<{
  current: string;
  onSelect: (page: PageId) => void;
  reminders: number;
  notificationsOpen: boolean;
  onToggleNotifications: () => void;
}>) {
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const toggle = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      saveCollapsed(next);
      return next;
    });
  }, []);

  // Ctrl+B toggles the rail; Ctrl+K/Ctrl+N stay with the command palette in App.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const link = (id: PageId, label: string) => (
    <button
      type="button"
      key={id}
      onClick={() => onSelect(id)}
      aria-label={label}
      title={label}
      aria-current={current === id ? "page" : undefined}
      className={`${BUTTON} ${current === id ? "bg-surface-2 text-accent" : "text-muted hover:bg-surface-2"}`}
    >
      <NavIcon>{ICON[id]}</NavIcon>
    </button>
  );

  return (
    <div className="flex shrink-0">
      <nav
        aria-label="Menu utama"
        aria-hidden={collapsed}
        inert={collapsed}
        className={`flex flex-col items-center gap-1.5 overflow-hidden bg-sidebar py-4 transition-[width] duration-200 ${collapsed ? "w-0" : "w-[72px] border-r border-line relative"}`}
      >
        <div className="mb-2 shrink-0">
          <AnchoaLogo tile size={40} label="Logo Anchoa" />
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-label="Sembunyikan menu samping"
          aria-expanded={!collapsed}
          title="Sembunyikan menu samping (Ctrl+B)"
          aria-hidden={collapsed}
          className={`${BUTTON} text-muted hover:bg-surface-2`}
        >
          <NavIcon>{CHEVRON_LEFT}</NavIcon>
        </button>
        {PAGES.filter((p) => !p.bottom).map((p) => link(p.id, p.label))}
        <div className="mt-auto flex flex-col gap-1.5">
          <button
            type="button"
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
      </nav>
      {collapsed && (
        <button
          type="button"
          onClick={toggle}
          aria-label="Tampilkan menu samping"
          aria-expanded={false}
          title="Tampilkan menu samping (Ctrl+B)"
          className="flex w-6 shrink-0 items-center justify-center border-r border-line bg-sidebar text-muted transition-colors hover:bg-surface-2 hover:text-accent"
        >
          <NavIcon>{CHEVRON_RIGHT}</NavIcon>
        </button>
      )}
    </div>
  );
}