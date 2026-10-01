import { useEffect, useMemo, useState } from "react";
import {
  api,
  errorMessage,
  type Activity,
  type ActivityRole,
  type ProjectDetail,
  type TaskCard,
} from "../api";
import { relativeTime } from "../format";
import { splitBlocks } from "../notes/blocks";
import { BlockPreview } from "../notes/markdown";
import { useToast } from "../shell/toast";
import { H2, PRIMARY } from "../shell/ui";
import { AgentRequest } from "./AgentRequest";
import {
  ACTIVITY_FILTERS,
  AGENT_CLI_SNIPPET,
  connectedAgents,
  filterActivities,
  ROLE_LABELS,
  type ActivityFilter,
} from "./view";

const unresolved = () => false;
const readOnlyTodo = () => {};

function RoleIcon({ role }: Readonly<{ role: ActivityRole }>) {
  switch (role) {
    case "request":
      return (
        <span aria-hidden="true" title={ROLE_LABELS[role]} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#1E2A12] text-accent">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 4l13 8-13 8z" />
          </svg>
        </span>
      );
    case "plan":
      return (
        <span aria-hidden="true" title={ROLE_LABELS[role]} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#1E2A12] text-accent">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />
          </svg>
        </span>
      );
    case "implement":
      return (
        <span aria-hidden="true" title={ROLE_LABELS[role]} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-2 text-ink">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
        </span>
      );
    case "test":
      return (
        <span aria-hidden="true" title={ROLE_LABELS[role]} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#2A1A1A] text-danger">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 3h6M10 3v6L5 19a1 1 0 0 0 1 2h12a1 1 0 0 0 1-2l-5-10V3" />
          </svg>
        </span>
      );
    case "review":
      return (
        <span aria-hidden="true" title={ROLE_LABELS[role]} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#2A2412] text-warning">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </span>
      );
    case "merge":
      return (
        <span aria-hidden="true" title={ROLE_LABELS[role]} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#1E2A12] text-accent">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <path d="M6 21V9a9 9 0 0 0 9 9" />
          </svg>
        </span>
      );
    case "note":
    default:
      return (
        <span aria-hidden="true" title={ROLE_LABELS[role]} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-2 text-muted">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </span>
      );
  }
}

