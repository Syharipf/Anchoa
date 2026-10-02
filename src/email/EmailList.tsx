import type { EmailFilter, EmailFolder, EmailMessage } from "../api";
import { relativeTime } from "../format";
import { StarButton } from "./StarButton";
import { FOLDERS, sender } from "./view";

const TABS: readonly Readonly<{ id: EmailFilter; label: string }>[] = [
  { id: "all", label: "Semua" }, { id: "unread", label: "Belum dibaca" },
];

export function EmailList({ messages, folder, filter, loading, selectedId, busy, onFilter, onOpen, onStar }: Readonly<{
  messages: readonly EmailMessage[]; folder: EmailFolder; filter: EmailFilter; loading: boolean;
  selectedId: string | null; busy: boolean; onFilter: (filter: EmailFilter) => void;
  onOpen: (id: string) => void; onStar: (message: EmailMessage) => void;
}>) {
  const now = Date.now();
  return (
    <section aria-label="Daftar email" aria-busy={loading} className="flex min-h-0 w-[340px] shrink-0 flex-col overflow-hidden rounded-[14px] border border-line bg-surface">
      <div className="flex flex-col gap-3 border-b border-line p-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="m-0 font-display text-sm font-semibold">{FOLDERS.find((entry) => entry.id === folder)?.label}</h2>
          <span className="text-xs text-muted">{messages.filter((entry) => entry.unread).length} belum dibaca</span>
        </div>
        <div className="flex gap-1" aria-label="Filter email">
          {TABS.map((tab) => <button key={tab.id} type="button" aria-pressed={filter === tab.id} onClick={() => onFilter(tab.id)}
            className={`min-h-8 rounded-lg px-3 text-xs transition-colors hover:bg-surface-2 ${filter === tab.id ? "bg-surface-2 text-ink" : "text-muted"}`}>{tab.label}</button>)}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && <p role="status" className="m-0 p-3 text-sm text-muted">Memuat email…</p>}
        {!loading && messages.length === 0 && <p className="m-0 p-6 text-center text-sm text-muted">{filter === "unread" ? "Semua sudah dibaca." : "Belum ada email."}</p>}
        {messages.map((message) => (
          <div key={message.id} className={`relative mb-1 rounded-lg border ${selectedId === message.id ? "border-field-focus bg-surface-2" : "border-transparent"}`}>
            <button type="button" onClick={() => onOpen(message.id)} aria-pressed={selectedId === message.id}
              className="flex w-full flex-col gap-1 rounded-lg py-3 pr-10 pl-6 text-left transition-colors hover:bg-surface-2">
              {message.unread && <>
                <span aria-hidden="true" className="absolute top-4 left-2 h-1.5 w-1.5 rounded-full bg-accent" />
                <span className="sr-only">Belum dibaca</span>
              </>}
              <span className="flex w-full items-baseline gap-2">
                <span className={`min-w-0 flex-1 truncate text-[13px] ${message.unread ? "font-semibold text-ink" : "text-muted"}`}>{sender(message)}</span>
                <time dateTime={new Date(message.sentAt).toISOString()} className="shrink-0 font-mono text-[10px] text-muted">{relativeTime(message.sentAt, now)}</time>
              </span>
              <span className={`w-full truncate text-[13px] ${message.unread ? "font-semibold" : "text-ink"}`}>{message.subject || "(Tanpa subjek)"}</span>
            </button>
            <div className="absolute top-2 right-1"><StarButton message={message} busy={busy} onStar={onStar} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}
