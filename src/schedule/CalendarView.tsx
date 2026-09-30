import type { ScheduleItem } from "../api";
import { agendaTitle, chipsFor, KIND_COLORS, monthGrid } from "./layout";

const DAYS_OF_WEEK = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"] as const;

export function CalendarView({
  month,
  today,
  selectedDate,
  items,
  onSelectDate,
}: Readonly<{
  month: string;
  today: string;
  selectedDate: string;
  items: readonly ScheduleItem[];
  onSelectDate: (date: string) => void;
}>) {
  const grid = monthGrid(month);
  const rows = grid.length;

  return (
    <section
      aria-label="Kalender"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line bg-line"
    >
      <div
        aria-hidden="true"
        className="grid grid-cols-7 gap-[1px] border-b border-line bg-line"
      >
        {DAYS_OF_WEEK.map((day) => (
          <span
            key={day}
            className="bg-sidebar px-2.5 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted"
          >
            {day}
          </span>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-7 auto-rows-fr gap-[1px] bg-line">
        {grid.flatMap((row) =>
          row.map((cell) => {
            const { shown, more } = chipsFor(items, cell.date, rows);
            const isSelected = cell.date === selectedDate;
            const isToday = cell.date === today;
            const dayNum = Number(cell.date.split("-")[2]);

            return (
              <button
                key={cell.date}
                type="button"
                onClick={() => onSelectDate(cell.date)}
                aria-pressed={isSelected}
                aria-label={agendaTitle(cell.date)}
                className={`flex min-h-0 min-w-0 flex-col items-stretch gap-1 p-1.5 text-left transition-colors ${
                  isSelected
                    ? "bg-surface-2"
                    : cell.inMonth
                      ? "bg-stage hover:bg-surface-2/60"
                      : "bg-[#0e1014] hover:bg-surface-2/40"
                } ${isToday ? "ring-1 ring-inset ring-accent" : ""}`}
              >
                <span
                  className={`flex h-[22px] min-w-[22px] self-start items-center justify-center rounded-full px-1 font-mono text-xs ${
                    isToday
                      ? "bg-accent font-bold text-canvas"
                      : cell.inMonth
                        ? "font-medium text-ink"
                        : "font-normal text-muted/40"
                  }`}
                >
                  {dayNum}
                </span>

                <span className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
                  {shown.map((item) => (
                    <span
                      key={item.key}
                      title={`${item.title} · ${item.groupName}${
                        item.overdue ? " · terlambat" : ""
                      }`}
                      className={`flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] leading-4 text-ink bg-surface-2 ${
                        item.overdue ? "ring-1 ring-inset ring-danger" : ""
                      }`}
                    >
                      <span
                        className="h-2.5 w-[3px] shrink-0 rounded-[1px]"
                        style={{ backgroundColor: KIND_COLORS[item.kind] }}
                      />
                      <span
                        className={`min-w-0 truncate ${
                          item.status === "done" ? "text-done line-through" : ""
                        }`}
                      >
                        {item.title}
                      </span>
                    </span>
                  ))}
                  {more > 0 && (
                    <span className="pl-1 text-[11px] text-muted">+{more} lagi</span>
                  )}
                </span>
              </button>
            );
          }),
        )}
      </div>
    </section>
  );
}
