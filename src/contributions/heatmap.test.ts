import { describe, expect, test } from "bun:test";
import { buildMonths, level } from "./heatmap";

describe("level", () => {
  test("follows DESIGN.md buckets", () => {
    expect([0, 1, 3, 4, 6, 7, 9, 10, 40].map(level)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe("buildMonths", () => {
  const days = [
    { date: "2026-08-30", count: 5 },
    { date: "2026-08-31", count: 5 },
    { date: "2026-09-01", count: 2 },
    { date: "2026-09-02", count: 3 },
    { date: "2026-09-03", count: 0 },
    { date: "2026-09-04", count: 12 },
    { date: "2026-09-30", count: 7 },
  ];
  const months = buildMonths(days, "2026-09-29");
  const sep = months[5];

  test("six months ending with the current one", () => {
    expect(months.map((m) => m.key)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(sep.label).toBe("Sep 2026");
    expect(sep.fullLabel).toBe("September 2026");
  });

  test("weeks start on Monday and fill whole columns", () => {
    // 1 Sep 2026 is a Tuesday: one blank before it.
    expect(sep.slots[0].cell).toBeNull();
    expect(sep.slots[1].cell?.date).toBe("2026-09-01");
    expect(sep.slots.length % 7).toBe(0);
    expect(new Set(sep.slots.map((s) => s.key)).size).toBe(sep.slots.length);
  });

  test("today is marked and later days are future", () => {
    const today = sep.slots.find((s) => s.cell?.today);
    expect(today?.key).toBe("2026-09-29");
    const last = sep.slots.find((s) => s.key === "2026-09-30");
    expect(last?.cell?.future).toBe(true);
  });

  test("totals, streak and change skip future days", () => {
    expect(sep.total).toBe(17);
    expect(sep.streak).toBe(2);
    expect(months[4].total).toBe(10);
    expect(sep.deltaPct).toBe(70);
    expect(months[0].deltaPct).toBeNull();
  });
});
