import { describe, expect, test } from "bun:test";
import type { DayTask } from "../api";
import { reminderCount, reminders } from "./reminders";

const task = (id: string, overdue: boolean, completedAt: number | null = null): DayTask => ({
  id,
  title: id,
  dueAt: 0,
  completedAt,
  overdue,
});

describe("reminders", () => {
  test("splits open tasks into late and due today, skipping done ones", () => {
    const today = [task("late", true), task("late-done", true, 5), task("today", false), task("today-done", false, 5)];
    expect(reminders(today)).toEqual([
      { title: "Terlambat", tasks: [task("late", true)] },
      { title: "Hari ini", tasks: [task("today", false)] },
    ]);
    expect(reminderCount(today)).toBe(2);
  });

  test("empty groups are left out", () => {
    expect(reminders([task("today", false)]).map((g) => g.title)).toEqual(["Hari ini"]);
    expect(reminders([])).toEqual([]);
    expect(reminderCount([])).toBe(0);
  });
});
