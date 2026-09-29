export type Level = 0 | 1 | 2 | 3 | 4;

export interface Cell {
  date: string;
  day: number;
  count: number;
  level: Level;
  today: boolean;
  future: boolean;
}

export interface MonthView {
  /** "2026-09" */
  key: string;
  /** "Sep 2026" */
  label: string;
  /** "September 2026" */
  fullLabel: string;
  /** Column-major Mon–Sun weeks; null pads the first and last week. */
  cells: (Cell | null)[];
  total: number;
  /** Longest run of days with at least one contribution. */
  streak: number;
  /** Change in total vs the previous month, or null when it had none. */
  deltaPct: number | null;
}

/** DESIGN.md: 0 → L0, 1–3 → L1, 4–6 → L2, 7–9 → L3, ≥10 → L4. */
export function level(count: number): Level {
  if (count === 0) return 0;
  if (count <= 3) return 1;
  if (count <= 6) return 2;
  if (count <= 9) return 3;
  return 4;
}

const pad = (n: number) => String(n).padStart(2, "0");

function monthView(year: number, month: number, counts: Map<string, number>, today: string): Omit<MonthView, "deltaPct"> {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Cell | null)[] = Array((first.getDay() + 6) % 7).fill(null);
  let total = 0;
  let run = 0;
  let streak = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${pad(month + 1)}-${pad(day)}`;
    const future = date > today;
    const count = future ? 0 : (counts.get(date) ?? 0);
    cells.push({ date, day, count, level: level(count), today: date === today, future });
    if (future) continue;
    total += count;
    run = count > 0 ? run + 1 : 0;
    streak = Math.max(streak, run);
  }
  while (cells.length % 7) cells.push(null);
  return {
    key: `${year}-${pad(month + 1)}`,
    label: first.toLocaleDateString("id-ID", { month: "short", year: "numeric" }),
    fullLabel: first.toLocaleDateString("id-ID", { month: "long", year: "numeric" }),
    cells,
    total,
    streak,
  };
}

/** The `count` months ending with the month of `today` ("YYYY-MM-DD"), oldest first. */
export function buildMonths(days: { date: string; count: number }[], today: string, count = 6): MonthView[] {
  const counts = new Map(days.map((d) => [d.date, d.count]));
  const [year, month] = today.split("-").map(Number);
  const months: MonthView[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const start = new Date(year, month - 1 - back, 1);
    const view = monthView(start.getFullYear(), start.getMonth(), counts, today);
    const previous = months[months.length - 1];
    const deltaPct = previous && previous.total > 0 ? Math.round(((view.total - previous.total) / previous.total) * 100) : null;
    months.push({ ...view, deltaPct });
  }
  return months;
}
