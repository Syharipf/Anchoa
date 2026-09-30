import type { BillView, DayTask, FinanceSummary } from "../api";
import { shortDate } from "../format";
import { formatRupiah } from "../money";

export type Reminder =
  | { kind: "task"; id: string; task: DayTask }
  | { kind: "bill"; id: string; bill: BillView }
  | { kind: "budget"; id: string; percent: number; over: boolean };

export interface ReminderGroup {
  title: "Terlambat" | "Hari ini";
  items: Reminder[];
}

export type Tone = "danger" | "warn" | "muted";

const fromTask = (task: DayTask): Reminder => ({ kind: "task", id: task.id, task });
const fromBill = (bill: BillView): Reminder => ({ kind: "bill", id: bill.id, bill });

/** The monthly limit, once 80% of it is spent. */
function limitReminder(finance: FinanceSummary | null): Reminder[] {
  const budget = finance?.budget;
  if (!finance || !budget || budget.level === "ok") return [];
  const percent = Math.round((finance.expense * 100) / budget.amount);
  return [{ kind: "budget", id: "budget", percent, over: budget.level === "over" }];
}

/**
 * Notification panel content until modules store their own notifications (spec UI lanjutan U6,
 * Fase 2 §5): open tasks and bills that are late or due today, then the monthly limit.
 */
export function reminders(today: DayTask[], finance: FinanceSummary | null): ReminderGroup[] {
  const open = today.filter((t) => t.completedAt === null);
  const bills = finance?.dueBills ?? [];
  const groups: ReminderGroup[] = [
    {
      title: "Terlambat",
      items: [...open.filter((t) => t.overdue).map(fromTask), ...bills.filter((b) => b.status === "overdue").map(fromBill)],
    },
    {
      title: "Hari ini",
      items: [
        ...open.filter((t) => !t.overdue).map(fromTask),
        ...bills.filter((b) => b.status === "dueToday").map(fromBill),
        ...limitReminder(finance),
      ],
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

export function reminderCount(today: DayTask[], finance: FinanceSummary | null): number {
  return reminders(today, finance).reduce((n, g) => n + g.items.length, 0);
}

/** Title and detail line of one reminder card. */
export function reminderText(r: Reminder): { title: string; detail: string; tone: Tone } {
  if (r.kind === "task") {
    const title = r.task.title || "Tanpa judul";
    return r.task.overdue
      ? { title, detail: `Terlambat · jatuh tempo ${shortDate(r.task.dueAt)}`, tone: "danger" }
      : { title, detail: "Jatuh tempo hari ini", tone: "muted" };
  }
  if (r.kind === "bill") {
    const late = r.bill.status === "overdue";
    const when = late ? `Terlambat ${r.bill.daysLate} hari` : "Jatuh tempo hari ini";
    return { title: r.bill.name, detail: `${when} · ${formatRupiah(r.bill.amount)}`, tone: late ? "danger" : "muted" };
  }
  return { title: "Batas pengeluaran", detail: `Pengeluaran ${r.percent}% dari batas`, tone: r.over ? "danger" : "warn" };
}
