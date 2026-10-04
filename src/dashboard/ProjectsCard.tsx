import { FishProgress } from "../components/FishProgress";
import type { ProjectSummary } from "../api";
import type { PageId } from "../shell/nav";

/** Bento card: lists up to two active projects with progress bars. Opens Proyek. */
export function ProjectsCard({
  projects,
  onSelect,
}: Readonly<{
  projects?: ProjectSummary[];
  onSelect: (page: PageId) => void;
}>) {
  const list = projects?.slice(0, 2) ?? [];

  return (
    <button
      type="button"
      onClick={() => onSelect("proyek")}
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
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M8 7v7M12 7v4M16 7v10" />
        </svg>
        <span id="c-proyek" className="font-display text-sm font-semibold text-ink">Proyek</span>
        <span className="ml-auto text-xs text-accent">›</span>
      </div>
      {list.length === 0 ? (
        <span className="text-xs text-muted">Belum ada proyek</span>
      ) : (
        list.map((p) => {
          const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
          return (
            <div key={p.id} aria-label={`${p.name} · ${pct}%`} className="flex w-full flex-col gap-1">
              <div className="flex w-full items-center justify-between gap-2 text-xs">
                <span className="truncate text-ink">{p.name}</span>
                <span className="shrink-0 font-mono text-muted">{pct}%</span>
              </div>
              <FishProgress
                value={pct}
                label={p.name}
                state={p.status === "done" ? "done" : "running"}
                className="h-2"
              />
            </div>
          );
        })
      )}
    </button>
  );
}
