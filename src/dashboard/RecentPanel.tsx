import type { ItemSummary } from "../api";
import { relativeTime } from "../format";
import { H2, PANEL, ROW } from "../shell/ui";

/** Document icon for notes; other item types get their own icon when they exist. */
function NoteIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M9 11h6M9 15h6" />
    </svg>
  );
}

export function RecentPanel({ items, onOpen }: Readonly<{ items?: ItemSummary[]; onOpen: (id: string) => void }>) {
  const now = Date.now();
  return (
    <section className={`${PANEL} flex flex-col gap-1`}>
      <h2 className={`${H2} mb-2`}>Item terbaru</h2>
      {items?.length === 0 && <p className="m-0 text-sm text-muted">Belum ada item</p>}
      {items?.map((i) => (
        <button key={i.id} onClick={() => onOpen(i.id)} className={`${ROW} flex items-center gap-3 px-2.5 py-2 text-left text-sm`}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
            <NoteIcon />
          </span>
          <span className="flex-1 truncate">{i.title || "Tanpa judul"}</span>
          <span className="shrink-0 font-mono text-xs text-muted">{relativeTime(i.lastActivityAt, now)}</span>
        </button>
      ))}
    </section>
  );
}
