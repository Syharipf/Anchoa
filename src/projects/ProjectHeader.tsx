import { api, errorMessage, type LooseCount, type ProjectDetail } from "../api";
import { useToast } from "../shell/toast";
import { KIND_LABELS, deadlineLabel } from "./view";

export function ProjectHeader({
  project,
  looseCount,
  onEdit,
  tab = "kanban",
  onTabChange,
  running = false,
  onOpenDraftAi,
}: Readonly<{
  project: ProjectDetail | null;
  looseCount: LooseCount;
  onEdit: () => void;
  tab?: "kanban" | "prd" | "diff" | "agent";
  onTabChange?: (tab: "kanban" | "prd" | "diff" | "agent") => void;
  running?: boolean;
  onOpenDraftAi?: () => void;
}>) {
  const toast = useToast();

  if (!project) {
    const pct = looseCount.total > 0 ? Math.round((looseCount.done / looseCount.total) * 100) : 0;
    return (
      <section
        aria-labelledby="project-header-title"
        className="flex shrink-0 flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-[16px_18px]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="project-header-title" className="m-0 font-display text-[22px] font-semibold tracking-[-0.01em]">
              Loose tasks
            </h2>
            <p className="m-0 text-[13px] text-muted">Tasks not tied to a specific project.</p>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="font-mono text-[22px] font-medium">{pct}%</span>
            <span className="text-xs text-muted">
              {looseCount.done} of {looseCount.total} tasks
            </span>
          </div>
        </div>
        <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-[3px] bg-line">
          <div
            style={{ width: `${pct}%` }}
            className={`h-1.5 rounded-[3px] transition-all duration-300 ${
              looseCount.total > 0 && looseCount.done === looseCount.total
                ? "bg-field-focus"
                : "bg-accent"
            }`}
          />
        </div>
      </section>
    );
  }

  const pct = project.total > 0 ? Math.round((project.done / project.total) * 100) : 0;
  const dl = deadlineLabel(project.deadlineAt, project.deadlineDays);

  return (
    <section
      aria-labelledby="project-header-title"
      className="flex shrink-0 flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-[16px_18px]"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="project-header-title" aria-live="polite" className="m-0 font-display text-[22px] font-semibold tracking-[-0.01em]">
              {project.name}
            </h2>
            <nav aria-label="Project views" className="flex gap-1 rounded-[10px] border border-line bg-stage p-1">
              <button
                type="button"
                onClick={() => onTabChange?.("kanban")}
                className={`flex min-h-[28px] items-center rounded-[7px] px-3 text-xs transition-colors ${
                  tab === "kanban" ? "bg-surface-2 text-ink font-medium shadow-sm" : "text-muted hover:text-ink"
                }`}
                aria-current={tab === "kanban" ? "page" : undefined}
              >
                Kanban
              </button>
              <button
                type="button"
                onClick={() => onTabChange?.("prd")}
                className={`flex min-h-[28px] items-center rounded-[7px] px-3 text-xs transition-colors ${
                  tab === "prd" ? "bg-surface-2 text-ink font-medium shadow-sm" : "text-muted hover:text-ink"
                }`}
                aria-current={tab === "prd" ? "page" : undefined}
              >
                PRD &amp; Business
              </button>
              <button
                type="button"
                onClick={() => onTabChange?.("diff")}
                className={`flex min-h-[28px] items-center rounded-[7px] px-3 text-xs transition-colors ${
                  tab === "diff" ? "bg-surface-2 text-ink font-medium shadow-sm" : "text-muted hover:text-ink"
                }`}
                aria-current={tab === "diff" ? "page" : undefined}
              >
                Changes &amp; Diff
              </button>
              {project.agent && (
                <button
                  type="button"
                  onClick={() => onTabChange?.("agent")}
                  className={`flex min-h-[28px] items-center gap-1.5 rounded-[7px] px-3 text-xs transition-colors ${
                    tab === "agent" ? "bg-surface-2 text-ink font-medium shadow-sm" : "text-muted hover:text-ink"
                  }`}
                  aria-current={tab === "agent" ? "page" : undefined}
                >
                  Coding agent
                  <span className={`h-1.5 w-1.5 rounded-full ${running ? "bg-accent animate-pulse" : "bg-disabled"}`} />
                </button>
              )}
            </nav>
          </div>
          {project.description && (
            <p className="m-0 text-[13px] text-muted">{project.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {onOpenDraftAi && (
            <button
              type="button"
              onClick={onOpenDraftAi}
              className="flex items-center gap-1.5 rounded-lg border border-line bg-stage px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-surface-2"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Draft AI Goals
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            title="Edit project"
            aria-label="Edit project"
            className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink transition-colors hover:bg-surface-3"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            Edit
          </button>
          <div className="flex flex-col items-end gap-0.5">
            <span className="font-mono text-[22px] font-medium">{pct}%</span>
            <span className="text-xs text-muted">
              {project.done} of {project.total} tasks
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {dl && (
          <span
            className={`flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs ${
              project.status === "late" ? "text-danger" : "text-ink"
            }`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
            {dl}
          </span>
        )}
        <span className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted">
          {KIND_LABELS[project.kind]}
        </span>
        {project.repoUrl && (
          <button
            type="button"
            onClick={() => void api.openRepo(project.id).catch((e) => toast(errorMessage(e), "error"))}
            title="Open repository in browser"
            className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-accent transition-colors hover:text-accent-hover"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="6" cy="6" r="2.5" />
              <circle cx="6" cy="18" r="2.5" />
              <circle cx="18" cy="8" r="2.5" />
              <path d="M6 8.5v7M18 10.5c0 4-6 3-10.5 6" />
            </svg>
            Repo
          </button>
        )}
      </div>
      <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-[3px] bg-line">
        <div
          style={{ width: `${pct}%` }}
          className={`h-1.5 rounded-[3px] transition-all duration-300 ${
            project.status === "done" ? "bg-field-focus" : "bg-accent"
          }`}
        />
      </div>
    </section>
  );
}