function EventCard({
  activity,
  now,
  onOpenTaskInKanban,
  onOpenItem,
}: Readonly<{
  activity: Activity;
  now: number;
  onOpenTaskInKanban: (taskId: string) => void;
  onOpenItem: (id: string) => void;
}>) {
  const toast = useToast();
  const blocks = useMemo(() => splitBlocks(activity.body), [activity.body]);

  async function openNote(title: string) {
    try {
      const target = await api.resolveLink(title);
      if (target) onOpenItem(target.id);
      else toast("Catatan belum ditemukan");
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  function openUrl(url: string) {
    void api.openLink(url).catch((error) => toast(errorMessage(error), "error"));
  }

  const roleLabel = ROLE_LABELS[activity.role];
  const displayTitle = activity.title || `${activity.actor} · ${roleLabel}`;

  return (
    <div className="relative flex gap-3 pb-3 last:pb-0">
      <span aria-hidden="true" className="absolute left-3.5 top-0 bottom-0 w-px bg-line" />
      <RoleIcon role={activity.role} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-[10px] border border-line bg-stage/50 p-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-medium text-[13px] text-ink">{displayTitle}</span>
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{activity.actor}</span>
          <time
            dateTime={new Date(activity.createdAt).toISOString()}
            title={new Date(activity.createdAt).toLocaleString("id-ID")}
            className="ml-auto font-mono text-[11px] text-muted"
          >
            {relativeTime(activity.createdAt, now)}
          </time>
        </div>
        {activity.body.trim().length > 0 && (
          <div className="flex flex-col gap-1.5 text-xs text-muted break-words">
            {blocks.map((block) => (
              <BlockPreview
                key={block.id}
                text={block.text}
                isResolved={unresolved}
                onOpenLink={(title) => void openNote(title)}
                onOpenUrl={openUrl}
                onToggleTodo={readOnlyTodo}
              />
            ))}
          </div>
        )}
        {activity.taskId && (
          <button
            type="button"
            onClick={() => onOpenTaskInKanban(activity.taskId!)}
            className="self-start text-xs text-accent hover:text-accent-hover underline-offset-2 hover:underline transition-colors mt-0.5"
          >
            Lihat di Kanban ›
          </button>
        )}
      </div>
    </div>
  );
}

export function ConnectAgentDialog({
  project,
  onClose,
  onEditProject,
}: Readonly<{
  project: ProjectDetail;
  onClose: () => void;
  onEditProject?: () => void;
}>) {
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  async function handleCopy(text: string, isSnippet: boolean) {
    try {
      await navigator.clipboard.writeText(text);
      if (isSnippet) {
        setCopiedSnippet(true);
        setTimeout(() => setCopiedSnippet(false), 2000);
      } else {
        setCopiedId(true);
        setTimeout(() => setCopiedId(false), 2000);
      }
    } catch {
      // Ignore clipboard error in headless environments
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cn-title"
        className="relative flex max-h-[85vh] w-full max-w-[680px] flex-col gap-4 overflow-y-auto rounded-[18px] border border-popup-border bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 id="cn-title" className="m-0 font-display text-lg font-semibold text-ink">
            Hubungkan agen kode
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-ink transition-colors"
          >
            ✕
          </button>
        </div>
        <p className="m-0 text-[13px] text-muted leading-relaxed">
          Agen di terminal atau IDE mencatat rencana, progres, dan hasil tes ke proyek ini lewat CLI Anchoa.
        </p>

        {/* 1. Isi perintah agen dan folder di pengaturan proyek */}
        <div className="flex gap-3">
          <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent font-mono text-xs font-semibold">
            1
          </span>
          <div className="flex flex-col gap-2 min-w-0 flex-1">
            <span className="text-sm font-medium text-ink">Isi perintah agen dan folder di pengaturan proyek</span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex flex-col gap-1 rounded-[9px] border border-line bg-stage p-2.5">
                <span className="text-[11px] text-muted">Folder repo</span>
                <span className="font-mono text-ink truncate" title={project.agentDir || "Belum diisi"}>
                  {project.agentDir || "Belum diisi"}
                </span>
              </div>
              <div className="flex flex-col gap-1 rounded-[9px] border border-line bg-stage p-2.5">
                <span className="text-[11px] text-muted">Perintah agen</span>
                <span className="font-mono text-ink truncate" title={project.agentCommand || "Belum diisi"}>
                  {project.agentCommand || "Belum diisi"}
                </span>
              </div>
            </div>
            {onEditProject && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEditProject();
                }}
                className="self-start text-xs text-accent hover:text-accent-hover underline-offset-2 hover:underline"
              >
                Ubah di pengaturan proyek ›
              </button>
            )}
          </div>
        </div>

        {/* 2. Beri tahu agen kapan mencatat (tempel ke CLAUDE.md / AGENTS.md) */}
        <div className="flex gap-3">
          <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted font-mono text-xs font-semibold">
            2
          </span>
          <div className="flex flex-col gap-2 min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">
                Beri tahu agen kapan mencatat (tempel ke CLAUDE.md / AGENTS.md)
              </span>
              <button
                type="button"
                onClick={() => void handleCopy(AGENT_CLI_SNIPPET, true)}
                className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-accent hover:text-accent-hover transition-colors"
              >
                {copiedSnippet ? "Tersalin!" : "Salin"}
              </button>
            </div>
            <pre className="m-0 overflow-x-auto rounded-[9px] border border-line bg-stage p-3 font-mono text-[11.5px] leading-relaxed text-text-soft whitespace-pre-wrap">
              {AGENT_CLI_SNIPPET}
            </pre>
          </div>
        </div>

        {/* 3. ID proyek beserta tombol salin */}
        <div className="flex gap-3">
          <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted font-mono text-xs font-semibold">
            3
          </span>
          <div className="flex flex-col gap-2 min-w-0 flex-1">
            <span className="text-sm font-medium text-ink">ID Proyek</span>
            <p className="m-0 text-xs text-muted">
              Gunakan ID ini untuk perintah agen atau inbox (<code>anchoa agent inbox --project &lt;id&gt;</code>).
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-[9px] border border-line bg-stage px-3 py-2 font-mono text-xs text-text-soft">
                {project.id}
              </code>
              <button
                type="button"
                onClick={() => void handleCopy(project.id, false)}
                className="shrink-0 rounded-[9px] border border-line bg-surface-2 px-3 py-2 text-xs font-medium text-ink hover:bg-surface-2/80 transition-colors"
              >
                {copiedId ? "Tersalin!" : "Salin ID"}
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-line mt-2">
          <button type="button" onClick={onClose} className={PRIMARY}>
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
}

export function AgentTab({
  project,
  running,
  version,
  logAvailable,
  onRequested,
  onRefresh,
  onShowLog,
  onOpenTaskInKanban,
  onOpenItem,
  onEditProject,
}: Readonly<{
  project: ProjectDetail;
  running: boolean;
  version: number;
  logAvailable: boolean;
  onRequested: (task: TaskCard) => void;
  onRefresh: () => void;
  onShowLog: () => void;
  onOpenTaskInKanban: (taskId: string) => void;
  onOpenItem: (id: string) => void;
  onEditProject?: () => void;
}>) {
  const toast = useToast();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [startTime, setStartTime] = useState<number | null>(running ? Date.now() : null);

  useEffect(() => {
    if (running) {
      setStartTime((prev) => prev ?? Date.now());
    } else {
      setStartTime(null);
    }
  }, [running]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  // Poll project_activities every 3000 ms only while the Agen kode tab is open,
  // discarding stale responses by request number (matching useProjectBoard.ts).
  useEffect(() => {
    let active = true;
    let requests = 0;

    async function refresh() {
      const request = ++requests;
      try {
        const data = await api.projectActivities(project.id);
        if (active && request === requests) {
          setActivities(data);
        }
      } catch (error) {
        if (active && request === requests) {
          toast(errorMessage(error), "error");
        }
      }
    }

    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      active = false;
      requests++;
      clearInterval(timer);
    };
  }, [project.id, version, toast]);

  async function handleStop() {
    if (!running || busy) return;
    setBusy(true);
    try {
      await api.agentStop(project.id);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
      onRefresh();
    }
  }

  const mins = startTime ? Math.floor((now - startTime) / 60000) : 0;
  const runningText = running
    ? mins > 0
      ? `Agen sedang bekerja · ${mins} mnt`
      : "Agen sedang bekerja"
    : "Agen tidak berjalan";

  const filtered = useMemo(() => filterActivities(activities, filter), [activities, filter]);
  const agents = useMemo(() => connectedAgents(activities), [activities]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      {/* Bilah status di atas */}
      <div className="flex items-center justify-between rounded-[14px] border border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            {running && (
              <span aria-hidden="true" className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-75 animate-ping" />
            )}
            <span aria-hidden="true" className={`relative inline-flex h-2.5 w-2.5 rounded-full ${running ? "bg-accent" : "bg-faint"}`} />
          </span>
          <span role="status" aria-live="polite" className={`text-sm ${running ? "text-accent font-medium" : "text-muted"}`}>
            {runningText}
          </span>
          {running && (
            <button
              type="button"
              onClick={handleStop}
              disabled={busy}
              className="ml-2 flex min-h-[30px] items-center gap-1.5 rounded-[9px] border border-danger/60 bg-transparent px-3 text-xs font-medium text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" />
              </svg>
              Hentikan
            </button>
          )}
        </div>
        {logAvailable && (
          <button
            type="button"
            onClick={onShowLog}
            className="text-xs text-accent hover:text-accent-hover transition-colors"
          >
            Lihat log
          </button>
        )}
      </div>

      {/* Main grid */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_356px] gap-4">
        {/* Left: Aktivitas agen feed */}
        <section aria-labelledby="ag-feed-title" className="flex min-h-0 flex-col rounded-[14px] border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            <h2 id="ag-feed-title" className={H2}>Aktivitas agen</h2>
            <div role="group" aria-label="Saring aktivitas" className="flex gap-1 rounded-[8px] bg-stage p-0.5">
              {ACTIVITY_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                  className={`rounded-[6px] px-2.5 py-1 text-xs transition-colors ${
                    filter === f.id
                      ? "bg-surface-2 text-ink font-medium shadow-sm"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <span className="ml-auto text-[11px] text-muted">dicatat lewat CLI & hooks</span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-2">
            {filtered.length === 0 ? (
              <p className="m-0 py-8 text-center text-sm text-muted">Belum ada aktivitas agen.</p>
            ) : (
              filtered.map((activity) => (
                <EventCard
                  key={activity.id}
                  activity={activity}
                  now={now}
                  onOpenTaskInKanban={onOpenTaskInKanban}
                  onOpenItem={onOpenItem}
                />
              ))
            )}
          </div>
        </section>

        {/* Right column: Kirim ke agen + Agen terhubung */}
        <div className="flex min-h-0 flex-col gap-4">
          <AgentRequest
            key={project.id}
            project={project}
            running={running}
            logAvailable={logAvailable}
            onRequested={onRequested}
            onRefresh={onRefresh}
            onShowLog={onShowLog}
          />

          <section aria-labelledby="ag-conn-title" className="flex shrink-0 flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
            <h2 id="ag-conn-title" className={H2}>Agen terhubung</h2>
            {agents.length === 0 ? (
              <p className="m-0 py-2 text-xs text-muted">Belum ada agen yang melapor.</p>
            ) : (
              <div className="flex flex-col">
                {agents.map((agent) => (
                  <div key={agent.name} className="flex items-center gap-3 py-2 border-t border-line first:border-0">
                    <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-2 font-mono text-xs font-semibold text-text-soft">
                      {agent.initials}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13px] font-medium text-ink">{agent.name}</span>
                      <span className="text-[11px] text-muted">aktif {relativeTime(agent.lastActiveAt, now)}</span>
                    </div>
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setConnectOpen(true)}
              className="mt-1 flex items-center gap-1.5 self-start rounded-[9px] border border-done bg-transparent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Hubungkan agen
            </button>
          </section>
        </div>
      </div>

      {connectOpen && (
        <ConnectAgentDialog
          project={project}
          onClose={() => setConnectOpen(false)}
          onEditProject={onEditProject}
        />
      )}
    </div>
  );
}
