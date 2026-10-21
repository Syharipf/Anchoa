import type { ProjectDetail } from "../api";
import { H1, HEADER_PRIMARY, HEADER_SECONDARY } from "../shell/ui";

export function StudioHeader({
  project,
  branch,
  running,
  activeTab,
  onTabChange,
  onOpenDraftAi,
  onRunNativeApp,
  onEditProject,
}: Readonly<{
  project: ProjectDetail | null;
  branch: string | null;
  running: boolean;
  activeTab: "kanban" | "prd" | "diff" | "agent";
  onTabChange: (tab: "kanban" | "prd" | "diff" | "agent") => void;
  onOpenDraftAi?: () => void;
  onRunNativeApp?: () => void;
  onEditProject?: () => void;
}>) {
  if (!project) return null;

  return (
    <header className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className={H1}>{project.name}</h1>

        {/* Repo & Branch Badge */}
        {project.repoUrl && (
          <div className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 font-mono text-xs text-muted">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className="text-muted"
            >
              <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
              <path d="M9 18c-4.51 2-5-2-7-2" />
            </svg>
            <span className="truncate max-w-[200px]" title={project.repoUrl}>
              {project.repoUrl.replace(/^https?:\/\/github\.com\//, "")}
            </span>
            {branch && (
              <>
                <span className="text-line">·</span>
                <span className="font-semibold text-accent">{branch}</span>
              </>
            )}
          </div>
        )}

        {/* Harness Indicator */}
        {project.agent && (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1 font-mono text-xs">
            <span className="relative flex h-2 w-2 items-center justify-center">
              {running && (
                <span className="absolute h-3.5 w-3.5 rounded-full bg-accent opacity-40 animate-ping" />
              )}
              <span
                className={`h-2 w-2 rounded-full ${running ? "bg-accent" : "bg-muted"}`}
              />
            </span>
            <span className="font-medium text-ink">omp</span>
            <span className="text-muted">{running ? "running" : "idle"}</span>
          </div>
        )}

        {/* Actions */}
        <div className="ml-auto flex items-center gap-2">
          {onOpenDraftAi && (
            <button
              type="button"
              onClick={onOpenDraftAi}
              className={`${HEADER_PRIMARY} text-xs`}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Draft AI targets
            </button>
          )}

          {onRunNativeApp && (
            <button
              type="button"
              onClick={onRunNativeApp}
              className={`${HEADER_SECONDARY} text-xs`}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1"
                className="text-accent"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Run App
            </button>
          )}

          {onEditProject && (
            <button
              type="button"
              onClick={onEditProject}
              className={`${HEADER_SECONDARY} text-xs`}
              title="Project settings"
            >
              ⚙
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <nav aria-label="Studio sub-menu" className="flex border-b border-line gap-1">
        <button
          type="button"
          onClick={() => onTabChange("kanban")}
          aria-current={activeTab === "kanban" ? "page" : undefined}
          className={`flex items-center gap-1.5 border-b-2 px-3.5 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "kanban"
              ? "border-accent text-accent"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          Kanban board
        </button>

        <button
          type="button"
          onClick={() => onTabChange("prd")}
          aria-current={activeTab === "prd" ? "page" : undefined}
          className={`flex items-center gap-1.5 border-b-2 px-3.5 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "prd"
              ? "border-accent text-accent"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          PRD &amp; Business Flow
        </button>

        <button
          type="button"
          onClick={() => onTabChange("diff")}
          aria-current={activeTab === "diff" ? "page" : undefined}
          className={`flex items-center gap-1.5 border-b-2 px-3.5 py-1.5 text-xs font-medium transition-colors ${
            activeTab === "diff"
              ? "border-accent text-accent"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          Changes &amp; Diff
        </button>

        {project.agent && (
          <button
            type="button"
            onClick={() => onTabChange("agent")}
            aria-current={activeTab === "agent" ? "page" : undefined}
            className={`flex items-center gap-1.5 border-b-2 px-3.5 py-1.5 text-xs font-medium transition-colors ${
              activeTab === "agent"
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            Agent activity
          </button>
        )}
      </nav>
    </header>
  );
}
