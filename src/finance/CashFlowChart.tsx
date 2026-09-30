import type { MonthFlow } from "../api";
import { formatRupiah, monthLabel, monthShort } from "../money";
import { H2, PANEL } from "../shell/ui";

const BAR_MAX = 104;

/** Pixel height of a bar: at least 3px when there is money, 2px when there is none. */
function barHeight(value: number, max: number): number {
  return value > 0 ? Math.max(3, Math.round((value / max) * BAR_MAX)) : 2;
}

/** "Arus kas 6 bulan": CSS bars, one button per month; picking one changes the page's month. */
export function CashFlowChart({
  chart,
  month,
  onPick,
}: Readonly<{ chart: MonthFlow[]; month: string; onPick: (month: string) => void }>) {
  const max = Math.max(1, ...chart.flatMap((m) => [m.income, m.expense]));
  return (
    <section aria-labelledby="arus-judul" className={`${PANEL} flex flex-col gap-3`}>
      <div className="flex items-center justify-between">
        <h2 id="arus-judul" className={H2}>
          Arus kas 6 bulan
        </h2>
        <div aria-hidden="true" className="flex gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-accent" />
            Masuk
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-danger" />
            Keluar
          </span>
        </div>
      </div>
      <div className="flex h-[120px] items-end gap-2">
        {chart.map((m) => {
          const on = m.month === month;
          const label = `${monthLabel(m.month)}: masuk ${formatRupiah(m.income)}, keluar ${formatRupiah(m.expense)}`;
          return (
            <button
              key={m.month}
              onClick={() => onPick(m.month)}
              aria-pressed={on}
              aria-label={label}
              title={label}
              className={`flex h-full flex-1 items-end justify-center gap-1 rounded-lg pb-1 transition-colors ${
                on ? "bg-surface-2" : "hover:bg-surface-2"
              }`}
            >
              <span
                className={`w-3 rounded-sm ${m.income > 0 ? "bg-accent" : "bg-disabled"}`}
                style={{ height: barHeight(m.income, max), opacity: on ? 1 : 0.4 }}
              />
              <span
                className={`w-3 rounded-sm ${m.expense > 0 ? "bg-danger" : "bg-disabled"}`}
                style={{ height: barHeight(m.expense, max), opacity: on ? 1 : 0.4 }}
              />
            </button>
          );
        })}
      </div>
      <div aria-hidden="true" className="flex gap-2">
        {chart.map((m) => (
          <span
            key={m.month}
            className={`flex-1 text-center text-xs ${m.month === month ? "font-semibold text-ink" : "text-muted"}`}
          >
            {monthShort(m.month)}
          </span>
        ))}
      </div>
    </section>
  );
}
