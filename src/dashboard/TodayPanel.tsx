import type { DayTask } from "../api";
import { shortDate } from "../format";
import { H2, PANEL } from "../shell/ui";

function dueLabel(t: DayTask, late: boolean): string {
  if (!t.overdue) return "hari ini";
  return late ? `${shortDate(t.dueAt)} · terlambat` : shortDate(t.dueAt);
}

export function TodayPanel({
  tasks,
  onToggle,
  onOpen,
}: Readonly<{ tasks?: DayTask[]; onToggle: (task: DayTask) => void; onOpen: (id: string) => void }>) {
  const list = tasks ?? [];
  const done = list.filter((t) => t.completedAt !== null).length;

  return (
    <section className={`${PANEL} flex flex-col gap-1`}>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className={H2}>Hari ini</h2>
        <span className="font-mono text-xs text-muted">
          {done}/{list.length}
        </span>
      </div>
      {tasks?.length === 0 && <p className="m-0 text-sm text-muted">Tidak ada tugas hari ini</p>}
      {list.map((t) => {
        const isDone = t.completedAt !== null;
        const late = t.overdue && !isDone;
        return (
          <div
            key={t.id}
            className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-surface-2 ${late ? "bg-danger-row" : ""}`}
          >
            <input
              type="checkbox"
              checked={isDone}
              onChange={() => onToggle(t)}
              aria-label={`Tandai selesai: ${t.title || "Tanpa judul"}`}
              className="m-0 h-4 w-4 cursor-pointer accent-accent"
            />
            <button
              onClick={() => onOpen(t.id)}
              className={`flex-1 truncate text-left ${isDone ? "text-done line-through" : "text-ink"}`}
            >
              {t.title || "Tanpa judul"}
            </button>
            <span className={`shrink-0 font-mono text-xs ${late ? "text-danger" : "text-muted"}`}>{dueLabel(t, late)}</span>
          </div>
        );
      })}
    </section>
  );
}
