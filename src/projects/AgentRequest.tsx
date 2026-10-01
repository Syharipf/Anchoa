import { useRef, useState, type FormEvent } from "react";
import { api, errorMessage, type ProjectDetail, type TaskCard } from "../api";
import { useToast } from "../shell/toast";
import { FIELD, H2, PRIMARY, SECONDARY } from "../shell/ui";
import { AGENT_QUICK_BUTTONS } from "./view";

export function AgentRequest({
  project, running, onRequested, onRefresh,
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
    <section aria-labelledby="agent-request-title" className="flex shrink-0 flex-col gap-3 rounded-[14px] border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <h2 id="agent-request-title" className={`${H2} whitespace-nowrap`}>Kirim ke agen</h2>
        {project.agentDir && (
          <span className="font-mono text-xs text-muted truncate max-w-[200px]" title={project.agentDir}>
            {project.agentDir}
          </span>
        )}
        <span role="status" aria-live="polite" className="ml-auto flex items-center gap-1.5 text-xs text-muted">
          {running && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />}
          {running ? "Agen berjalan…" : ""}
        </span>
      </div>
      <form onSubmit={send} className="flex flex-col gap-2.5">
        <textarea
          aria-label="Permintaan ke agen"
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={busy}
          rows={2}
          placeholder="Misalnya: perbaiki tes yang gagal, lalu jalankan ulang tesnya."
          className={`${FIELD} min-w-0 resize-y`}
        />
        <div className="flex flex-wrap gap-1.5">
          {AGENT_QUICK_BUTTONS.map((quick) => (
            <button
              key={quick}
              type="button"
              onClick={() => setText(quick)}
              disabled={busy}
              className="rounded-full border border-line bg-transparent px-2.5 py-0.5 text-[11px] text-muted transition-colors hover:border-border-strong hover:text-ink disabled:opacity-50"
            >
              {quick}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <div className="flex-1 min-w-0">
            {project.agentCommand ? (
              <p className="m-0 text-xs text-muted truncate" title={`Perintah: ${project.agentCommand}`}>
                Perintah: <code className="font-mono text-[11px] text-ink">{project.agentCommand}</code>
                {project.agentDir ? ` · ${project.agentDir}` : ""}
              </p>
            ) : (
              <p className="m-0 text-xs text-muted">
                Tanpa perintah agen, permintaan menunggu di Rencana sampai agen mengambilnya lewat <code className="font-mono text-[11px]">anchoa agent inbox</code>.
              </p>
            )}
          </div>
          <button type="submit" disabled={busy || running || !text.trim()} className={PRIMARY}>Kirim</button>
          <button type="button" onClick={stop} disabled={busy || !running}
            className={`${SECONDARY} text-danger disabled:text-disabled disabled:hover:bg-transparent`}>Hentikan</button>
        </div>
      </form>
    </section>
  );
}
