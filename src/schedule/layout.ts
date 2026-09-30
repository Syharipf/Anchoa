import type { ItemKind, ProjectDeadline, ScheduleItem } from "../api";

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

function parseDateUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

const MS_PER_DAY = 86_400_000;

export function diffDays(start: string, end: string): number {
  return Math.round((parseDateUtc(end) - parseDateUtc(start)) / MS_PER_DAY);
}

/** "2026-09-30" -> "30 Sep". */
export function shortDateStr(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
  });
}

/** 8-week timeline window starting on Monday of previous week from today + shiftWeeks * 7 days. */
export function timelineWindow(
  today: string,
  shiftWeeks = 0,
): { from: string; to: string; days: string[] } {
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dayOfWeek = (dt.getDay() + 6) % 7; // Monday = 0, ..., Sunday = 6
  const startOffset = -dayOfWeek - 7 + shiftWeeks * 7;
  const from = addDays(today, startOffset);
  const days: string[] = [];
  for (let i = 0; i < 56; i++) {
    days.push(addDays(from, i));
  }
  const to = days[55];
  return { from, to, days };
}

/** "2026-09-28" and "2026-11-22" -> "28 Sep – 22 Nov". */
export function timelineLabel(from: string, to: string): string {
  return `${shortDateStr(from)} – ${shortDateStr(to)}`;
}

/**
 * Calculates bar position and width in pixels (16px per day) clipped to window.
 * Returns null if the item is entirely outside the window.
 */
export function barFor(
  item: { startDate?: string; dueDate: string },
  window: { from: string; to: string },
): { left: number; width: number } | null {
  const rawStart = item.startDate ?? item.dueDate;
  const rawEnd = item.dueDate;
  const itemStart = rawStart <= rawEnd ? rawStart : rawEnd;
  const itemEnd = rawEnd >= rawStart ? rawEnd : rawStart;

  if (itemEnd < window.from || itemStart > window.to) {
    return null;
  }

  const clippedStart = itemStart < window.from ? window.from : itemStart;
  const clippedEnd = itemEnd > window.to ? window.to : itemEnd;

  const startIdx = diffDays(window.from, clippedStart);
  const endIdx = diffDays(window.from, clippedEnd);
  const dayCount = endIdx - startIdx + 1;

  return {
    left: startIdx * 16,
    width: dayCount * 16,
  };
}

export interface TimelineGroup {
  id: string;
  name: string;
  kind: ItemKind;
  items: ScheduleItem[];
  deadline?: string;
}

/**
 * Groups items for timeline view according to spec §4:
 * 1. Projects with deadline in range (sorted by deadline date)
 * 2. Projects without deadline (sorted by name)
 * 3. Personal group ("Pribadi")
 * 4. Bill group ("Tagihan")
 * Completed items are excluded (spec J7).
 */
export function timelineGroups(
  items: readonly ScheduleItem[],
  deadlines: readonly ProjectDeadline[] = [],
): TimelineGroup[] {
  const openItems = items.filter((it) => it.status !== "done");

  const deadlineMap = new Map<string, ProjectDeadline>();
  for (const dl of deadlines) {
    deadlineMap.set(dl.projectId, dl);
  }

  const projectMap = new Map<string, { name: string; items: ScheduleItem[] }>();
  for (const dl of deadlines) {
    projectMap.set(dl.projectId, { name: dl.name, items: [] });
  }
  for (const it of openItems) {
    if (it.kind === "project") {
      const entry = projectMap.get(it.groupId);
      if (entry) {
        entry.items.push(it);
      } else {
        projectMap.set(it.groupId, { name: it.groupName, items: [it] });
      }
    }
  }

  const projectGroups: TimelineGroup[] = [];
  for (const [id, data] of projectMap.entries()) {
    data.items.sort((a, b) => {
      const startA = a.startDate ?? a.dueDate;
      const startB = b.startDate ?? b.dueDate;
      return (
        startA.localeCompare(startB) ||
        a.dueDate.localeCompare(b.dueDate) ||
        a.title.localeCompare(b.title)
      );
    });

    const dl = deadlineMap.get(id);
    if (dl !== undefined || data.items.length > 0) {
      projectGroups.push({
        id,
        name: data.name,
        kind: "project",
        items: data.items,
        deadline: dl?.date,
      });
    }
  }

  projectGroups.sort((a, b) => {
    if (a.deadline && b.deadline) {
      return a.deadline.localeCompare(b.deadline) || a.name.localeCompare(b.name);
    }
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return a.name.localeCompare(b.name);
  });

  const personalItems = openItems
    .filter((it) => it.kind === "personal")
    .sort((a, b) => {
      const startA = a.startDate ?? a.dueDate;
      const startB = b.startDate ?? b.dueDate;
      return (
        startA.localeCompare(startB) ||
        a.dueDate.localeCompare(b.dueDate) ||
        a.title.localeCompare(b.title)
      );
    });

  const billItems = openItems
    .filter((it) => it.kind === "bill")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title));

  const result: TimelineGroup[] = [...projectGroups];
  if (personalItems.length > 0) {
    result.push({
      id: "personal",
      name: "Pribadi",
      kind: "personal",
      items: personalItems,
    });
  }
  if (billItems.length > 0) {
    result.push({
      id: "bills",
      name: "Tagihan",
      kind: "bill",
      items: billItems,
    });
  }

  return result;
}
