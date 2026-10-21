import type { LibraryOverview } from "../api";
import type { PageId } from "../shell/nav";
import { KIND_LABEL, hasProgress, progressPercent, progressText } from "../library/view";

/** Bento card: summary of library (active items with progress, finished this month, want count). */
export function LibraryCard({
  overview,
  onSelect,
}: Readonly<{
  overview?: LibraryOverview;
  onSelect: (page: PageId) => void;
}>) {
  if (!overview) return null;
  const activeItems = overview.active.slice(0, 2);
  const totalSignals = activeItems.length + overview.finishedThisMonth + overview.want;
  if (totalSignals === 0) return null;

  return (
    <button
      type="button"
      onClick={() => onSelect("library")}
      className="flex w-full flex-col items-start gap-2 overflow-hidden rounded-[14px] border border-line bg-surface p-3 px-3.5 text-left text-ink transition-colors hover:bg-surface-2"
    >
      <div className="flex w-full items-center gap-2">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted"
          aria-hidden="true"
        >
          <path d="M4 4h4v16H4z" />
          <path d="M10 4h4v16h-4z" />
          <path d="M17 5l3 15" />
        </svg>
        <span id="c-library" className="font-display text-sm font-semibold text-ink">
          Library
        </span>
        <span className="ml-auto text-xs text-accent">›</span>
      </div>

      <div className="flex w-full flex-col gap-2">
        {activeItems.map((item) => {
          const showProgress = hasProgress(item);
          const pct = progressPercent(item);
          const progText = progressText(item);
          return (
            <div key={item.id} className="flex w-full flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-medium text-ink">{item.title}</span>
                <span className="shrink-0 text-[11px] text-muted">{KIND_LABEL[item.kind]}</span>
              </div>
              {showProgress ? (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="shrink-0 font-mono text-[10.5px] text-muted">{progText}</span>
                </div>
              ) : null}
            </div>
          );
        })}

        <div className="flex items-center gap-3 pt-0.5 text-xs text-muted">
          {overview.finishedThisMonth > 0 ? (
            <span>
              <strong className="font-mono text-ink">{overview.finishedThisMonth}</strong> finished this month
            </span>
          ) : null}
          {overview.want > 0 ? (
            <span>
              <strong className="font-mono text-ink">{overview.want}</strong> want to watch/read
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}
