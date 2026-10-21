import type { HealthDayRow } from "../api";
import { formatValue } from "./view";

export interface HealthHistoryProps {
  history: HealthDayRow[];
  todayDate?: string;
}

function formatDate(isoDate: string): string {
  // isoDate is YYYY-MM-DD
  const parts = isoDate.split("-");
  if (parts.length === 3) {
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    if (m >= 0 && m < 12) {
      return `${months[m]} ${d}`;
    }
  }
  return isoDate;
}

export function HealthHistory({ history, todayDate }: Readonly<HealthHistoryProps>) {
  const loggedCount = history.filter(
    (row) =>
      row.weightG !== null ||
      row.sleepMin !== null ||
      row.steps !== null ||
      row.restingHr !== null,
  ).length;

  return (
    <section
      aria-labelledby="hl-history"
      className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden rounded-[14px] border border-line bg-surface p-3.5 px-4"
    >
      <div className="flex items-baseline gap-2.5">
        <h2
          id="hl-history"
          className="m-0 font-display text-[15px] font-semibold text-ink"
        >
          Last 14 days
        </h2>
        <span className="text-[11px] text-muted">
          Weight · sleep · steps · resting HR
        </span>
      </div>

      <div className="grid grid-cols-[54px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_42px] gap-1.5 border-b border-line px-2 pb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
        <span>Date</span>
        <span className="text-right">Weight</span>
        <span className="text-right">Sleep</span>
        <span className="text-right">Steps</span>
        <span className="text-right">RHR</span>
      </div>

      <div
        role="list"
        aria-label="Daily metrics"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {history.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-8 text-xs text-muted">
            No data yet
          </div>
        ) : (
          history.map((row) => {
            const isToday = todayDate ? row.date === todayDate : false;
            return (
              <div
                key={row.date}
                role="listitem"
                data-row
                className={`grid grid-cols-[54px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_42px] items-center gap-1.5 rounded-[7px] px-2 py-1 font-mono text-[11.5px] transition-colors hover:bg-surface-2 ${
                  isToday ? "bg-surface-2 text-ink font-medium" : "text-muted"
                }`}
              >
                <span className="text-muted">{formatDate(row.date)}</span>
                <span className="text-right">{formatValue("weight_g", row.weightG)}</span>
                <span className="text-right">{formatValue("sleep_min", row.sleepMin)}</span>
                <span className="text-right">{formatValue("steps", row.steps)}</span>
                <span className="text-right">{formatValue("resting_hr", row.restingHr)}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line pt-1 text-[11px] text-muted">
        <span>Logged {loggedCount} of {history.length || 14} days</span>
        <span className="flex-1" />
        <button
          type="button"
          disabled
          aria-label="Export CSV, coming later"
          title="Coming later"
          className="h-7 rounded-[8px] border border-line bg-transparent px-2.5 font-sans text-[11.5px] text-muted opacity-50 cursor-not-allowed"
        >
          Export CSV
        </button>
      </div>
    </section>
  );
}
