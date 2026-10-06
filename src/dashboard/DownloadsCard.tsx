import { FishProgress } from "../components/FishProgress";
import type { DownloadsSummary } from "../api";
import { formatEta, formatSpeed } from "../downloads/view";
import type { PageId } from "../shell/nav";

/** Bento card: lists up to two active downloads with progress bars. Opens Unduhan. */
export function DownloadsCard({
  downloads,
  onSelect,
}: Readonly<{
  downloads?: DownloadsSummary;
  onSelect: (page: PageId) => void;
}>) {
  const items = downloads?.items ?? [];
  return (
    <button
      type="button"
      onClick={() => onSelect("unduhan")}
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
          <path d="M12 4v11M7 10l5 5 5-5" />
          <path d="M5 20h14" />
        </svg>
        <span id="c-unduh" className="font-display text-sm font-semibold text-ink">Unduhan</span>
        {downloads && downloads.speed > 0 ? (
          <span className="ml-auto font-mono text-[11px] text-accent">
            ↓ {formatSpeed(downloads.speed)}
          </span>
        ) : (
          <span className="ml-auto text-xs text-accent">›</span>
        )}
      </div>
      {items.length === 0 ? (
        <span className="text-xs text-muted">Tidak ada unduhan aktif</span>
      ) : (
        items.map((item) => {
          let secondary = `${item.progress}%`;
          if (item.status === "processing") {
            secondary = "Memproses (ffmpeg)…";
          } else if (item.status === "queued") {
            secondary = "Menunggu";
          } else if (item.eta !== null && item.eta !== undefined && item.eta > 0) {
            secondary = `${item.progress}% · ${formatEta(item.eta)} lagi`;
          } else if (item.speed !== null && item.speed !== undefined && item.speed > 0) {
            secondary = `${item.progress}% · ${formatSpeed(item.speed)}`;
          }

          return (
            <div
              key={item.id}
              aria-label={`${item.title} · ${item.progress}%`}
              className="flex w-full min-w-0 flex-col gap-1"
            >
              <div className="flex w-full items-center justify-between gap-2 text-xs">
                <span className="truncate text-ink">{item.title}</span>
                <span className="shrink-0 font-mono text-muted">{item.progress}%</span>
              </div>
              <FishProgress
                value={item.status === "done" ? 100 : item.progress}
                label={item.title}
                state={
                  item.status === "done"
                    ? "done"
                    : item.status === "failed"
                      ? "error"
                      : item.status === "running" || item.status === "processing"
                        ? "running"
                        : "paused"
                }
                className="h-2"
              />
              <span className="truncate font-mono text-[11px] text-muted">{secondary}</span>
            </div>
          );
        })
      )}
    </button>
  );
}
