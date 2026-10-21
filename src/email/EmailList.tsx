import { useState } from "react";
import type { EmailFilter, EmailFolder, EmailMessage } from "../api";
import { relativeTime } from "../format";
import { StarButton } from "./StarButton";
import { FOLDERS, sender } from "./view";
const TABS: readonly Readonly<{ id: EmailFilter; label: string }>[] = [
  { id: "all", label: "All" }, { id: "unread", label: "Unread" },
];

export function EmailList({ messages, folder, filter, loading, selectedId, busy, onFilter, onOpen, onStar }: Readonly<{
  messages: readonly EmailMessage[]; folder: EmailFolder; filter: EmailFilter; loading: boolean;
  selectedId: string | null; busy: boolean; onFilter: (filter: EmailFilter) => void;
  onOpen: (id: string) => void; onStar: (message: EmailMessage) => void;
}>) {
  const now = Date.now();
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const filteredMessages = q
    ? messages.filter((m) => {
        const from = (m.fromAddr || "").toLowerCase();
        const subject = (m.subject || "").toLowerCase();
        const who = sender(m).toLowerCase();
        return from.includes(q) || subject.includes(q) || who.includes(q);
      })
    : messages;

  return (
    <section aria-label="Email list" aria-busy={loading} className="flex min-h-0 w-[340px] shrink-0 flex-col overflow-hidden rounded-[14px] border border-line bg-surface">
      <div className="flex flex-col gap-2.5 border-b border-line p-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="m-0 font-display text-sm font-semibold">{FOLDERS.find((entry) => entry.id === folder)?.label}</h2>
          <span className="text-xs text-muted">{messages.filter((entry) => entry.unread).length} unread</span>
        </div>
        <div className="flex gap-1" aria-label="Filter emails">
          {TABS.map((tab) => <button key={tab.id} type="button" aria-pressed={filter === tab.id} onClick={() => onFilter(tab.id)}
            className={`min-h-7 rounded-md px-2.5 text-xs transition-colors hover:bg-surface-2 ${filter === tab.id ? "bg-surface-2 font-medium text-ink" : "text-muted"}`}>{tab.label}</button>)}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sender or subject…"
          className="w-full rounded-lg border border-line bg-surface-2/40 px-2.5 py-1 text-xs text-ink placeholder:text-muted focus:border-field-focus focus:outline-none"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading && <p role="status" className="m-0 p-3 text-sm text-muted">Loading emails…</p>}
        {!loading && filteredMessages.length === 0 && (
          <p className="m-0 p-6 text-center text-sm text-muted">
            {q ? "No matching emails." : filter === "unread" ? "All caught up." : "No emails yet."}
          </p>
        )}
        {filteredMessages.map((message) => (
          <div key={message.id} className={`relative mb-1 rounded-lg border ${selectedId === message.id ? "border-field-focus bg-surface-2 shadow-[inset_2px_0_0_#C6F36B]" : "border-transparent"}`}>
            <button type="button" onClick={() => onOpen(message.id)} aria-pressed={selectedId === message.id}
              className="flex w-full flex-col gap-1 rounded-lg py-2.5 pr-11 pl-6 text-left transition-colors hover:bg-surface-2">
              {message.unread && <>
                <span aria-hidden="true" className="absolute top-4 left-2 h-1.5 w-1.5 rounded-full bg-accent" />
                <span className="sr-only">Unread</span>
              </>}
              <span className="flex w-full items-baseline gap-2">
                <span className={`min-w-0 flex-1 truncate text-[13px] ${message.unread ? "font-semibold text-ink" : "text-muted"}`}>{sender(message)}</span>
                <time dateTime={new Date(message.sentAt).toISOString()} className="shrink-0 font-mono text-[10px] text-muted">{relativeTime(message.sentAt, now)}</time>
              </span>
              <span className={`w-full truncate text-[13px] ${message.unread ? "font-semibold" : "text-ink"}`}>{message.subject || "(No subject)"}</span>
            </button>
            <div className="absolute top-2 right-1"><StarButton message={message} busy={busy} onStar={onStar} /></div>
          </div>
        ))}
      </div>
    </section>
  );
}
