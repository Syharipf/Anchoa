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
import { FIELD, H2, PRIMARY } from "../shell/ui";
import { FolderPicker } from "../files/FolderPicker";
import { AgentRequest } from "./AgentRequest";
import {
  ACTIVITY_FILTERS,
  actorInitials,
  actorLabel,
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
        <span aria-hidden="true" title={ROLE_LABELS[role]} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#2A2412] text-warn">
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
      else toast("Note not found");
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  }

  function openUrl(url: string) {
    void api.openLink(url).catch((error) => toast(errorMessage(error), "error"));
  }

  const roleLabel = ROLE_LABELS[activity.role];
  // CLI logs without --title reuse the first body line; show the rendered body instead of raw Markdown twice.
  const displayTitle = activity.title && activity.title.trim() !== activity.body.trim() ? activity.title : roleLabel;

  return (
    <div className="relative flex gap-3 pb-3 last:pb-0">
      <span aria-hidden="true" className="absolute left-3.5 top-0 bottom-0 w-px bg-line" />
      <RoleIcon role={activity.role} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-[10px] border border-line bg-stage/50 p-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-medium text-[13px] text-ink">{displayTitle}</span>
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{actorLabel(activity.actor)}</span>
          <time
            dateTime={new Date(activity.createdAt).toISOString()}
            title={new Date(activity.createdAt).toLocaleString("en-US")}
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
            View in Kanban ›
          </button>
        )}
      </div>
    </div>
  );
}

/** Start time of each running agent, by project id (the app has no run start from the backend). */
const runStarts = new Map<string, number>();

