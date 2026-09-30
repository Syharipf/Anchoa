import { describe, expect, it } from "bun:test";
import type { ItemKind, ScheduleItem } from "../api";
import {
  agendaGroups,
  agendaTitle,
  chipsFor,
  isBillDone,
  monthGrid,
  navSelectedDate,
  visible,
} from "./layout";

function makeItem(partial: Partial<ScheduleItem> & { id: string; dueDate: string }): ScheduleItem {
  return {
    key: `task:${partial.id}`,
    source: "task",
    kind: "project",
    title: `Task ${partial.id}`,
    groupId: "proj-1",
    groupName: "Project 1",
    status: "plan",
    overdue: false,
    checkable: true,
    ...partial,
  };
}

describe("schedule layout", () => {
  it("September 2026 dimulai Senin 31 Agustus dan punya 5 baris", () => {
    const grid = monthGrid("2026-09");
    expect(grid).toHaveLength(5);
    // Each row has 7 days (Monday to Sunday)
    for (const row of grid) {
      expect(row).toHaveLength(7);
    }
    // First cell is Monday 31 August (outside month)
    expect(grid[0][0]).toEqual({ date: "2026-08-31", inMonth: false });
    // Second cell is Tuesday 1 September (in month)
    expect(grid[0][1]).toEqual({ date: "2026-09-01", inMonth: true });
    // Last row ends with 4 October (outside month)
    expect(grid[4][6]).toEqual({ date: "2026-10-04", inMonth: false });
  });

  it("November 2026 punya 6 baris", () => {
    const grid = monthGrid("2026-11");
    expect(grid).toHaveLength(6);
    // 2026-11-01 is a Sunday, so the first week starts on Monday 2026-10-26
    expect(grid[0][0]).toEqual({ date: "2026-10-26", inMonth: false });
    expect(grid[0][6]).toEqual({ date: "2026-11-01", inMonth: true });
    // The last week contains 2026-11-30 and ends on 2026-12-06
    expect(grid[5][0]).toEqual({ date: "2026-11-30", inMonth: true });
    expect(grid[5][6]).toEqual({ date: "2026-12-06", inMonth: false });
  });

  it("Februari 2027 dimulai Senin dan punya 4 baris", () => {
    const grid = monthGrid("2027-02");
    expect(grid).toHaveLength(4);
    for (const row of grid) {
      expect(row).toHaveLength(7);
    }
    // All 28 days are in Feb 2027, starting Monday 2027-02-01 and ending Sunday 2027-02-28
    expect(grid[0][0]).toEqual({ date: "2027-02-01", inMonth: true });
    expect(grid[3][6]).toEqual({ date: "2027-02-28", inMonth: true });
  });

  it("chipsFor memberi more yang benar", () => {
    const items = [
      makeItem({ id: "1", dueDate: "2026-09-30" }),
      makeItem({ id: "2", dueDate: "2026-09-30" }),
      makeItem({ id: "3", dueDate: "2026-09-30" }),
      makeItem({ id: "4", dueDate: "2026-09-30" }),
      makeItem({ id: "5", dueDate: "2026-10-01" }),
    ];

    // When rows <= 5 (e.g. 4 or 5), max chips is 3
    const res4 = chipsFor(items, "2026-09-30", 4);
    expect(res4.shown).toHaveLength(3);
    expect(res4.more).toBe(1);

    const res5 = chipsFor(items, "2026-09-30", 5);
    expect(res5.shown).toHaveLength(3);
    expect(res5.more).toBe(1);

    // When rows === 6, max chips is 2
    const res6 = chipsFor(items, "2026-09-30", 6);
    expect(res6.shown).toHaveLength(2);
    expect(res6.more).toBe(2);

    // Date with fewer items
    const resFew = chipsFor(items, "2026-10-01", 5);
    expect(resFew.shown).toHaveLength(1);
    expect(resFew.more).toBe(0);

    // Date with 0 items
    const resZero = chipsFor(items, "2026-10-02", 5);
    expect(resZero.shown).toHaveLength(0);
    expect(resZero.more).toBe(0);
  });

  it("setiap grup agenda", () => {
    const today = "2026-09-30";
    const selected = "2026-09-30";
    const items = [
      // Overdue item, due before selected
      makeItem({ id: "late-1", dueDate: "2026-09-28", overdue: true }),
      // Item due on selected date (not overdue)
      makeItem({ id: "due-1", dueDate: "2026-09-30" }),
      // Overdue item due on selected date (e.g. if selected is in the past) -> should be in due, not in late
      // Item in next 7 days (2026-10-01 to 2026-10-07)
      makeItem({ id: "next-1", dueDate: "2026-10-01" }),
      makeItem({ id: "next-7", dueDate: "2026-10-07" }),
      // Item beyond 7 days
      makeItem({ id: "far-1", dueDate: "2026-10-08" }),
    ];

    const groups = agendaGroups(items, selected, today);
    expect(groups.late.map((i) => i.id)).toEqual(["late-1"]);
    expect(groups.due.map((i) => i.id)).toEqual(["due-1"]);
    expect(groups.next.map((i) => i.id)).toEqual(["next-1", "next-7"]);

    // If selected date is yesterday (2026-09-29) and an item was due yesterday and is overdue:
    const pastItems = [
      makeItem({ id: "late-old", dueDate: "2026-09-27", overdue: true }),
      makeItem({ id: "due-yesterday", dueDate: "2026-09-29", overdue: true }),
    ];
    const pastGroups = agendaGroups(pastItems, "2026-09-29", today);
    // Item due on selected date is in due, not late!
    expect(pastGroups.due.map((i) => i.id)).toEqual(["due-yesterday"]);
    expect(pastGroups.late.map((i) => i.id)).toEqual(["late-old"]);
  });

  it("filter visible", () => {
    const items = [
      makeItem({ id: "p1", kind: "project", dueDate: "2026-09-30" }),
      makeItem({ id: "b1", kind: "bill", dueDate: "2026-09-30" }),
      makeItem({ id: "u1", kind: "personal", dueDate: "2026-09-30" }),
    ];

    const off = new Set<ItemKind>(["bill"]);
    const vis = visible(items, off);
    expect(vis.map((i) => i.id)).toEqual(["p1", "u1"]);

    const offAll = new Set<ItemKind>(["project", "bill", "personal"]);
    expect(visible(items, offAll)).toEqual([]);

    const offNone = new Set<ItemKind>();
    expect(visible(items, offNone)).toHaveLength(3);
  });

  it("agendaTitle formats correctly", () => {
    expect(agendaTitle("2026-09-30")).toBe("Rabu, 30 September");
    expect(agendaTitle("2026-09-29")).toBe("Selasa, 29 September");
    expect(agendaTitle("2026-10-01")).toBe("Kamis, 1 Oktober");
  });

  it("navSelectedDate memindahkan selectedDate ke tanggal yang sesuai", () => {
    const today = "2026-09-30";
    // Target month contains today -> returns today
    expect(navSelectedDate("2026-09", today)).toBe("2026-09-30");

    // Target month is previous month (does not contain today) -> returns 1st
    expect(navSelectedDate("2026-08", today)).toBe("2026-08-01");

    // Target month is next month (does not contain today) -> returns 1st
    expect(navSelectedDate("2026-10", today)).toBe("2026-10-01");
  });

  it("isBillDone hanya benar untuk tagihan dengan status done", () => {
    const billDone = makeItem({ id: "b1", source: "bill", kind: "bill", dueDate: "2026-09-30", status: "done" });
    const billPlan = makeItem({ id: "b2", source: "bill", kind: "bill", dueDate: "2026-09-30", status: "plan" });
    const taskDone = makeItem({ id: "t1", source: "task", kind: "project", dueDate: "2026-09-30", status: "done" });

    expect(isBillDone(billDone)).toBe(true);
    expect(isBillDone(billPlan)).toBe(false);
    expect(isBillDone(taskDone)).toBe(false);
  });
});
