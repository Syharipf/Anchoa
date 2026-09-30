import { describe, expect, it } from "bun:test";
import type { DayState } from "../api";
import {
  DAY_INITIALS,
  DAY_NAMES,
  SHORT_DAY_NAMES,
  STATE_STYLE,
  longSchedule,
  metaLabel,
  resolveRemindOn,
  scheduleLabel,
  toggleDay,
} from "./view";

describe("DAY constants", () => {
  it("has 7 day initials and 7 day names starting from Monday", () => {
    expect(DAY_INITIALS).toHaveLength(7);
    expect(DAY_NAMES).toHaveLength(7);
    expect(SHORT_DAY_NAMES).toHaveLength(7);
    expect(DAY_INITIALS[0]).toBe("S");
    expect(DAY_INITIALS[6]).toBe("M");
    expect(DAY_NAMES[0]).toBe("Senin");
    expect(DAY_NAMES[6]).toBe("Minggu");
    expect(SHORT_DAY_NAMES[0]).toBe("Sen");
    expect(SHORT_DAY_NAMES[6]).toBe("Min");
  });
});

describe("toggleDay", () => {
  it("toggles bits on and off", () => {
    // 127 is all 7 days (bits 0..6)
    expect(toggleDay(127, 0)).toBe(126);
    expect(toggleDay(126, 0)).toBe(127);
    expect(toggleDay(127, 6)).toBe(63);
  });

  it("never produces 0 (refuses to turn off the last active day)", () => {
    // Only Monday is active
    expect(toggleDay(1, 0)).toBe(1);
    // Only Sunday is active (bit 6 = 64)
    expect(toggleDay(64, 6)).toBe(64);
  });

  it("ignores out of bounds index", () => {
    expect(toggleDay(127, -1)).toBe(127);
    expect(toggleDay(127, 7)).toBe(127);
  });
});

describe("scheduleLabel", () => {
  it("handles standard cases", () => {
    expect(scheduleLabel(127)).toBe("Setiap hari");
    expect(scheduleLabel(31)).toBe("Sen–Jum");
    expect(scheduleLabel(96)).toBe("Sab–Min");
  });

  it("handles other consecutive day ranges", () => {
    // Sel, Rab, Kam (bits 1, 2, 3 = 2 + 4 + 8 = 14)
    expect(scheduleLabel(14)).toBe("Sel–Kam");
    // Sen, Sel (bits 0, 1 = 3)
    expect(scheduleLabel(3)).toBe("Sen–Sel");
    // Sel..Min (bits 1..6 = 126)
    expect(scheduleLabel(126)).toBe("Sel–Min");
    // Sen..Sab (bits 0..5 = 63)
    expect(scheduleLabel(63)).toBe("Sen–Sab");
  });

  it("handles non-consecutive days", () => {
    // Sen, Rab, Jum (bits 0, 2, 4 = 1 + 4 + 16 = 21)
    expect(scheduleLabel(21)).toBe("Sen, Rab, Jum");
    // Sen, Jum (bits 0, 4 = 17)
    expect(scheduleLabel(17)).toBe("Sen, Jum");
  });

  it("handles single day and empty bitmask", () => {
    expect(scheduleLabel(1)).toBe("Sen");
    expect(scheduleLabel(64)).toBe("Min");
    expect(scheduleLabel(0)).toBe("");
  });
});

describe("metaLabel", () => {
  it("formats time and schedule label", () => {
    expect(metaLabel({ days: 127, remindAt: "06:30" })).toBe("06.30 · Setiap hari");
    expect(metaLabel({ days: 31, remindAt: "07:00" })).toBe("07.00 · Sen–Jum");
  });

  it("formats schedule label without time when remindAt is missing or empty", () => {
    expect(metaLabel({ days: 127, remindAt: null })).toBe("Setiap hari");
    expect(metaLabel({ days: 127, remindAt: "" })).toBe("Setiap hari");
    expect(metaLabel({ days: 96 })).toBe("Sab–Min");
  });
});

describe("longSchedule", () => {
  it("formats schedule with pukul and time", () => {
    expect(longSchedule({ days: 127, remindAt: "06:30" })).toBe("Setiap hari pukul 06.30");
    expect(longSchedule({ days: 31, remindAt: "20:00" })).toBe("Sen–Jum pukul 20.00");
  });

  it("formats schedule without time when remindAt is missing or empty", () => {
    expect(longSchedule({ days: 127, remindAt: null })).toBe("Setiap hari");
    expect(longSchedule({ days: 96 })).toBe("Sab–Min");
  });
});

describe("STATE_STYLE", () => {
  it("has styling classes for every DayState", () => {
    const states: DayState[] = ["blank", "future", "off", "done", "todo", "miss"];
    for (const state of states) {
      expect(STATE_STYLE[state]).toBeDefined();
      expect(typeof STATE_STYLE[state]).toBe("string");
    }
    expect(STATE_STYLE.done).toContain("bg-accent");
    expect(STATE_STYLE.miss).toContain("bg-line");
    expect(STATE_STYLE.off).toContain("border-dashed");
    expect(STATE_STYLE.todo).toContain("border-accent");
  });
});

describe("resolveRemindOn", () => {
  it("turns reminder off when there is no reminder time", () => {
    expect(resolveRemindOn(null)).toBe(false);
    expect(resolveRemindOn("")).toBe(false);
    expect(resolveRemindOn("   ")).toBe(false);
    expect(resolveRemindOn(undefined)).toBe(false);

    // Even if edit had remindOn: true
    expect(resolveRemindOn(null, { remindAt: "07:00", remindOn: true })).toBe(false);
    expect(resolveRemindOn("", { remindAt: "07:00", remindOn: true })).toBe(false);
  });

  it("turns reminder on by default when a time is entered for a new habit", () => {
    expect(resolveRemindOn("07:00")).toBe(true);
    expect(resolveRemindOn("20:30", null)).toBe(true);
  });

  it("turns reminder on by default when a time is added to a habit that previously had no time", () => {
    expect(resolveRemindOn("08:00", { remindAt: null, remindOn: false })).toBe(true);
    expect(resolveRemindOn("08:00", { remindAt: "", remindOn: false })).toBe(true);
  });

  it("preserves reminder switch state when editing a habit that already had a reminder time", () => {
    expect(resolveRemindOn("08:00", { remindAt: "07:00", remindOn: false })).toBe(false);
    expect(resolveRemindOn("08:00", { remindAt: "07:00", remindOn: true })).toBe(true);
  });
});
