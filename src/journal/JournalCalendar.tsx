import { useEffect, useMemo, useState } from "react";
import { api, type CalendarDay, type CalendarView } from "../api";

const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"] as const;

export function moodDotColor(mood: number | null): string {
  if (mood === null) {
    return "#5B6475"; // abu-abu kalau tanpa suasana hati
  }
  const rounded = Math.round(mood);
  switch (rounded) {
    case 1:
      return "#FF8A7A"; // Berat
    case 2:
      return "#E89A6A"; // Kurang
    case 3:
      return "#C9CED8"; // Biasa
    case 4:
      return "#86B33A"; // Baik
    case 5:
      return "#C6F36B"; // Senang
    default:
      return rounded < 1 ? "#FF8A7A" : "#C6F36B";
  }
}

function getInitialMonth(init?: string, selected?: string): string {
  if (init) return init;
  if (selected && /^\d{4}-\d{2}/.test(selected)) return selected.slice(0, 7);
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function changeMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const dt = new Date(y, m - 1 + delta, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}
function getDaysOfMonth(month: string): CalendarDay[] {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const res: CalendarDay[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    res.push({
      date: `${month}-${String(d).padStart(2, "0")}`,
      count: 0,
      mood: null,
    });
  }
  return res;
}

// ponytail: grid bulan 1..N hari dengan navigasi sederhana; perbesar ke multi-bulan bila diminta.
export function JournalCalendar({
  selectedDate,
  onSelectDate,
  initialMonth,
  calendarView,
  refreshKey,
}: Readonly<{
  selectedDate?: string;
  onSelectDate: (date: string) => void;
  initialMonth?: string;
  calendarView?: CalendarView | null;
  refreshKey?: unknown;
}>) {
  const [internalMonth, setInternalMonth] = useState(() =>
    getInitialMonth(initialMonth, selectedDate),
  );
  const [fetchedView, setFetchedView] = useState<CalendarView | null>(null);

  useEffect(() => {
    if (selectedDate && /^\d{4}-\d{2}/.test(selectedDate)) {
      setInternalMonth(selectedDate.slice(0, 7));
    }
  }, [selectedDate]);

  const month =
    calendarView !== undefined && calendarView !== null
      ? calendarView.month
      : internalMonth;
  const view = calendarView !== undefined ? calendarView : fetchedView;

  useEffect(() => {
    if (calendarView !== undefined) return;
    let cancelled = false;
    api.journalCalendar(internalMonth).then(
      (data) => {
        if (!cancelled) setFetchedView(data);
      },
      () => {
        if (!cancelled) setFetchedView(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [internalMonth, calendarView, refreshKey]);

  const days: CalendarDay[] = useMemo(() => {
    if (view && view.month === month && view.days.length > 0) {
      return view.days;
    }
    return getDaysOfMonth(month);
  }, [view, month]);

  const [yNum, mNum] = month.split("-").map(Number);
  const leadingEmpty = (new Date(yNum, mNum - 1, 1).getDay() + 6) % 7;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const monthLabel = new Date(yNum, mNum - 1, 1).toLocaleDateString("id-ID", {
    month: "long",
    year: "numeric",
  });
  const currentStreak = view?.currentStreak ?? 0;
  const bestStreak = view?.bestStreak ?? 0;

  return (
    <section
      aria-labelledby="j-cal-heading"
      className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-3.5"
    >
      <div className="flex items-center justify-between">
        <h2 id="j-cal-heading" className="m-0 font-display text-[15px] font-semibold text-ink">
          Kalender
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setInternalMonth((m) => changeMonth(m, -1))}
            aria-label="Bulan sebelumnya"
            className="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ‹
          </button>
          <span className="min-w-[100px] text-center font-mono text-xs text-muted">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={() => setInternalMonth((m) => changeMonth(m, 1))}
            aria-label="Bulan berikutnya"
            className="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ›
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5 rounded-[10px] bg-stage p-2">
          <span className="font-mono text-base font-semibold text-ink">
            {currentStreak}
            <span className="ml-1 text-xs font-normal text-muted">hari</span>
          </span>
          <span className="text-[11px] text-muted">Streak saat ini</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-[10px] bg-stage p-2">
          <span className="font-mono text-base font-semibold text-ink">
            {bestStreak}
            <span className="ml-1 text-xs font-normal text-muted">hari</span>
          </span>
          <span className="text-[11px] text-muted">Terpanjang</span>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="grid grid-cols-7 gap-1 text-center font-mono text-[10px] text-muted"
      >
        {WEEKDAYS.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: leadingEmpty }).map((_, idx) => (
          <span key={`empty-${idx}`} aria-hidden="true" className="h-8" />
        ))}
        {days.map((day) => {
          const isSelected = selectedDate === day.date;
          const isToday = day.date === today;
          const dayNum = parseInt(day.date.split("-")[2], 10);
          const borderClass = isSelected
            ? "border-accent bg-surface-2 text-ink font-semibold ring-1 ring-accent"
            : isToday
              ? "border-line text-accent font-semibold"
              : "border-transparent text-[#C9CED8] hover:bg-surface-2 hover:text-ink";
          const ariaLabel = `${day.date}${day.count > 0 ? `, ${day.count} entri` : ""}${
            day.mood !== null ? `, suasana hati ${day.mood}` : ""
          }`;

          return (
            <button
              key={day.date}
              type="button"
              onClick={() => onSelectDate(day.date)}
              aria-pressed={isSelected}
              aria-label={ariaLabel}
              className={`flex h-8 flex-col items-center justify-center rounded-md border text-xs transition-colors ${borderClass}`}
            >
              <span className="leading-none">{dayNum}</span>
              {day.count > 0 ? (
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: moodDotColor(day.mood) }}
                  className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full"
                />
              ) : (
                <span aria-hidden="true" className="mt-0.5 h-1.5 w-1.5 shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
