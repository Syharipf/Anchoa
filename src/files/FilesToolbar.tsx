import type { Crumb } from "../api";

export function FilesToolbar({
  canGoBack,
  canGoForward,
  canGoUp,
  onGoBack,
  onGoForward,
  onGoUp,
  crumbs,
  onNavigate,
  view,
  onToggleView,
  showHidden,
  onToggleHidden,
  clipboardCount,
  onPaste,
  onClearClipboard,
}: Readonly<{
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onGoUp: () => void;
  crumbs: readonly Crumb[];
  onNavigate: (path: string) => void;
  view: "grid" | "list";
  onToggleView: (view: "grid" | "list") => void;
  showHidden: boolean;
  onToggleHidden: (show: boolean) => void;
  clipboardCount: number;
  onPaste: () => void;
  onClearClipboard: () => void;
}>) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-0.5">
        <button
          type="button"
          disabled={!canGoBack}
          onClick={onGoBack}
          aria-label="Kembali"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-ink transition-colors hover:bg-surface-2 disabled:text-disabled"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </button>
        <button
          type="button"
          disabled={!canGoForward}
          onClick={onGoForward}
          aria-label="Maju"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-ink transition-colors hover:bg-surface-2 disabled:text-disabled"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
        <button
          type="button"
          disabled={!canGoUp}
          onClick={onGoUp}
          aria-label="Naik satu folder"
          className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-ink transition-colors hover:bg-surface-2 disabled:text-disabled"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 19V5M6 11l6-6 6 6" />
          </svg>
        </button>
      </div>

      <nav
        aria-label="Lokasi"
        className="flex min-w-0 flex-1 items-center gap-0.5 rounded-[10px] border border-line bg-surface px-1.5 py-[3px] text-[13px]"
      >
        {crumbs.map((crumb, idx) => {
          const isLast = idx === crumbs.length - 1;
          return (
            <span key={crumb.path} className="flex min-w-0 items-center gap-0.5">
              {idx > 0 && (
                <span aria-hidden="true" className="text-disabled">
                  /
                </span>
              )}
              {isLast ? (
                <span
                  aria-current="page"
                  className="truncate px-2 py-1 font-semibold text-ink"
                >
                  {crumb.name}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate(crumb.path)}
                  className="truncate rounded-md px-2 py-1 text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  {crumb.name}
                </button>
              )}
            </span>
          );
        })}
      </nav>

      <div
        role="group"
        aria-label="Tampilan"
        className="flex gap-0.5 rounded-[10px] border border-line bg-surface p-[3px]"
      >
        <button
          type="button"
          onClick={() => onToggleView("grid")}
          aria-label="Tampilan ikon"
          aria-pressed={view === "grid"}
          className={`flex h-[30px] w-8 items-center justify-center rounded-[7px] transition-colors ${
            view === "grid"
              ? "bg-surface-2 text-ink"
              : "text-muted hover:text-ink"
          }`}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="7" height="7" rx="1.5" />
            <rect x="14" y="3" width="7" height="7" rx="1.5" />
            <rect x="3" y="14" width="7" height="7" rx="1.5" />
            <rect x="14" y="14" width="7" height="7" rx="1.5" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onToggleView("list")}
          aria-label="Tampilan daftar"
          aria-pressed={view === "list"}
          className={`flex h-[30px] w-8 items-center justify-center rounded-[7px] transition-colors ${
            view === "list"
              ? "bg-surface-2 text-ink"
              : "text-muted hover:text-ink"
          }`}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
          </svg>
        </button>
      </div>

      <label className="flex cursor-pointer select-none items-center gap-2 text-xs text-muted">
        <input
          type="checkbox"
          checked={showHidden}
          onChange={(e) => onToggleHidden(e.target.checked)}
          className="accent-accent"
        />
        <span>Tampilkan tersembunyi</span>
      </label>

      {clipboardCount > 0 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPaste}
            className="flex min-h-[34px] items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-canvas transition-transform hover:scale-105 active:scale-95"
          >
            <span>Tempel {clipboardCount} item</span>
          </button>
          <button
            type="button"
            onClick={onClearClipboard}
            aria-label="Kosongkan papan klip"
            title="Kosongkan papan klip"
            className="flex h-[34px] w-[34px] items-center justify-center rounded-lg border border-line text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
