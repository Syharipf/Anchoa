import type { DayTask } from "../api";
import { shortDate } from "../format";
import type { PageId } from "../shell/nav";
function dueLabel(t: DayTask, late: boolean): string {
  if (!t.overdue) return "hari ini";
  return late ? `${shortDate(t.dueAt)} · terlambat` : shortDate(t.dueAt);
}

function segmentColor(t: DayTask): string {
  if (t.completedAt !== null) return "bg-accent";
  return t.overdue ? "bg-danger" : "bg-line";
}

export function TodayPanel({
  tasks,
  onToggle,
  onOpen,
  onSelect,
}: Readonly<{
  tasks?: DayTask[];
  onToggle: (task: DayTask) => void;
  onOpen: (id: string) => void;
  onSelect?: (page: PageId) => void;
}>) {
  const list = tasks ?? [];
  const done = list.filter((t) => t.completedAt !== null).length;

  return (
    <section aria-labelledby="c-hari" className="col-span-2 flex flex-col gap-1.5 overflow-hidden rounded-[14px] border border-line bg-surface p-3 px-3.5">
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
          <path d="M4 12l5 5L20 6" />
        </svg>
        <h2 id="c-hari" className="m-0 font-display text-sm font-semibold text-ink">Hari ini</h2>
        <div aria-hidden="true" className="ml-2 flex w-[72px] gap-[3px]">
          {list.map((t) => (
            <span key={t.id} className={`h-1 flex-1 rounded-[2px] transition-colors ${segmentColor(t)}`} />
          ))}
        </div>
        <span className="ml-auto font-mono text-[11px] text-muted">
          {done}/{list.length} selesai
        </span>
        {onSelect ? (
          <button type="button" onClick={() => onSelect("jadwal")} className="text-xs text-accent hover:underline">
            Jadwal ›
          </button>
        ) : (
          <span className="text-xs text-accent">Jadwal ›</span>
        )}
      </div>
      {tasks?.length === 0 && <p className="m-0 text-sm text-muted">Tidak ada tugas hari ini</p>}
      {list.map((t) => {
        const isDone = t.completedAt !== null;
        const late = t.overdue && !isDone;
        return (
          <div
            key={t.id}
            className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors hover:bg-surface-2 ${late ? "bg-danger-row" : ""}`}
          >
            <input
              type="checkbox"
              checked={isDone}
              onChange={() => onToggle(t)}
              aria-label={`Tandai selesai: ${t.title || "Tanpa judul"}`}
              className="m-0 h-[15px] w-[15px] cursor-pointer accent-accent"
            />
            <button
              onClick={() => onOpen(t.id)}
              className={`flex-1 truncate text-left ${isDone ? "text-done line-through" : "text-ink"}`}
            >
              {t.title || "Tanpa judul"}
            </button>
            <span className={`shrink-0 font-mono text-[11px] ${late ? "text-danger" : "text-muted"}`}>{dueLabel(t, late)}</span>
          </div>
        );
      })}
    </section>
  );
}
