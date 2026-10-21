import { describe, expect, test } from "bun:test";
import type { DayTask } from "../api";
import { summaryLine } from "./summary";

const task = (overdue: boolean, completedAt: number | null = null): DayTask => ({
  id: String(overdue),
  title: "t",
  dueAt: 0,
  completedAt,
  overdue,
});

describe("summaryLine", () => {
  test("counts open tasks, late ones and Journal entries", () => {
    expect(summaryLine([task(true), task(false), task(false), task(false, 9)], 2, 0)).toBe(
      "3 tasks today · 1 overdue · 2 entries in Journal",
    );
  });

  test("quiet day", () => {
    expect(summaryLine([task(false, 9)], 0, 0)).toBe("No tasks left today · Journal is empty");
  });

  test("late bills sit after late tasks", () => {
    expect(summaryLine([task(true), task(false)], 2, 1)).toBe(
      "2 tasks today · 1 overdue · 1 overdue bill · 2 entries in Journal",
    );
  });
});
