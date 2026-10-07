import type { ItemSummary } from "../api";
import { relativeTime } from "../format";
import type { PageId } from "../shell/nav";

/** Document icon for notes; other item types get their own icon when they exist. */
function NoteIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M9 11h6M9 15h6" />
    </svg>
  );
}

/** Fills the "Berkas terbaru" slot of the bento until Berkas lands in Fase 6 (spec U9). */
export function RecentPanel({
  items,
  onOpen,
  onSelect,
}: Readonly<{
  items?: ItemSummary[];
  onOpen: (id: string) => void;
  onSelect?: (page: PageId) => void;
}>) {
  const now = Date.now();
  return (
    <section aria-labelledby="c-berkas" className="flex flex-col gap-1.5 overflow-hidden rounded-[14px] border border-line bg-surface p-3 px-3.5">
      <div className="flex items-center gap-2">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted"
          aria-hidden="true"
        >
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
        <h2 id="c-berkas" className="m-0 font-display text-sm font-semibold text-ink">Catatan terbaru</h2>
        {onSelect ? (
          <button type="button" onClick={() => onSelect("catatan")} className="ml-auto text-xs text-accent hover:underline">
            ›
          </button>
        ) : (
          <span className="ml-auto text-xs text-accent">›</span>
        )}
      </div>
      {items?.length === 0 && <p className="m-0 text-sm text-muted">Belum ada item</p>}
      {items?.slice(0, 3).map((i) => (
        <button key={i.id} type="button" onClick={() => onOpen(i.id)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
            <NoteIcon />
          </span>
          <span className="flex-1 truncate">{i.title || "Tanpa judul"}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted">{relativeTime(i.lastActivityAt, now)}</span>
        </button>
      ))}
    </section>
  );
}
