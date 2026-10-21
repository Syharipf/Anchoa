import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../shell/toast";
import { PRIMARY } from "../shell/ui";

export function TerminalDrawer({
  projectId,
  running,
  taskId,
  onPromptSent,
}: Readonly<{
  projectId: string;
  running: boolean;
  taskId?: string | null;
  onPromptSent?: () => void;
}>) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [log, setLog] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!taskId) {
      setLog(null);
      return;
    }
    let active = true;
    api.agentLog(taskId).then(
      (text) => {
        if (active) setLog(text);
      },
      () => {
        if (active) setLog(null);
      }
    );
    return () => {
      active = false;
    };
  }, [taskId]);

  async function handleSendPrompt(e: FormEvent) {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || busy || running) return;
    setBusy(true);
    try {
      await api.agentRequest(projectId, text);
      toast("Instructions sent to omp harness");
      setPrompt("");
      setExpanded(true);
      onPromptSent?.();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenExternal() {
    try {
      await api.projectOpenExternalTerminal(projectId);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }

  return (
    <section
      aria-label="Harness Terminal"
      className="flex shrink-0 flex-col overflow-hidden rounded-[12px] border border-line bg-[#081013]"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-accent"
          >
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span className="font-display text-xs font-semibold text-ink">
            Harness Terminal (omp)
          </span>
          <span className="font-mono text-[11px] text-muted">
            {running ? "● active in project directory" : "○ idle"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenExternal}
            title="Open system terminal emulator"
            className="flex items-center gap-1 rounded border border-line px-2 py-0.5 font-mono text-[11px] text-muted hover:text-ink"
          >
            External Terminal ↗
          </button>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="rounded border border-line px-2 py-0.5 text-xs text-muted hover:text-ink"
          >
            {expanded ? "▼ Collapse" : "▲ Open Terminal"}
          </button>
        </div>
      </div>

      {/* Expanded output screen */}
      {expanded && (
        <div className="h-48 overflow-y-auto p-4 font-mono text-[12px] leading-relaxed text-[#C3D2D6]">
          {log ? (
            <pre className="whitespace-pre-wrap font-mono">{log}</pre>
          ) : (
            <div className="flex h-full flex-col justify-end text-muted">
              <p>$ anchoa agent --status idle</p>
              <p className="text-[11px] text-accent">
                Ready to receive prompt instructions for omp harness.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Quick Prompt Bar */}
      <form
        onSubmit={handleSendPrompt}
        className="flex items-center gap-2.5 border-t border-line bg-surface px-4 py-2.5"
      >
        <span className="font-mono text-xs font-bold text-accent">&gt;</span>
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={busy || running}
          placeholder="Send prompt instructions directly to omp (Enter)..."
          className="flex-1 bg-transparent border-0 text-xs text-ink outline-none"
        />
        <button
          type="submit"
          disabled={busy || running || !prompt.trim()}
          className={`${PRIMARY} py-1 px-2.5 text-xs`}
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </form>
    </section>
  );
}
