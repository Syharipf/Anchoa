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
  test("counts open tasks, late ones and Inbox notes", () => {
    expect(summaryLine([task(true), task(false), task(false), task(false, 9)], 2, 0)).toBe(
      "3 tugas hari ini · 1 terlambat · 2 catatan di Inbox",
    );
  });

  test("quiet day", () => {
    expect(summaryLine([task(false, 9)], 0, 0)).toBe("Tidak ada tugas tersisa hari ini · Inbox kosong");
  });

  test("late bills sit after late tasks", () => {
    expect(summaryLine([task(true), task(false)], 2, 1)).toBe(
      "2 tugas hari ini · 1 terlambat · 1 tagihan terlambat · 2 catatan di Inbox",
    );
  });
});
