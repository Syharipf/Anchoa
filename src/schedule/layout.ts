import type { ItemKind, ScheduleItem } from "../api";

export { addMonths, monthLabel } from "../money";

export const KIND_COLORS: Readonly<Record<ItemKind, string>> = {
  project: "#3987e5",
  bill: "#c98500",
  personal: "#d55181",
};

export const KIND_LABELS: Readonly<Record<ItemKind, string>> = {
  project: "Proyek",
  bill: "Tagihan",
  personal: "Pribadi",
};

export const ALL_KINDS: readonly ItemKind[] = ["project", "bill", "personal"];

export interface MonthCell {
  date: string;
  inMonth: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Add (or subtract) days from a "YYYY-MM-DD" local date string. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(y, m - 1, d + days);
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
}

/**
 * Monday-first month grid with 4, 5, or 6 rows of 7 cells each.
 * Leading and trailing days complete each week.
 */
export function monthGrid(month: string): MonthCell[][] {
  const [year, mon] = month.split("-").map(Number);
  const firstDay = new Date(year, mon - 1, 1);
  const dayOfWeek = firstDay.getDay(); // 0 = Sunday, 1 = Monday, ...
  const lead = (dayOfWeek + 6) % 7;
  const daysInMonth = new Date(year, mon, 0).getDate();
  const totalDays = lead + daysInMonth;
  const rowCount = Math.ceil(totalDays / 7);

  const grid: MonthCell[][] = [];
  for (let r = 0; r < rowCount; r++) {
    const row: MonthCell[] = [];
    for (let c = 0; c < 7; c++) {
      const dayIndex = r * 7 + c;
      const dayNum = 1 - lead + dayIndex;
      const d = new Date(year, mon - 1, dayNum);
      const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const inMonth = d.getMonth() === mon - 1 && d.getFullYear() === year;
      row.push({ date: dateStr, inMonth });
    }
    grid.push(row);
  }
  return grid;
}

/** Returns up to 3 chips (or 2 when 6 rows) for a date cell, plus the remaining count. */
export function chipsFor(
  items: readonly ScheduleItem[],
  date: string,
  rows: number,
): { shown: ScheduleItem[]; more: number } {
  const matching = items.filter((it) => it.dueDate === date);
  const max = rows <= 5 ? 3 : 2;
  if (matching.length <= max) {
    return { shown: matching, more: 0 };
  }
  return {
    shown: matching.slice(0, max),
    more: matching.length - max,
  };
}

/**
 * Resolves the selected date when navigating to targetMonth:
 * today if targetMonth contains today, else the 1st of that month.
 */
export function navSelectedDate(targetMonth: string, today: string): string {
  if (today?.startsWith(targetMonth)) {
    return today;
  }
  return `${targetMonth}-01`;
}

/** Whether a schedule item is a bill that has been paid. */
export function isBillDone(item: ScheduleItem): boolean {
  return item.source === "bill" && item.status === "done";
}

/**
 * Groups items for the agenda panel:
 * - `late`: overdue items, excluding items whose due date is the selected date.
 * - `due`: items due on the selected date.
 * - `next`: items due in the 7 days after the selected date.
 */
export function agendaGroups(
  items: readonly ScheduleItem[],
  selected: string,
  today: string,
): { late: ScheduleItem[]; due: ScheduleItem[]; next: ScheduleItem[] } {
  const late = items.filter(
    (it) =>
      (it.overdue || (Boolean(today) && it.dueDate < today && it.status !== "done")) &&
      it.dueDate !== selected,
  );
  const due = items.filter((it) => it.dueDate === selected);
  const startNext = addDays(selected, 1);
  const endNext = addDays(selected, 7);
  const next = items.filter((it) => it.dueDate >= startNext && it.dueDate <= endNext);

  return { late, due, next };
}

/** Filter items by toggled item kinds. */
export function visible(
  items: readonly ScheduleItem[],
  off: ReadonlySet<ItemKind>,
): ScheduleItem[] {
  return items.filter((it) => !off.has(it.kind));
}

/** "2026-09-30" -> "Rabu, 30 September". */
export function agendaTitle(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}
