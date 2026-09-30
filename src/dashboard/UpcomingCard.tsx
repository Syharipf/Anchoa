import type { UpcomingDay } from "../api";
import { upcomingLabel } from "../format";
import { H2, PANEL } from "../shell/ui";

/** Next seven days: weekday, date, one dot per task, first task, "+n lagi" (spec U10). */
export function UpcomingCard({ days, onOpen }: Readonly<{ days?: UpcomingDay[]; onOpen: (id: string) => void }>) {
  return (
    <section className={`${PANEL} col-span-2 flex flex-col gap-3`}>
      <h2 className={H2}>7 hari ke depan</h2>
      <div className="grid grid-cols-7 gap-2">
        {days?.map((d) => {
          const { weekday, day } = upcomingLabel(d.date);
          const first = d.tasks[0];
          return (
            <div key={d.date} className="flex min-w-0 flex-col gap-1.5 rounded-lg bg-stage px-2 py-2.5">
              <span className="text-[11px] tracking-[0.08em] text-muted uppercase">{weekday}</span>
              <span className="font-mono text-lg leading-none">{day}</span>
              <span aria-hidden="true" className="flex h-1.5 gap-1">
                {d.tasks.slice(0, 4).map((t) => (
                  <span key={t.id} className="h-1.5 w-1.5 rounded-full bg-accent" />
                ))}
              </span>
              {first ? (
                <button onClick={() => onOpen(first.id)} className="truncate text-left text-xs text-ink hover:text-accent">
                  {first.title || "Tanpa judul"}
                </button>
              ) : (
                <span className="text-xs text-disabled">—</span>
              )}
              {d.tasks.length > 1 && <span className="text-[11px] text-muted">+{d.tasks.length - 1} lagi</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
