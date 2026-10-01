import type { DownloadsSummary } from "../api";
import { formatEta, formatSpeed } from "../downloads/view";
import type { PageId } from "../shell/nav";
import { H2, PANEL } from "../shell/ui";

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
      className={`${PANEL} flex w-full flex-col items-start gap-2.5 text-left transition-colors hover:bg-surface-2`}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <div className="flex items-center gap-2">
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
          <span className={`${H2} block`}>Unduhan</span>
        </div>
        {downloads && downloads.speed > 0 ? (
          <span className="font-mono text-[11px] text-accent">
            ↓ {formatSpeed(downloads.speed)}
          </span>
        ) : null}
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
              <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-sm bg-line">
                <div
                  style={{ width: `${item.progress}%` }}
                  className="h-full rounded-sm bg-accent transition-all"
                />
              </div>
              <span className="truncate font-mono text-[11px] text-muted">{secondary}</span>
            </div>
          );
        })
      )}
    </button>
  );
}
