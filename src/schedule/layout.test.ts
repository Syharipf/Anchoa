import { describe, expect, it } from "bun:test";
import type { ItemKind, ProjectDeadline, ScheduleItem } from "../api";
import {
  agendaGroups,
  agendaTitle,
  barFor,
  chipsFor,
  isBillDone,
  monthGrid,
  navSelectedDate,
  projectSpan,
  timelineGroups,
  timelineLabel,
  timelineWindow,
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

  it("awal jendela untuk hari Selasa 29 Sep 2026 = Senin 21 Sep", () => {
    const win = timelineWindow("2026-09-29", 0);
    expect(win.from).toBe("2026-09-21");
    expect(win.to).toBe("2026-11-15");
    expect(win.days.length).toBe(56);
    expect(win.days[0]).toBe("2026-09-21");
    expect(win.days[55]).toBe("2026-11-15");

    // Navigasi 4 minggu ke depan
    const nextWin = timelineWindow("2026-09-29", 4);
    expect(nextWin.from).toBe("2026-10-19");
    expect(nextWin.to).toBe("2026-12-13");
    expect(nextWin.days.length).toBe(56);

    // Navigasi 4 minggu ke belakang
    const prevWin = timelineWindow("2026-09-29", -4);
    expect(prevWin.from).toBe("2026-08-24");
    expect(prevWin.to).toBe("2026-10-18");
    expect(prevWin.days.length).toBe(56);
  });

  it("lebar dan posisi batang, termasuk yang terpotong di tepi", () => {
    const win = { from: "2026-09-21", to: "2026-11-15" };

    // Item 3 hari di dalam jendela (23-25 Sep): left = 2 hari * 16 = 32, width = 3 hari * 16 = 48
    const item1 = { startDate: "2026-09-23", dueDate: "2026-09-25" };
    expect(barFor(item1, win)).toEqual({ left: 32, width: 48 });

    // Item satu hari (21 Sep): left = 0, width = 16
    const itemSingle = { dueDate: "2026-09-21" };
    expect(barFor(itemSingle, win)).toEqual({ left: 0, width: 16 });

    // Item terpotong di kiri (mulai sebelum jendela: 18 Sep sampai 24 Sep)
    // Hari di dalam: 21, 22, 23, 24 Sep (4 hari) -> left = 0, width = 4 * 16 = 64
    const itemLeftClip = { startDate: "2026-09-18", dueDate: "2026-09-24" };
    expect(barFor(itemLeftClip, win)).toEqual({ left: 0, width: 64 });

    // Item terpotong di kanan (mulai 14 Nov sampai 20 Nov, jendela berakhir 15 Nov)
    // 14 Nov adalah hari ke-54 (54 * 16 = 864), hari di dalam: 14, 15 Nov (2 hari) -> width = 32
    const itemRightClip = { startDate: "2026-11-14", dueDate: "2026-11-20" };
    expect(barFor(itemRightClip, win)).toEqual({ left: 864, width: 32 });

    // Item mencakup seluruh jendela
    const itemFull = { startDate: "2026-09-01", dueDate: "2026-12-01" };
    expect(barFor(itemFull, win)).toEqual({ left: 0, width: 56 * 16 });

    // Item di luar jendela (sebelum jendela)
    const itemBefore = { startDate: "2026-09-10", dueDate: "2026-09-20" };
    expect(barFor(itemBefore, win)).toBeNull();

    // Item di luar jendela (setelah jendela)
    const itemAfter = { startDate: "2026-11-16", dueDate: "2026-11-25" };
    expect(barFor(itemAfter, win)).toBeNull();
  });

  it("projectSpan: rentang proyek di dalam jendela (inside the window)", () => {
    const win = { from: "2026-09-21", to: "2026-11-15" };
    // Earliest task start: 2026-09-25, deadline: 2026-10-05
    // sIdx = diffDays("2026-09-21", "2026-09-25") = 4 -> left = 4 * 16 = 64
    // eIdx = diffDays("2026-09-21", "2026-10-05") = 14 -> width = (14 - 4 + 1) * 16 = 176
    const group = {
      deadline: "2026-10-05",
      items: [
        makeItem({ id: "1", startDate: "2026-09-25", dueDate: "2026-09-28" }),
        makeItem({ id: "2", dueDate: "2026-10-02" }),
      ],
    };
    expect(projectSpan(group, win)).toEqual({ left: 64, width: 176 });
  });

  it("projectSpan: terpotong di kedua batas jendela (clipped at both edges)", () => {
    const win = { from: "2026-09-21", to: "2026-11-15" };
    // Earliest task start: 2026-09-01 (before window.from), deadline: 2026-11-30 (after window.to)
    // 56 days (indices 0 to 55) -> left = 0, width = 56 * 16 = 896
    const group = {
      deadline: "2026-11-30",
      items: [
        makeItem({ id: "1", startDate: "2026-09-01", dueDate: "2026-09-10" }),
      ],
    };
    expect(projectSpan(group, win)).toEqual({ left: 0, width: 56 * 16 });
  });

  it("projectSpan: seluruh rentang di luar jendela menghasilkan null (entirely outside -> null)", () => {
    const win = { from: "2026-09-21", to: "2026-11-15" };

    // Entirely before window (deadline before window.from)
    const groupBefore = {
      deadline: "2026-09-15",
      items: [
        makeItem({ id: "1", startDate: "2026-09-01", dueDate: "2026-09-10" }),
      ],
    };
    expect(projectSpan(groupBefore, win)).toBeNull();

    // Entirely after window (earliest start after window.to)
    const groupAfter = {
      deadline: "2026-11-30",
      items: [
        makeItem({ id: "2", startDate: "2026-11-20", dueDate: "2026-11-25" }),
      ],
    };
    expect(projectSpan(groupAfter, win)).toBeNull();
  });

  it("projectSpan: tanpa deadline atau tanpa item menghasilkan null (no deadline -> null)", () => {
    const win = { from: "2026-09-21", to: "2026-11-15" };

    const groupNoDeadline = {
      items: [
        makeItem({ id: "1", startDate: "2026-09-25", dueDate: "2026-09-28" }),
      ],
    };
    expect(projectSpan(groupNoDeadline, win)).toBeNull();

    const groupEmptyItems = {
      deadline: "2026-10-05",
      items: [],
    };
    expect(projectSpan(groupEmptyItems, win)).toBeNull();
  });

  it("urutan grup sesuai spec §4: proyek bertenggat, proyek lain, Pribadi, Tagihan", () => {
    const items: ScheduleItem[] = [
      makeItem({ id: "t-gamma", kind: "project", groupId: "p-gamma", groupName: "Project Gamma", dueDate: "2026-10-10", status: "plan" }),
      makeItem({ id: "t-beta", kind: "project", groupId: "p-beta", groupName: "Project Beta", dueDate: "2026-10-08", status: "doing" }),
      makeItem({ id: "t-alpha", kind: "project", groupId: "p-alpha", groupName: "Project Alpha", dueDate: "2026-09-29", status: "plan" }),
      makeItem({ id: "t-personal", kind: "personal", groupId: "personal", groupName: "Pribadi", dueDate: "2026-10-02", status: "plan" }),
      makeItem({ id: "b-bill", source: "bill", kind: "bill", groupId: "bills", groupName: "Tagihan", dueDate: "2026-10-05", status: "plan" }),
      // Item done tidak ikut ke dalam timeline
      makeItem({ id: "t-done", kind: "personal", groupId: "personal", groupName: "Pribadi", dueDate: "2026-10-01", status: "done" }),
    ];

    const deadlines: ProjectDeadline[] = [
      { projectId: "p-beta", name: "Project Beta", date: "2026-10-20" },
      { projectId: "p-alpha", name: "Project Alpha", date: "2026-10-01" },
    ];

    const groups = timelineGroups(items, deadlines);
    expect(groups.map((g) => g.id)).toEqual([
      "p-alpha",   // Project dengan deadline lebih awal (2026-10-01)
      "p-beta",    // Project dengan deadline berikutnya (2026-10-20)
      "p-gamma",   // Project tanpa deadline
      "personal",  // Pribadi
      "bills",     // Tagihan
    ]);

    // Pastikan item done tidak ada di items grup
    const personalGroup = groups.find((g) => g.id === "personal");
    expect(personalGroup?.items.map((i) => i.id)).toEqual(["t-personal"]);

    // Pastikan deadline tersimpan di group
    const alphaGroup = groups.find((g) => g.id === "p-alpha");
    expect(alphaGroup?.deadline).toBe("2026-10-01");
  });

  it("timelineLabel memformat rentang dengan benar", () => {
    expect(timelineLabel("2026-09-28", "2026-11-22")).toBe("28 Sep – 22 Nov");
    expect(timelineLabel("2026-09-21", "2026-11-15")).toBe("21 Sep – 15 Nov");
  });
});
