import type { DayTask } from "../api";

/** One line under the greeting, e.g. "3 tasks today · 1 overdue · 1 overdue bill · 2 entries in Journal". */
export function summaryLine(today: DayTask[], journalCount: number, lateBills: number): string {
  const open = today.filter((t) => t.completedAt === null);
  const late = open.filter((t) => t.overdue).length;
  const parts = [
    open.length === 0
      ? "No tasks left today"
      : `${open.length} ${open.length === 1 ? "task" : "tasks"} today`,
  ];
  if (late > 0) parts.push(`${late} overdue`);
  if (lateBills > 0) parts.push(`${lateBills} overdue ${lateBills === 1 ? "bill" : "bills"}`);
  parts.push(
    journalCount === 0
      ? "Journal is empty"
      : `${journalCount} ${journalCount === 1 ? "entry" : "entries"} in Journal`,
  );
  return parts.join(" · ");
}
