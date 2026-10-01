import { describe, expect, test } from "bun:test";
import type { BillView, DayTask, FinanceSummary } from "../api";
import { reminderCount, reminders, reminderText } from "./reminders";

const task = (id: string, overdue: boolean, completedAt: number | null = null): DayTask => ({
  id,
  title: id,
  dueAt: 0,
  completedAt,
  overdue,
});

const bill = (id: string, status: BillView["status"]): BillView => ({
  id,
  name: id,
  amount: 150000,
  accountId: "a",
  accountName: "BCA",
  repeat: "monthly",
  dueAt: 0,
  status,
  daysLate: status === "overdue" ? 2 : 0,
});

const finance = (dueBills: BillView[], budget: FinanceSummary["budget"] = null, expense = 0): FinanceSummary => ({
  hasAccounts: true,
  balance: 0,
  expense,
  budget,
  dueBills,
});

const ids = (groups: ReturnType<typeof reminders>) => groups.map((g) => [g.title, g.items.map((r) => r.id)]);

describe("reminders", () => {
  test("splits open tasks into late and due today, skipping done ones", () => {
    const today = [task("late", true), task("late-done", true, 5), task("today", false), task("today-done", false, 5)];
    expect(ids(reminders(today, null))).toEqual([
      ["Terlambat", ["late"]],
      ["Hari ini", ["today"]],
    ]);
    expect(reminderCount(today, null)).toBe(2);
  });

  test("empty groups are left out", () => {
    expect(reminders([task("today", false)], null).map((g) => g.title)).toEqual(["Hari ini"]);
    expect(reminders([], null)).toEqual([]);
    expect(reminderCount([], finance([]))).toBe(0);
  });

  test("bills join the tasks by status", () => {
    const groups = reminders([task("late", true)], finance([bill("listrik", "overdue"), bill("air", "dueToday")]));
    expect(ids(groups)).toEqual([
      ["Terlambat", ["late", "listrik"]],
      ["Hari ini", ["air"]],
    ]);
  });

  test("the monthly limit shows from 80%", () => {
    expect(ids(reminders([], finance([], { amount: 200000, level: "warn" }, 175000)))).toEqual([["Hari ini", ["budget"]]]);
    expect(reminders([], finance([], { amount: 200000, level: "ok" }, 100000))).toEqual([]);
    const [group] = reminders([], finance([], { amount: 200000, level: "over" }, 250000));
    expect(group.items[0]).toEqual({ kind: "budget", id: "budget", percent: 125, over: true });
  });
});

describe("reminderText", () => {
  test("describes tasks, bills and the limit", () => {
    expect(reminderText({ kind: "task", id: "a", task: task("Bayar kos", false) })).toEqual({
      title: "Bayar kos",
      detail: "Jatuh tempo hari ini",
      tone: "muted",
    });
    expect(reminderText({ kind: "bill", id: "l", bill: bill("Listrik", "overdue") })).toEqual({
      title: "Listrik",
      detail: "Terlambat 2 hari · Rp 150.000",
      tone: "danger",
    });
    expect(reminderText({ kind: "budget", id: "budget", percent: 88, over: false })).toEqual({
      title: "Batas pengeluaran",
      detail: "Pengeluaran 88% dari batas",
      tone: "warn",
    });
    expect(
      reminderText({
        kind: "habit",
        id: "h1",
        habit: { id: "h1", name: "Olahraga pagi", remindAt: "06:30" },
      }),
    ).toEqual({
      title: "Olahraga pagi",
      detail: "Belum dicentang · pengingat 06.30",
      tone: "muted",
    });
  });

  test("habit reminders appear in Hari ini group", () => {
    const habitReminders = [{ id: "h1", name: "Olahraga pagi", remindAt: "06:30" }];
    const groups = reminders([], null, habitReminders);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Hari ini");
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0]).toEqual({
      kind: "habit",
      id: "h1",
      habit: habitReminders[0],
    });
    expect(reminderCount([], null, habitReminders)).toBe(1);
  });
});

describe("reminders with NotifyPrefs", () => {
  const today = [task("t-late", true), task("t-today", false)];
  const fin = finance([bill("b-late", "overdue"), bill("b-today", "dueToday")], { amount: 100000, level: "warn" }, 90000);
  const habits = [{ id: "h1", name: "Baca", remindAt: "07:00" }];
  const allOn = { task: true, bill: true, budget: true, habit: true };

  test("all enabled includes every kind", () => {
    const groups = reminders(today, fin, habits, allOn);
    expect(ids(groups)).toEqual([
      ["Terlambat", ["t-late", "b-late"]],
      ["Hari ini", ["t-today", "b-today", "h1", "budget"]],
    ]);
    expect(reminderCount(today, fin, habits, allOn)).toBe(6);
  });

  test("dropping task reminders removes late and today tasks", () => {
    const prefs = { ...allOn, task: false };
    const groups = reminders(today, fin, habits, prefs);
    expect(ids(groups)).toEqual([
      ["Terlambat", ["b-late"]],
      ["Hari ini", ["b-today", "h1", "budget"]],
    ]);
    expect(reminderCount(today, fin, habits, prefs)).toBe(4);
  });

  test("dropping bill reminders removes late and due bills", () => {
    const prefs = { ...allOn, bill: false };
    const groups = reminders(today, fin, habits, prefs);
    expect(ids(groups)).toEqual([
      ["Terlambat", ["t-late"]],
      ["Hari ini", ["t-today", "h1", "budget"]],
    ]);
    expect(reminderCount(today, fin, habits, prefs)).toBe(4);
  });

  test("dropping budget reminders removes budget warning", () => {
    const prefs = { ...allOn, budget: false };
    const groups = reminders(today, fin, habits, prefs);
    expect(ids(groups)).toEqual([
      ["Terlambat", ["t-late", "b-late"]],
      ["Hari ini", ["t-today", "b-today", "h1"]],
    ]);
    expect(reminderCount(today, fin, habits, prefs)).toBe(5);
  });

  test("dropping habit reminders removes habits from Hari ini", () => {
    const prefs = { ...allOn, habit: false };
    const groups = reminders(today, fin, habits, prefs);
    expect(ids(groups)).toEqual([
      ["Terlambat", ["t-late", "b-late"]],
      ["Hari ini", ["t-today", "b-today", "budget"]],
    ]);
    expect(reminderCount(today, fin, habits, prefs)).toBe(5);
  });

  test("disabling everything leaves empty groups and zero count", () => {
    const none = { task: false, bill: false, budget: false, habit: false };
    expect(reminders(today, fin, habits, none)).toEqual([]);
    expect(reminderCount(today, fin, habits, none)).toBe(0);
  });
});

