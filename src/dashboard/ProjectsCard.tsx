import { FishProgress } from "../components/FishProgress";
import type { ProjectSummary } from "../api";
import type { PageId } from "../shell/nav";
import { H2, PANEL } from "../shell/ui";

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
      className={`${PANEL} flex w-full flex-col items-start gap-2.5 text-left transition-colors hover:bg-surface-2`}
    >
      <span className={`${H2} block`}>Proyek</span>
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
