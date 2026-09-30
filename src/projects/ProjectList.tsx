import type { LooseCount, ProjectSummary } from "../api";
import { KIND_LABELS, STATUS_LABELS, deadlineLabel } from "./view";

export function ProjectList({
  projects,
  looseCount,
  selectedId,
  onSelect,
  onCreateProject,
}: Readonly<{
  projects: ProjectSummary[];
  looseCount: LooseCount;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreateProject: () => void;
}>) {
  const loosePct =
    looseCount.total > 0 ? Math.round((looseCount.done / looseCount.total) * 100) : 0;

  return (
    <section aria-labelledby="daftar-judul" className="flex flex-col gap-2">
      <h2
        id="daftar-judul"
        className="m-0 text-[11px] font-medium uppercase tracking-[0.08em] text-muted"
      >
        Daftar proyek
      </h2>
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line p-4 text-center">
          <p className="m-0 text-xs text-muted">Belum ada proyek</p>
          <button
            type="button"
            onClick={onCreateProject}
            className="rounded-full border border-line px-3 py-1 text-xs text-ink transition-colors hover:bg-surface-2"
          >
            Buat proyek
          </button>
        </div>
      ) : (
        projects.map((p) => {
          const isSelected = selectedId === p.id;
          const status = STATUS_LABELS[p.status];
          const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
          const dl = deadlineLabel(p.deadlineAt, p.deadlineDays);
          const meta = dl ? `${KIND_LABELS[p.kind]} · ${dl}` : KIND_LABELS[p.kind];
          const toneClass =
            status.tone === "accent"
              ? "text-accent"
              : status.tone === "danger"
                ? "text-danger"
                : "text-muted";
          const dotBg =
            status.tone === "accent"
              ? "bg-accent"
              : status.tone === "danger"
                ? "bg-danger"
                : "bg-muted";

          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(p.id)}
              className={`flex w-full flex-col gap-2 rounded-xl border p-3 text-left transition-colors ${
                isSelected
                  ? "border-field-focus bg-surface-2"
                  : "border-line bg-surface hover:bg-surface-2"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`truncate text-sm font-semibold ${
                    p.status === "done" ? "text-muted" : "text-ink"
                  }`}
                >
                  {p.name}
                </span>
                <span className={`flex shrink-0 items-center gap-1.5 text-[11px] ${toneClass}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${dotBg}`} />
                  {status.label}
                </span>
              </div>
              <span className="text-xs text-muted">{meta}</span>
              <div className="flex items-center gap-2.5">
                <div aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-sm bg-line">
                  <div
                    style={{ width: `${pct}%` }}
                    className={`h-full rounded-sm transition-all ${
                      p.status === "done" ? "bg-field-focus" : "bg-accent"
                    }`}
                  />
                </div>
                <span className="min-w-[34px] text-right font-mono text-xs text-muted">{pct}%</span>
              </div>
            </button>
          );
        })
      )}

      {/* Loose tasks entry */}
      <button
        type="button"
        aria-pressed={selectedId === null}
        onClick={() => onSelect(null)}
        className={`flex w-full flex-col gap-2 rounded-xl border p-3 text-left transition-colors ${
          selectedId === null
            ? "border-field-focus bg-surface-2"
            : "border-line bg-surface hover:bg-surface-2"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-ink">Tugas lepas</span>
          <span className="text-[11px] text-muted">{looseCount.total} tugas</span>
        </div>
        {looseCount.total > 0 && (
          <div className="flex items-center gap-2.5">
            <div aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-sm bg-line">
              <div
                style={{ width: `${loosePct}%` }}
                className={`h-full rounded-sm transition-all ${
                  looseCount.done === looseCount.total ? "bg-field-focus" : "bg-accent"
                }`}
              />
            </div>
            <span className="min-w-[34px] text-right font-mono text-xs text-muted">
              {loosePct}%
            </span>
          </div>
        )}
      </button>
    </section>
  );
}
