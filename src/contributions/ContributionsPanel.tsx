import { useEffect, useState } from "react";
import { api, errorMessage, type Contributions } from "../api";
import { msToDateInput } from "../format";
import { LABEL } from "../shell/ui";
import { buildMonths, type Cell } from "./heatmap";

const LEVEL_BG = ["bg-heat-0", "bg-heat-1", "bg-heat-2", "bg-heat-3", "bg-heat-4"];

function cellClass(cell: Cell): string {
  if (cell.future) return "border border-[#2a303b]";
  return `${LEVEL_BG[cell.level]} ${cell.today ? "border border-ink" : ""}`;
}

function Arrow({ direction }: Readonly<{ direction: "left" | "right" }>) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

const NAV = "flex h-7 w-7 items-center justify-center rounded-lg text-ink transition-colors hover:bg-surface-2 disabled:text-disabled disabled:hover:bg-transparent";

/** Monthly GitHub heatmap with six months of history (DESIGN.md §3). */
export function ContributionsPanel({ version, onOpenSettings }: Readonly<{ version: number; onOpenSettings: () => void }>) {
  const [data, setData] = useState<Contributions | null>(null);
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    api.getContributions(false).then(setData, (e) =>
      setData({ connected: true, login: null, fetchedOn: null, days: [], error: errorMessage(e) }),
    );
  }, [version]);

  const heading = <h2 className={`m-0 text-[11px] font-medium ${LABEL}`}>Kontribusi kode</h2>;

  if (!data) {
    return <section aria-label="Kontribusi kode" className="flex flex-col gap-1 border-b border-line px-5 py-4">{heading}</section>;
  }
  if (!data.connected) {
    return (
      <section aria-label="Kontribusi kode" className="flex flex-col items-start gap-1 border-b border-line px-5 py-4">
        {heading}
        <button onClick={onOpenSettings} className="text-xs text-accent hover:text-accent-hover">
          Sambungkan GitHub di Pengaturan
        </button>
      </section>
    );
  }

  const months = buildMonths(data.days, msToDateInput(Date.now()));
  const current = index ?? months.length - 1;
  const month = months[current];
  let delta = { text: "awal riwayat", color: "text-muted" };
  if (current > 0) {
    const previous = months[current - 1].label.split(" ")[0];
    if (month.deltaPct === null) {
      // A percentage from zero means nothing; say the previous month was empty.
      delta = { text: `${previous}: 0 kontribusi`, color: "text-muted" };
    } else {
      delta = {
        text: `${month.deltaPct >= 0 ? "+" : "−"}${Math.abs(month.deltaPct)}% vs ${previous}`,
        color: month.deltaPct >= 0 ? "text-accent" : "text-danger",
      };
    }
  }

  return (
    <section aria-labelledby="kontribusi-judul" className="flex items-center gap-4 border-b border-line px-5 py-4">
      <span className="sr-only">{`Kontribusi ${month.fullLabel}: ${month.total} kontribusi`}</span>
      <div aria-hidden="true" className="grid shrink-0 grid-flow-col grid-rows-[repeat(7,10px)] auto-cols-[10px] gap-[3px]">
        {month.cells.map((cell, i) =>
          cell ? (
            <span
              key={cell.date}
              title={cell.future ? `${cell.day} ${month.label.split(" ")[0]}: belum lewat` : `${cell.day} ${month.label.split(" ")[0]}: ${cell.count} kontribusi`}
              className={`box-border h-2.5 w-2.5 rounded-[2px] ${cellClass(cell)}`}
            />
          ) : (
            <span key={`blank-${i}`} />
          ),
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h2 id="kontribusi-judul" className={`m-0 text-[11px] font-medium ${LABEL}`}>
            Kontribusi kode
          </h2>
          <div className="flex items-center gap-0.5">
            <button aria-label="Bulan sebelumnya" disabled={current === 0} onClick={() => setIndex(current - 1)} className={NAV}>
              <Arrow direction="left" />
            </button>
            <span aria-live="polite" className="min-w-[60px] text-center font-mono text-xs">
              {month.label}
            </span>
            <button
              aria-label="Bulan berikutnya"
              disabled={current === months.length - 1}
              onClick={() => setIndex(current + 1)}
              className={NAV}
            >
              <Arrow direction="right" />
            </button>
          </div>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-[22px] leading-tight font-medium">{month.total}</span>
          <span className="text-xs text-muted">kontribusi</span>
        </div>
        <div className="text-[11px] text-muted">
          <span className={delta.color}>{delta.text}</span> · streak {month.streak} hari
        </div>
        {data.error && <p className="m-0 truncate text-[11px] text-danger" title={data.error}>{data.error}</p>}
      </div>
    </section>
  );
}
