import type { BillView, DayTask, FinanceSummary, HabitReminder, NotifyPrefs } from "../api";
import { shortDate } from "../format";
import { formatRupiah } from "../money";

export type Reminder =
  | { kind: "task"; id: string; task: DayTask }
  | { kind: "bill"; id: string; bill: BillView }
  | { kind: "budget"; id: string; percent: number; over: boolean }
  | { kind: "habit"; id: string; habit: HabitReminder }
  | { kind: "journal"; id: "journal" };

export interface ReminderGroup {
  title: "Terlambat" | "Hari ini";
  items: Reminder[];
}

export type Tone = "danger" | "warn" | "muted";

const fromTask = (task: DayTask): Reminder => ({ kind: "task", id: task.id, task });
const fromBill = (bill: BillView): Reminder => ({ kind: "bill", id: bill.id, bill });
const fromHabit = (habit: HabitReminder): Reminder => ({ kind: "habit", id: habit.id, habit });

/** The monthly limit, once 80% of it is spent. */
function limitReminder(finance: FinanceSummary | null): Reminder[] {
  const budget = finance?.budget;
  if (!finance || !budget || budget.level === "ok") return [];
  const percent = Math.round((finance.expense * 100) / budget.amount);
  return [{ kind: "budget", id: "budget", percent, over: budget.level === "over" }];
}

const DEFAULT_PREFS: NotifyPrefs = {
  task: true,
  bill: true,
  budget: true,
  habit: true,
  journal: false,
  journalAt: "20:00",
};

/**
 * Notification panel content until modules store their own notifications (spec UI lanjutan U6,
 * Fase 2 §5): open tasks and bills that are late or due today, then the monthly limit.
 */
export function reminders(
  today: DayTask[],
  finance: FinanceSummary | null,
  habitReminders: HabitReminder[] = [],
  prefs?: NotifyPrefs,
  journalReminder?: boolean,
): ReminderGroup[] {
  const p = prefs ?? DEFAULT_PREFS;
  const open = p.task ? today.filter((t) => t.completedAt === null) : [];
  const bills = p.bill ? (finance?.dueBills ?? []) : [];
  const habits = p.habit ? habitReminders : [];
  const budgets = p.budget ? limitReminder(finance) : [];
  const journals: Reminder[] = p.journal && journalReminder ? [{ kind: "journal", id: "journal" }] : [];

  const groups: ReminderGroup[] = [
    {
      title: "Terlambat",
      items: [
        ...open.filter((t) => t.overdue).map(fromTask),
        ...bills.filter((b) => b.status === "overdue").map(fromBill),
      ],
    },
    {
      title: "Hari ini",
      items: [
        ...open.filter((t) => !t.overdue).map(fromTask),
        ...bills.filter((b) => b.status === "dueToday").map(fromBill),
        ...habits.map(fromHabit),
        ...budgets,
        ...journals,
      ],
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

export function reminderCount(
  today: DayTask[],
  finance: FinanceSummary | null,
  habitReminders: HabitReminder[] = [],
  prefs?: NotifyPrefs,
  journalReminder?: boolean,
): number {
  return reminders(today, finance, habitReminders, prefs, journalReminder).reduce((n, g) => n + g.items.length, 0);
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
  if (r.kind === "habit") {
    const time = r.habit.remindAt.replace(":", ".");
    return {
      title: r.habit.name,
      detail: `Belum dicentang · pengingat ${time}`,
      tone: "muted",
    };
  }
  if (r.kind === "journal") {
    return {
      title: "Jurnal harian",
      detail: "Belum menulis jurnal hari ini",
      tone: "muted",
    };
  }
  return { title: "Batas pengeluaran", detail: `Pengeluaran ${r.percent}% dari batas`, tone: r.over ? "danger" : "warn" };
}
