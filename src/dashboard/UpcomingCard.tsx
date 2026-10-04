import type { UpcomingDay } from "../api";
import { upcomingLabel } from "../format";
import type { PageId } from "../shell/nav";

/** Next seven days: weekday, date, one dot per task, first task, "+n lagi" (spec U10). */
export function UpcomingCard({
  days,
  onOpen,
  onSelect,
}: Readonly<{
  days?: UpcomingDay[];
  onOpen: (id: string) => void;
  onSelect?: (page: PageId) => void;
}>) {
  return (
    <section aria-labelledby="c-jadwal" className="col-span-2 flex flex-col gap-2 overflow-hidden rounded-[14px] border border-line bg-surface p-3 px-3.5">
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
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        <h2 id="c-jadwal" className="m-0 font-display text-sm font-semibold text-ink">7 hari ke depan</h2>
        {onSelect ? (
          <button type="button" onClick={() => onSelect("jadwal")} className="ml-auto text-xs text-accent hover:underline">
            Kalender ›
          </button>
        ) : (
          <span className="ml-auto text-xs text-accent">Kalender ›</span>
        )}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {days?.map((d) => {
          const { weekday, day } = upcomingLabel(d.date);
          const first = d.tasks[0];
          return (
            <div key={d.date} className="flex min-w-0 flex-col gap-1 rounded-[10px] bg-stage p-2 text-ink">
              <span className="text-[11px] text-muted">{weekday}</span>
              <span className="font-mono text-sm leading-none">{day}</span>
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
              {d.tasks.length > 1 && <span className="text-[10px] text-muted">+{d.tasks.length - 1} lagi</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
