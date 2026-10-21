import type { Consistency, HabitRow, TopStreak } from "../api";
import { FlameIcon } from "./icons";

const CARD = "flex flex-col justify-between gap-2 rounded-2xl border border-line bg-surface p-4 shadow-sm min-h-[110px]";

export function SummaryCards({
  todayDone,
  todayTotal,
  topStreak,
  consistency,
  habits,
}: Readonly<{
  todayDone: number;
  todayTotal: number;
  topStreak: TopStreak | null;
  consistency: Consistency;
  habits: readonly HabitRow[];
}>) {
  const scheduledHabits = habits.filter((h) => h.scheduledToday && !h.archived);
  const topStreakDays = topStreak?.days ?? 0;
  const topStreakName = topStreak?.name ?? "No streak yet";

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
      {/* Card 1: Today */}
      <section aria-label="Today's progress" className={CARD}>
        <span className="text-xs font-medium text-muted">Today</span>
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-[28px] font-semibold leading-none text-ink">{todayDone}</span>
          <span className="font-mono text-xs text-muted">/ {todayTotal} completed</span>
        </div>
        <div aria-hidden="true" className="flex gap-1 h-1.5 w-full items-center">
          {scheduledHabits.length === 0 ? (
            <span className="h-1.5 flex-1 rounded-full bg-line" />
          ) : (
            scheduledHabits.map((h) => (
              <span
                key={h.id}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  h.doneToday ? "bg-accent" : "bg-line"
                }`}
              />
            ))
          )}
        </div>
      </section>

      {/* Card 2: Longest active streak */}
      <section aria-label="Longest active streak" className={CARD}>
        <span className="text-xs font-medium text-muted">Longest active streak</span>
        <div className="flex items-baseline gap-2 text-accent">
          <FlameIcon />
          <span className="font-mono text-[28px] font-semibold leading-none text-ink">{topStreakDays}</span>
          <span className="text-xs text-muted">days</span>
        </div>
        <span className="truncate font-mono text-xs text-muted" title={topStreakName}>
          {topStreakName}
        </span>
      </section>

      {/* Card 3: 30-day consistency */}
      <section aria-label="30-day consistency" className={CARD}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted">30-day consistency</span>
          <span className="font-mono text-xs text-muted">
            {consistency.done}/{consistency.scheduled} days
          </span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-[28px] font-semibold leading-none text-ink">
            {consistency.percent}
          </span>
          <span className="font-mono text-sm text-muted">%</span>
        </div>
        <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, consistency.percent))}%` }}
          />
        </div>
      </section>
    </div>
  );
}
