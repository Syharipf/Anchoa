import type { DayTask } from "../api";

/** One line under the greeting, e.g. "3 tugas hari ini · 1 terlambat · 2 catatan di Inbox". */
export function summaryLine(today: DayTask[], inboxCount: number): string {
  const open = today.filter((t) => t.completedAt === null);
  const late = open.filter((t) => t.overdue).length;
  const parts = [open.length === 0 ? "Tidak ada tugas tersisa hari ini" : `${open.length} tugas hari ini`];
  if (late > 0) parts.push(`${late} terlambat`);
  parts.push(inboxCount === 0 ? "Inbox kosong" : `${inboxCount} catatan di Inbox`);
  return parts.join(" · ");
}