export function ConnectAgentDialog({
  project,
  onClose,
  onSaved,
  onEditProject,
}: Readonly<{
  project: ProjectDetail;
  onClose: () => void;
  onSaved?: () => void;
  onEditProject?: () => void;
}>) {
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const toast = useToast();
  const [copiedId, setCopiedId] = useState(false);
  const [dir, setDir] = useState(project.agentDir ?? "");
  const [pickingDir, setPickingDir] = useState(false);
  const [cmd, setCmd] = useState(project.agentCommand ?? "");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSaveConfig() {
    setSaving(true);
    try {
      await api.saveProject({
        id: project.id,
        name: project.name,
        kind: project.kind,
        description: project.description,
        deadlineAt: project.deadlineAt,
        repoUrl: project.repoUrl,
        agent: true,
        agentDir: dir.trim() || null,
        agentCommand: cmd.trim() || null,
      });
      toast("Agent settings saved");
      onSaved?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestSetup() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.agentTestSetup(project.id);
      setTestResult(`✓ ${res}`);
      toast("Agent configuration valid");
    } catch (e) {
      setTestResult(`✕ ${errorMessage(e)}`);
      toast(errorMessage(e), "error");
    } finally {
      setTesting(false);
    }
  }
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
        className="relative flex max-h-[85vh] w-full max-w-[680px] flex-col gap-4 overflow-y-auto rounded-[18px] border border-line bg-surface p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 id="cn-title" className="m-0 font-display text-lg font-semibold text-ink">
            Connect CLI Agent
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted hover:bg-surface-2 hover:text-ink transition-colors"
          >
            ✕
          </button>
        </div>
        <p className="m-0 text-[13px] text-muted leading-relaxed">
          CLI agents in your terminal or IDE record plans, progress, and test runs to this project via the Anchoa CLI.
        </p>

        {/* 1. Isi perintah agen dan folder di pengaturan proyek */}
        <div className="flex gap-3">
          <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-canvas font-mono text-xs font-semibold">
            1
          </span>
          <div className="flex flex-col gap-2 min-w-0 flex-1">
            <span className="text-sm font-medium text-ink">Target working directory &amp; command</span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">Repo folder</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={dir}
                    placeholder="/home/user/repo"
                    onChange={(e) => setDir(e.target.value)}
                    className={`${FIELD} min-w-0 flex-1 py-1.5 text-xs`}
                  />
                  <button
                    type="button"
                    onClick={() => setPickingDir(true)}
                    disabled={saving}
                    className="shrink-0 whitespace-nowrap rounded-lg border border-line px-2 py-1.5 text-xs text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
                  >
                    Choose…
                  </button>
                </div>
                {pickingDir && (
                  <FolderPicker
                    initialPath={dir || project.agentDir || ""}
                    onSelect={setDir}
                    onClose={() => setPickingDir(false)}
                  />
                )}
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-muted">Agent command</span>
                <input
                  type="text"
                  value={cmd}
                  placeholder="claude"
                  onChange={(e) => setCmd(e.target.value)}
                  className={`${FIELD} py-1.5 text-xs`}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => void handleSaveConfig()}
                disabled={saving}
                className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-3 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => void handleTestSetup()}
                disabled={testing}
                className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 transition-colors disabled:opacity-50"
              >
                {testing ? "Testing…" : "Test setup"}
              </button>
              {testResult && (
                <span className={`text-xs ${testResult.startsWith("✓") ? "text-accent" : "text-danger"}`}>
                  {testResult}
                </span>
              )}
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
                Edit in project settings ›
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
                Instruct the agent when to record (paste into CLAUDE.md / AGENTS.md)
              </span>
              <button
                type="button"
                onClick={() => void handleCopy(AGENT_CLI_SNIPPET, true)}
                className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-accent hover:text-accent-hover transition-colors"
              >
                {copiedSnippet ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="m-0 overflow-x-auto rounded-[9px] border border-line bg-stage p-3 font-mono text-[11.5px] leading-relaxed text-ink whitespace-pre-wrap">
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
            <span className="text-sm font-medium text-ink">Project ID</span>
            <p className="m-0 text-xs text-muted">
              Use this ID for agent commands or inbox (<code>anchoa agent inbox --project &lt;id&gt;</code>).
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-[9px] border border-line bg-stage px-3 py-2 font-mono text-xs text-ink">
                {project.id}
              </code>
              <button
                type="button"
                onClick={() => void handleCopy(project.id, false)}
                className="shrink-0 rounded-[9px] border border-line bg-surface-2 px-3 py-2 text-xs font-medium text-ink hover:bg-surface-2/80 transition-colors"
              >
                {copiedId ? "Copied!" : "Copy ID"}
              </button>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-3 border-t border-line mt-2">
          <button type="button" onClick={onClose} className={PRIMARY}>
            Done
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
  const [unlinkConfirm, setUnlinkConfirm] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Kept outside the component so switching to Kanban and back does not reset the duration.
  if (running && !runStarts.has(project.id)) runStarts.set(project.id, Date.now());
  if (!running) runStarts.delete(project.id);
  const startTime = runStarts.get(project.id) ?? null;

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
        // ponytail: newest 200 only; older events and actors drop off the feed. Add paging if projects outgrow it.
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

  async function handleUnlink() {
    if (!unlinkConfirm) {
      setUnlinkConfirm(true);
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      if (running) await api.agentStop(project.id);
      await api.saveProject({
        id: project.id,
        name: project.name,
        kind: project.kind,
        description: project.description,
        deadlineAt: project.deadlineAt,
        repoUrl: project.repoUrl,
        agent: true,
        agentDir: null,
        agentCommand: null,
      });
      setUnlinkConfirm(false);
      toast("Agent unlinked");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
      onRefresh();
    }
  }

  const mins = startTime ? Math.floor((now - startTime) / 60000) : 0;
  const filtered = useMemo(() => filterActivities(activities, filter), [activities, filter]);
  const agents = useMemo(() => connectedAgents(activities), [activities]);
  // The runner has one linked agent per project; its display name comes from the newest reporter.
  const agentName = agents[0]?.name ?? project.name;
  const lastReporter = agents[0] ?? null;
  const runningText = running
    ? mins > 0
      ? `Agent working · ${mins}m`
      : "Agent working"
    : lastReporter
      ? `Agent idle · last active ${lastReporter.name} ${relativeTime(lastReporter.lastActiveAt, now)}`
      : "Agent idle";

  return (
    <div className="flex w-full flex-col gap-5">
      {/* Bilah status di atas */}
      <div className="flex items-center justify-between rounded-2xl border border-line bg-surface px-5 py-3.5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            {running && (
              <span aria-hidden="true" className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-75 animate-ping" />
            )}
            <span aria-hidden="true" className={`relative inline-flex h-2.5 w-2.5 rounded-full ${running ? "bg-accent" : "bg-disabled"}`} />
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
              Stop
            </button>
          )}
        </div>
        {logAvailable && (
          <button
            type="button"
            onClick={onShowLog}
            className="text-xs text-accent hover:text-accent-hover transition-colors"
          >
            View log
          </button>
        )}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
        {/* Left: Aktivitas agen feed */}
        <section aria-labelledby="ag-feed-title" className="flex min-h-[580px] flex-col rounded-2xl border border-line bg-surface shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5">
            <h2 id="ag-feed-title" className={H2}>Agent activity</h2>
            <div role="group" aria-label="Filter activity" className="flex gap-1 rounded-[8px] bg-stage p-0.5">
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
            <span className="ml-auto text-[11px] text-muted">recorded via anchoa agent</span>
          </div>

          <div className="p-5 flex flex-col gap-3 min-h-[500px]">
            {filtered.length === 0 ? (
              <p className="m-0 py-8 text-center text-sm text-muted">No agent activity yet.</p>
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
        <div className="flex flex-col gap-5">
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
            <h2 id="ag-conn-title" className={H2}>Connected agent</h2>
            {project.agentCommand ? (
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-2 font-mono text-xs font-semibold text-ink">
                  {actorInitials(agentName)}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium text-ink">{agentName}</span>
                  <span className="truncate text-[11px] text-muted" title={project.agentDir ?? undefined}>
                    {project.agentDir ? "Runner + CLI · accepts requests" : "Runner has no working folder"}
                  </span>
                </div>
                <span role="status" aria-live="polite" className="shrink-0 text-[11px] text-muted">
                  {running ? "running" : "idle"}
                </span>
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? "bg-accent" : "bg-disabled"}`} />
              </div>
            ) : (
              <p className="m-0 py-2 text-xs text-muted">No connected agent yet.</p>
            )}
            {agents.map((agent) => (
              <div key={agent.name} className="flex items-center gap-3 border-t border-line pt-3">
                <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-surface-2 font-mono text-xs font-semibold text-ink">
                  {agent.initials}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium text-ink">{agent.name}</span>
                  <span className="text-[11px] text-muted">active ${relativeTime(agent.lastActiveAt, now)}</span>
                </div>
                <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? "bg-accent" : "bg-disabled"}`} />
              </div>
            ))}
            {unlinkConfirm ? (
              <div role="group" aria-label="Confirm unlink agent" className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <span className="text-[11px] text-muted">
                  {running ? "Stop agent and unlink?" : "Unlink agent?"}
                </span>
                <button
                  type="button"
                  onClick={handleUnlink}
                  disabled={busy}
                  className="rounded-[9px] border border-danger/60 bg-transparent px-2.5 py-1 text-[11px] font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
                >
                  {busy ? "Unlinking…" : "Yes, unlink"}
                </button>
                <button
                  type="button"
                  onClick={() => setUnlinkConfirm(false)}
                  className="rounded-[9px] border border-line bg-transparent px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => (project.agentCommand ? handleUnlink() : setConnectOpen(true))}
                className="mt-1 flex items-center gap-1.5 self-start rounded-[9px] border border-done bg-transparent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/10 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {project.agentCommand ? <path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" /> : <path d="M12 5v14M5 12h14" />}
                </svg>
                {project.agentCommand ? "Unlink agent" : "Connect agent"}
              </button>
            )}
          </section>
        </div>
      </div>

      {connectOpen && (
        <ConnectAgentDialog
          project={project}
          onClose={() => setConnectOpen(false)}
          onSaved={onRefresh}
          onEditProject={onEditProject}
        />
      )}
    </div>
  );
}
