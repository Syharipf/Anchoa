import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage, type EmailFilter, type EmailFolder, type EmailMessage, type EmailStatus } from "../api";
import { H1, HEADER_PRIMARY, HEADER_SECONDARY, SECONDARY } from "../shell/ui";
import { ComposeDialog } from "./ComposeDialog";
import { ConnectionForm } from "./ConnectionForm";
import { EmailList } from "./EmailList";
import { ReadingPane } from "./ReadingPane";
import { EMAIL_LABELS, FOLDERS } from "./view";

export function EmailPage({ onChanged, onOpenAssistant }: Readonly<{ onChanged?: () => void; onOpenAssistant?: (req: { kind: "voice" }) => void }>) {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [folder, setFolder] = useState<EmailFolder>("inbox");
  const [filter, setFilter] = useState<EmailFilter>("all");
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [selected, setSelected] = useState<EmailMessage | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const lists = useRef(0);
  const opens = useRef(0);
  const syncPending = useRef(false);
  const syncQueued = useRef(false);
  const actionPending = useRef(false);
  const query = useRef({ folder, filter });
  query.current = { folder, filter };
  const connected = status?.connected === true;

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      const next = await api.emailStatus();
      if (active.current) setStatus(next);
    } catch (e) {
      if (active.current) setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    active.current = true;
    void loadStatus();
    return () => { active.current = false; lists.current++; opens.current++; };
  }, [loadStatus]);

  const loadList = useCallback(async () => {
    const request = ++lists.current;
    const current = query.current;
    setLoading(true);
    try {
      const next = await api.emailList(current.folder, current.filter);
      if (active.current && request === lists.current) {
        setMessages(next);
        setSelected((current) => current ? next.find((message) => message.id === current.id) ?? current : null);
      }
    } catch (e) {
      if (active.current && request === lists.current) setError(errorMessage(e));
    } finally {
      if (active.current && request === lists.current) setLoading(false);
    }
  }, []);

  const sync = useCallback(async () => {
    if (syncPending.current) {
      syncQueued.current = true;
      return;
    }
    syncPending.current = true;
    syncQueued.current = false;
    setSyncing(true);
    setError(null);
    try {
      await api.emailSync();
      if (active.current) await loadList();
    } catch (e) {
      if (active.current) setError(errorMessage(e));
    } finally {
      syncPending.current = false;
      if (active.current && syncQueued.current) void sync();
      else if (active.current) setSyncing(false);
    }
  }, [loadList]);

  useEffect(() => { if (connected) void sync(); }, [connected, sync]);
  useEffect(() => { if (connected) void loadList(); }, [connected, folder, filter, loadList]);

  function selectFolder(next: EmailFolder) {
    if (next === folder) return;
    lists.current++;
    opens.current++;
    setFolder(next);
    setMessages([]);
    setSelected(null);
    setOpeningId(null);
    setError(null);
  }

  function selectFilter(next: EmailFilter) {
    if (next === filter) return;
    lists.current++;
    opens.current++;
    setOpeningId(null);
    setFilter(next);
    setMessages([]);
    setError(null);
  }

  async function open(id: string) {
    if (selected?.id === id && !openingId) return;
    const request = ++opens.current;
    setOpeningId(id);
    const initial = messages.find((m) => m.id === id) ?? null;
    setSelected(initial);
    setError(null);
    try {
      const message = await api.emailOpen(id);
      if (!active.current || request !== opens.current) return;
      // Invalidate any list captured before email_open marked this row read.
      lists.current++;
      setLoading(false);
      setSelected(message);
      setMessages((rows) => rows.map((row) => row.id === id ? message : row)
        .filter((row) => query.current.filter !== "unread" || row.unread));
    } catch (e) {
      if (active.current && request === opens.current) {
        setError(errorMessage(e));
        setSelected(null);
      }
    } finally {
      if (active.current && request === opens.current) setOpeningId(null);
    }
  }

  async function mutate(action: () => Promise<void>) {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(true);
    setError(null);
    lists.current++;
    setLoading(false);
    try {
      await action();
      if (active.current) await loadList();
    } catch (e) {
      if (active.current) setError(errorMessage(e));
    } finally {
      actionPending.current = false;
      if (active.current) setBusy(false);
    }
  }

  const star = (message: EmailMessage) => mutate(async () => {
    await api.emailSetFlag(message.id, "starred", !message.starred);
    if (active.current) setSelected((current) => current?.id === message.id ? { ...current, starred: !message.starred } : current);
  });

  const archive = (message: EmailMessage) => mutate(async () => {
    await api.emailArchive(message.id);
    if (active.current) {
      setSelected((current) => current?.id === message.id ? null : current);
      setMessages((rows) => rows.filter((row) => row.id !== message.id));
    }
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className={H1}>Email</h1>
        {connected && <>
          <span className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            {status.address}
          </span>
          <span className="text-xs text-muted">{syncing ? "Menyinkronkan…" : "Disinkronkan"}</span>
          <div className="ml-auto flex items-center gap-2.5">
            <button
              type="button"
              aria-label="Sinkronkan"
              disabled={syncing || busy}
              onClick={() => void sync()}
              className={HEADER_SECONDARY}
            >
              {syncing ? "Menyinkronkan…" : "Sinkronkan"}
            </button>
            <button
              type="button"
              aria-label="Tulis lewat suara"
              onClick={() => onOpenAssistant?.({ kind: "voice" })}
              className={HEADER_SECONDARY}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#C6F36B"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
              </svg>
              <span>Tulis lewat suara</span>
            </button>
            <button type="button" aria-label="Tulis" onClick={() => setComposing(true)} className={`${HEADER_PRIMARY} flex items-center gap-1.5`}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 20h4L19 9l-4-4L4 16z" />
              </svg>
              <span>Tulis</span>
            </button>
          </div>
        </>}
      </div>
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
      {status === null && <div className="text-sm text-muted">
        {error ? <button type="button" onClick={() => void loadStatus()} className={SECONDARY}>Coba lagi</button> : <span role="status">Memuat akun email…</span>}
      </div>}
      {status && !connected && <ConnectionForm onConnected={setStatus} />}
      {connected && <div className="flex min-h-0 flex-1 gap-3.5">
        <nav aria-label="Folder email" className="flex w-[176px] shrink-0 flex-col gap-0.5">
          {FOLDERS.map((entry) => <button key={entry.id} type="button" aria-label={entry.label} aria-current={folder === entry.id ? "page" : undefined}
            onClick={() => selectFolder(entry.id)} className={`flex min-h-9 items-center rounded-lg px-2.5 text-left text-[13px] transition-colors hover:bg-surface-2 ${folder === entry.id ? "bg-surface-2 font-semibold text-ink" : "text-muted"}`}>{entry.label}</button>)}
          <span className="px-2.5 pt-4 pb-1.5 text-[11px] uppercase tracking-[0.08em] text-muted">Label</span>
          {EMAIL_LABELS.map((lbl) => (
            <div key={lbl.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-[#C9CED8]">
              <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: lbl.color }} />
              <span>{lbl.label}</span>
            </div>
          ))}
        </nav>
        <EmailList
          messages={messages}
          folder={folder}
          filter={filter}
          loading={loading}
          selectedId={openingId ?? selected?.id ?? null}
          busy={busy}
          onFilter={selectFilter}
          onOpen={open}
          onStar={star}
        />
        {selected ? <ReadingPane key={selected.id} message={selected} busy={busy} onStar={star} onArchive={archive} onSent={() => void sync()} onChanged={onChanged} /> : (
          <div className="flex min-w-0 flex-1 items-center justify-center rounded-[14px] border border-line bg-surface p-5 text-sm text-muted">
            <span role="status">{openingId ? "Membuka email…" : "Pilih email untuk dibaca."}</span>
          </div>
        )}
      </div>}
      {composing && <ComposeDialog onClose={() => setComposing(false)} onSent={() => void sync()} />}
    </>
  );
}
