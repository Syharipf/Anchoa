import { describe, expect, it } from "bun:test";
import { formatSince, NOTIFY_PREF_OPTIONS, profileInitials, profileStatsList } from "./view";

describe("profileInitials", () => {
  it("extracts single initial for single-word name", () => {
    expect(profileInitials("Syharipf")).toBe("S");
    expect(profileInitials("Budi")).toBe("B");
    expect(profileInitials("a")).toBe("A");
  });

  it("extracts up to two uppercase initials for multi-word name", () => {
    expect(profileInitials("Syharip Fadilah")).toBe("SF");
    expect(profileInitials("Budi Santoso")).toBe("BS");
    expect(profileInitials("John Michael Doe")).toBe("JM");
  });

  it("handles whitespace and empty strings with default K for Kamu", () => {
    expect(profileInitials("")).toBe("K");
    expect(profileInitials("   ")).toBe("K");
    expect(profileInitials("  Dewi   Sartika  ")).toBe("DS");
  });

  it("supports unicode and accented characters", () => {
    expect(profileInitials("Élodie Agent")).toBe("ÉA");
    expect(profileInitials("🌻 Bunga")).toBe("🌻B");
  });
});

describe("formatSince", () => {
  it("formats timestamp into month and year in Indonesian", () => {
    // 2026-09-20T00:00:00Z -> Sep 2026
    const d = new Date(2026, 8, 20).getTime();
    expect(formatSince(d)).toBe("Memakai Anchoa sejak Sep 2026");
  });

  it("returns fallback when since is null", () => {
    expect(formatSince(null)).toBe("Memakai Anchoa baru saja");
  });
});

describe("profileStatsList", () => {
  it("returns the four profile stats with zero defaults when null", () => {
    const list = profileStatsList(null);
    expect(list).toEqual([
      { label: "hari streak", value: 0 },
      { label: "tugas selesai", value: 0 },
      { label: "entri jurnal", value: 0 },
      { label: "catatan", value: 0 },
    ]);
  });

  it("populates values from ProfileStats", () => {
    const list = profileStatsList({
      habitStreak: 6,
      tasksDone: 18,
      journalEntries: 25,
      notes: 12,
    });
    expect(list).toEqual([
      { label: "hari streak", value: 6 },
      { label: "tugas selesai", value: 18 },
      { label: "entri jurnal", value: 25 },
      { label: "catatan", value: 12 },
    ]);
  });
});

describe("NOTIFY_PREF_OPTIONS", () => {
  it("contains the four notification switch keys in order", () => {
    expect(NOTIFY_PREF_OPTIONS.map((o) => o.key)).toEqual(["task", "bill", "budget", "habit"]);
  });
});
