import { FishProgress } from "../components/FishProgress";
import { useState } from "react";
import type { DownloadView } from "../api";
import {
  filterDownloads,
  metaText,
  progressPercent,
  progressText,
  STATUS_LABELS,
  STATUS_TEXT,
  tabCounts,
  TAB_LABELS,
  type DownloadTab,
} from "./view";

const TABS: readonly DownloadTab[] = ["all", "active", "done", "failed"];

function downloadProgressValue(status: DownloadView["status"], totalBytes: number | null, pct: number): number | undefined {
  if (status === "done") return 100;
  if (totalBytes && totalBytes > 0) return pct;
  if (status === "queued" || status === "failed") return 0;
  return undefined;
}

function downloadProgressState(status: DownloadView["status"]): "error" | "paused" | "done" | "running" {
  if (status === "failed") return "error";
  if (status === "paused" || status === "queued") return "paused";
  if (status === "done") return "done";
  return "running";
}

export function DownloadQueue({
  items,
  onPause,
  onResume,
  onRetry,
  onRemove,
  onOpen,
  onReveal,
}: Readonly<{
  items: readonly DownloadView[];
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onOpen: (id: string) => void;
  onReveal: (id: string) => void;
}>) {
  const [tab, setTab] = useState<DownloadTab>("all");
  const counts = tabCounts(items);
  const visible = filterDownloads(items, tab);

  return (
    <section
      aria-labelledby="antrean-judul"
      className="flex flex-1 min-h-0 flex-col overflow-hidden rounded-2xl border border-line bg-stage"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-line bg-sidebar px-2.5 py-2">
        <h2 id="antrean-judul" className="mx-2 text-sm font-semibold font-display text-ink">
          Antrean
        </h2>
        {TABS.map((t) => {
          const active = tab === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={active}
              className={`flex min-h-[30px] items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors ${
                active ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {TAB_LABELS[t]}
              <span className="font-mono text-[11px] text-muted">{counts[t]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="py-10 px-4 text-center text-xs text-muted">
            Tidak ada unduhan di tab ini.
          </div>
        ) : (
          visible.map((row) => {
            const isAudio = row.kind === "media" && row.options?.audioOnly;
            const isVideo = row.kind === "media" && !row.options?.audioOnly;
            const isFile = row.kind === "file";
            const pct = progressPercent(row);

            return (
              <div
                key={row.id}
                className="flex items-center gap-3 border-b border-line/60 bg-transparent px-3.5 py-2.5 transition-colors hover:bg-surface-2/40"
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 ${
                    row.status === "failed"
                      ? "text-danger"
                      : row.status === "running"
                        ? "text-accent"
                        : "text-muted"
                  }`}
                >
                  {isVideo && (
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="5" width="18" height="14" rx="2" />
                      <path d="M10 9.5v5l4-2.5z" />
                    </svg>
                  )}
                  {isAudio && (
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M9 18V6l11-2v12" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="17" cy="16" r="3" />
                    </svg>
                  )}
                  {isFile && (
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M6 3h9l3 3v15H6z" />
                      <path d="M12 10v6M9.5 13.5L12 16l2.5-2.5" />
                    </svg>
                  )}
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    title={row.title}
                    className="truncate text-sm font-medium text-ink"
                  >
                    {row.title}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {metaText(row)}
                  </span>
                </div>

                <div className="flex w-56 shrink-0 flex-col gap-1.5">
                  <FishProgress
                    value={downloadProgressValue(row.status, row.totalBytes, pct)}
                    label={row.title}
                    state={downloadProgressState(row.status)}
                    className="h-3 w-full"
                  />
                  <span
                    className={`truncate font-mono text-[11px] ${
                      row.status === "failed" ? "text-danger" : "text-muted"
                    }`}
                  >
                    {progressText(row)}
                  </span>
                </div>

                <span
                  className={`flex w-24 shrink-0 items-center gap-1.5 text-xs ${STATUS_TEXT[row.status]}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      row.status === "running"
                        ? "bg-accent"
                        : row.status === "failed"
                          ? "bg-danger"
                          : row.status === "processing"
                            ? "bg-heat-3"
                            : row.status === "done"
                              ? "bg-heat-2"
                              : "bg-disabled"
                    }`}
                  />
                  {STATUS_LABELS[row.status]}
                </span>

                <div className="flex w-24 shrink-0 items-center justify-end gap-1">
                  {row.status === "running" && (
                    <button
                      type="button"
                      onClick={() => onPause(row.id)}
                      aria-label={`Jeda ${row.title}`}
                      title="Jeda"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink hover:bg-surface-2"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <rect x="6" y="5" width="4" height="14" rx="1" />
                        <rect x="14" y="5" width="4" height="14" rx="1" />
                      </svg>
                    </button>
                  )}
                  {row.status === "paused" && (
                    <button
                      type="button"
                      onClick={() => onResume(row.id)}
                      aria-label={`Lanjutkan ${row.title}`}
                      title="Lanjutkan"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-accent hover:bg-surface-2"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </button>
                  )}
                  {row.status === "failed" && (
                    <button
                      type="button"
                      onClick={() => onRetry(row.id)}
                      aria-label={`Coba lagi ${row.title}`}
                      title="Coba lagi"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-accent hover:bg-surface-2"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 4v6h6" />
                        <path d="M20 12a8 8 0 0 0-14.9-4L4 10" />
                        <path d="M4 12a8 8 0 0 0 14.9 4" />
                      </svg>
                    </button>
                  )}
                  {row.status === "done" && (
                    <>
                      <button
                        type="button"
                        onClick={() => onOpen(row.id)}
                        aria-label={`Buka berkas ${row.title}`}
                        title="Buka berkas"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-ink hover:bg-surface-2"
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
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => onReveal(row.id)}
                        aria-label={`Buka folder ${row.title}`}
                        title="Buka di Berkas"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-ink hover:bg-surface-2"
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        </svg>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemove(row.id)}
                    aria-label={
                      row.status === "done"
                        ? `Hapus dari daftar: ${row.title}`
                        : `Batalkan: ${row.title}`
                    }
                    title={row.status === "done" ? "Hapus dari daftar" : "Batalkan"}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-danger"
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.4"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
