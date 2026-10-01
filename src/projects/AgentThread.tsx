import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, errorMessage, type Activity, type TaskCard, type TaskStatus } from "../api";
import { relativeTime } from "../format";
import { splitBlocks } from "../notes/blocks";
import { BlockPreview } from "../notes/markdown";
import { useToast } from "../shell/toast";
import { FIELD, H2, PRIMARY } from "../shell/ui";
import { actorInitials, boardColumns, ROLE_LABELS } from "./view";

const unresolved = () => false;
const readOnlyTodo = () => {};

function ActivityMessage({ activity, now, onOpenItem }: Readonly<{
  activity: Activity;
  now: number;
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

  return (
    <li className="flex items-start gap-2.5">
      <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 font-display text-xs font-semibold text-accent">
        {actorInitials(activity.actor)}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-[13px] font-semibold text-ink">{activity.actor}</span>
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{ROLE_LABELS[activity.role]}</span>
          <time dateTime={new Date(activity.createdAt).toISOString()} title={new Date(activity.createdAt).toLocaleString("id-ID")}
            className="text-[11px] text-muted">{relativeTime(activity.createdAt, now)}</time>
        </div>
        {activity.title && activity.title !== activity.body.trim() && <p className="m-0 text-sm font-medium text-ink">{activity.title}</p>}
        <div className="flex flex-col gap-2 break-words">
          {blocks.map((block) => <BlockPreview key={block.id} text={block.text} isResolved={unresolved}
            onOpenLink={(title) => void openNote(title)} onOpenUrl={openUrl} onToggleTodo={readOnlyTodo} />)}
        </div>
      </div>
    </li>
  );
}

/** Mounted only inside an open agent project. Log responses also discard older requests. */
export function AgentLog({ taskId }: Readonly<{ taskId: string }>) {
  const toast = useToast();
  const [log, setLog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let requests = 0;
    setLog(null);
    setError(null);
    async function load() {
      const request = ++requests;
      try {
        const text = await api.agentLog(taskId);
        if (active && request === requests) {
          setLog(text);
          setError(null);
        }
      } catch (error) {
        if (active && request === requests) {
          const message = errorMessage(error);
          setError(message);
          toast(message, "error");
        }
      }
    }
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      active = false;
      requests++;
      clearInterval(timer);
    };
  }, [taskId, toast]);

  if (error) return <p className="m-0 text-sm text-danger">{error}</p>;
  if (log === null) return <p className="m-0 text-sm text-muted">Memuat log…</p>;
  return log ? <pre className="m-0 whitespace-pre-wrap break-words rounded-[10px] bg-stage p-3 font-mono text-xs leading-relaxed text-ink">{log}</pre>
    : <p className="m-0 text-sm text-muted">Belum ada log untuk tugas ini.</p>;
}

export function AgentThread({
  task, activities, showLog = false, onChanged, onClose, onOpenItem,
}: Readonly<{
  task: TaskCard;
  activities?: readonly Activity[];
  showLog?: boolean;
  onChanged: () => void;
  onClose: () => void;
  onOpenItem: (id: string) => void;
}>) {
  const toast = useToast();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const chronological = useMemo(() => [...(activities ?? [])].sort((a, b) => a.createdAt - b.createdAt), [activities]);
  const now = Date.now();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previous?.focus();
  }, []);

  async function save(action: () => Promise<unknown>, onSaved?: () => void) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await action();
      onSaved?.();
      onChanged();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    const body = reply.trim();
    const projectId = task.projectId;
    if (!body || !projectId) return;
    await save(() => api.addActivity({
      taskId: task.id, projectId, actor: "Kamu", role: "note", kind: "message",
      title: body.split("\n")[0].slice(0, 120), body,
    }), () => setReply(""));
  }

  function setStatus(status: TaskStatus) {
    return save(() => api.updateTask(task.id, { status }));
  }

  return (
    <aside aria-label={showLog ? "Log agen" : "Utas"} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    }} className="flex min-h-0 w-[360px] shrink-0 flex-col overflow-hidden rounded-[14px] border border-line bg-surface">
      <div className="flex shrink-0 items-start gap-3 border-b border-line p-3.5">
        <div className="min-w-0 flex-1">
          <h2 className={H2}>{showLog ? "Log agen" : "Utas"}</h2>
          <p className="m-0 mt-1 break-words text-[13px] text-muted">{task.title || "Tanpa judul"}</p>
        </div>
        <button ref={closeButton} type="button" onClick={onClose} aria-label={showLog ? "Tutup log" : "Tutup utas"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink">×</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {showLog ? <AgentLog key={task.id} taskId={task.id} /> : (
          <ol className="m-0 flex list-none flex-col gap-5 p-0" aria-label="Aktivitas tugas">
            {chronological.map((activity) => <ActivityMessage key={activity.id} activity={activity} now={now} onOpenItem={onOpenItem} />)}
            {chronological.length === 0 && <li className="text-sm text-muted">{activities ? "Belum ada aktivitas." : "Memuat utas…"}</li>}
          </ol>
        )}
      </div>
      {!showLog && (
        <div className="flex shrink-0 flex-col gap-3 border-t border-line p-3.5">
          <div className="flex flex-wrap gap-1.5" aria-label="Status tugas">
            {boardColumns(true).map(({ status, title }) => <button key={status} type="button" disabled={busy}
              onClick={() => setStatus(status)} aria-pressed={task.status === status}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${task.status === status ? "border-field-focus bg-surface-2 text-accent" : "border-line text-muted hover:bg-surface-2 hover:text-ink"}`}>{title}</button>)}
          </div>
          <form onSubmit={sendReply} className="flex flex-col gap-2">
            <textarea aria-label="Balas di utas" value={reply} onChange={(event) => setReply(event.target.value)}
              disabled={busy} rows={3} placeholder="Tulis balasan… (Markdown)" className={`${FIELD} resize-y`} />
            <button type="submit" disabled={busy || !reply.trim()} className={`${PRIMARY} self-end`}>Balas</button>
          </form>
        </div>
      )}
    </aside>
  );
}
