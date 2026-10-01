import { useRef, useState, type FormEvent } from "react";
import { api, errorMessage, type ProjectDetail, type TaskCard } from "../api";
import { useToast } from "../shell/toast";
import { FIELD, H2, PRIMARY, SECONDARY } from "../shell/ui";

export function AgentRequest({
  project, running, logAvailable, onRequested, onRefresh, onShowLog,
}: Readonly<{
  project: ProjectDetail;
  running: boolean;
  logAvailable: boolean;
  onRequested: (task: TaskCard) => void;
  onRefresh: () => void;
  onShowLog: () => void;
}>) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    const request = text.trim();
    if (!request || running || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const task = await api.agentRequest(project.id, request);
      setText("");
      onRequested(task);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      pending.current = false;
      setBusy(false);
      // A failed command launch can still have saved the request as a task.
      onRefresh();
    }
  }

  async function stop() {
    if (!running || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await api.agentStop(project.id);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      pending.current = false;
      setBusy(false);
      onRefresh();
    }
  }

  return (
    <section aria-labelledby="agent-request-title" className="flex shrink-0 flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-3.5">
      <div className="flex items-center gap-3">
        <h2 id="agent-request-title" className={H2}>Minta agen</h2>
        <span role="status" aria-live="polite" className="ml-auto flex items-center gap-1.5 text-xs text-muted">
          {running && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />}
          {running ? "Agen berjalan…" : ""}
        </span>
        <button type="button" onClick={onShowLog} disabled={!logAvailable}
          className="text-xs text-accent hover:text-accent-hover disabled:text-disabled">Lihat log</button>
      </div>
      <form onSubmit={send} className="flex items-end gap-2.5">
        <textarea aria-label="Permintaan ke agen" value={text} onChange={(event) => setText(event.target.value)}
          disabled={busy} rows={2} placeholder="Apa yang ingin dikerjakan agen?"
          className={`${FIELD} min-w-0 flex-1 resize-y`} />
        <button type="submit" disabled={busy || running || !text.trim()} className={PRIMARY}>Kirim</button>
        <button type="button" onClick={stop} disabled={busy || !running}
          className={`${SECONDARY} text-danger disabled:text-disabled disabled:hover:bg-transparent`}>Hentikan</button>
      </form>
      {!project.agentCommand && <p className="m-0 text-xs text-muted">Permintaan menunggu di Rencana sampai agen mengambilnya.</p>}
    </section>
  );
}
