import type { ReactNode } from "react";

export type TopPage = "dashboard" | "inbox" | "settings";

const ICON = {
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
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </>
  ),
} satisfies Record<TopPage, ReactNode>;

const LABEL: Record<TopPage, string> = { dashboard: "Dashboard", inbox: "Inbox", settings: "Pengaturan" };

/** Icon-only navigation rail (72px). */
export function Sidebar({
  current,
  onSelect,
  inboxDot = false,
}: Readonly<{ current: string; onSelect: (page: TopPage) => void; inboxDot?: boolean }>) {
  const link = (page: TopPage) => (
    <button
      key={page}
      onClick={() => onSelect(page)}
      aria-label={LABEL[page]}
      title={LABEL[page]}
      aria-current={current === page ? "page" : undefined}
      className={`relative flex h-12 w-12 items-center justify-center rounded-xl transition-colors ${
        current === page ? "bg-surface-2 text-accent" : "text-muted hover:bg-surface-2"
      }`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICON[page]}
      </svg>
      {page === "inbox" && inboxDot && <span className="absolute top-[9px] right-[9px] h-[7px] w-[7px] rounded-full bg-accent" />}
    </button>
  );

  return (
    <nav aria-label="Menu utama" className="flex w-[72px] shrink-0 flex-col items-center gap-2 border-r border-line bg-sidebar py-5">
      {/* Placeholder until the real Anchoa logo file exists. */}
      <svg width="40" height="40" viewBox="0 0 40 40" role="img" aria-label="Logo Anchoa" className="mb-4">
        <rect width="40" height="40" rx="12" className="fill-accent" />
        <text x="20" y="26" textAnchor="middle" className="fill-canvas font-display text-lg font-semibold">
          A
        </text>
      </svg>
      {link("dashboard")}
      {link("inbox")}
      <div className="mt-auto">{link("settings")}</div>
    </nav>
  );
}
