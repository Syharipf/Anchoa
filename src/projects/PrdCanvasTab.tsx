import { FlowCanvas } from "./FlowCanvas";
import { PrdEditor } from "./PrdEditor";

export function PrdCanvasTab({
  projectId,
  prdContent,
  flowJson,
  onPrdSaved,
  onFlowSaved,
}: Readonly<{
  projectId: string;
  prdContent: string | null;
  flowJson: string | null;
  onPrdSaved?: (content: string) => void;
  onFlowSaved?: (flowJson: string) => void;
}>) {
  return (
    <div className="flex w-full flex-col gap-4">
      {/* Tech Stack & Architecture Badges */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-2xl border border-line bg-surface px-5 py-3 shadow-sm">
        <span className="font-display text-xs font-semibold uppercase tracking-wider text-muted">
          Arsitektur &amp; Stack:
        </span>
        <span className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 font-mono text-xs text-ink">
          <span className="text-accent">⚡ Frontend:</span> React 19 + TypeScript + Tailwind
        </span>
        <span className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 font-mono text-xs text-ink">
          <span className="text-accent">🦀 Backend:</span> Tauri 2 / Rust
        </span>
        <span className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 font-mono text-xs text-ink">
          <span className="text-accent">🗄️ Database:</span> SQLite WAL (rusqlite)
        </span>
        <span className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 font-mono text-xs text-ink">
          <span className="text-accent">🔒 Security:</span> Argon2id + CSP
        </span>
        <span className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 font-mono text-xs text-ink">
          <span className="text-accent">🤖 Harness:</span> omp Orchestrator
        </span>
      </div>

      {/* Main Split: PRD Editor & Business Flow Canvas */}
      <div className="grid min-h-[580px] w-full grid-cols-1 gap-5 md:grid-cols-[480px_minmax(0,1fr)] items-start">
        <PrdEditor
          projectId={projectId}
          initialContent={prdContent}
          onSaved={onPrdSaved}
        />
        <FlowCanvas
          projectId={projectId}
          initialFlowJson={flowJson}
          onSaved={onFlowSaved}
        />
      </div>
    </div>
  );
}
