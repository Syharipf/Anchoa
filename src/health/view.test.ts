import { describe, expect, it } from "bun:test";
import {
  FIELD_LABEL,
  UNITS,
  buildPolylines,
  deltaColor,
  formatDelta,
  formatInput,
  formatValue,
  lastPoint,
  parseValue,
} from "./view";

describe("health view", () => {
  it("provides correct field labels and units", () => {
    expect(FIELD_LABEL.weight_g).toBe("Weight");
    expect(FIELD_LABEL.sleep_min).toBe("Sleep");
    expect(FIELD_LABEL.steps).toBe("Steps");
    expect(FIELD_LABEL.resting_hr).toBe("Resting HR");

    expect(UNITS.weight_g).toBe("kg");
    expect(UNITS.sleep_min).toBe("h:m");
    expect(UNITS.steps).toBe("steps");
    expect(UNITS.resting_hr).toBe("bpm");
  });

  it("formats values correctly", () => {
    expect(formatValue("weight_g", 68400)).toBe("68.4");
    expect(formatValue("sleep_min", 450)).toBe("7h 30m");
    expect(formatValue("sleep_min", 425)).toBe("7h 05m");
    expect(formatValue("steps", 8420)).toBe("8,420");
    expect(formatValue("resting_hr", 62)).toBe("62");
    expect(formatValue("weight_g", null)).toBe("—");
  });

  it("formats editable inputs and round-trips them", () => {
    expect(formatInput("weight_g", 68400)).toBe("68.4");
    expect(formatInput("sleep_min", 450)).toBe("7:30");
    expect(formatInput("sleep_min", 425)).toBe("7:05");
    expect(formatInput("steps", 8420)).toBe("8,420");
    expect(formatInput("resting_hr", 62)).toBe("62");
    expect(formatInput("weight_g", null)).toBe("");
    for (const [kind, value] of [["weight_g", 68400], ["sleep_min", 425], ["steps", 0], ["resting_hr", 62]] as const) {
      expect(parseValue(kind, formatInput(kind, value))).toBe(value);
    }
  });

  it("parses values into canonical integers", () => {
    expect(parseValue("weight_g", "68.4")).toBe(68400);
    expect(parseValue("weight_g", "68,4")).toBe(68400);
    expect(parseValue("weight_g", "")).toBeNull();
    expect(parseValue("weight_g", "—")).toBeNull();
    expect(parseValue("weight_g", "0")).toBeNull();

    expect(parseValue("sleep_min", "7:30")).toBe(450);
    expect(parseValue("sleep_min", "7h 30m")).toBe(450);
    expect(parseValue("sleep_min", "7h")).toBe(420);
    expect(parseValue("sleep_min", "45m")).toBe(45);
    expect(parseValue("sleep_min", "450")).toBe(450);

    expect(parseValue("steps", "8,420")).toBe(8420);
    expect(parseValue("steps", "8420")).toBe(8420);
    expect(parseValue("steps", "0")).toBe(0);

    expect(parseValue("resting_hr", "62")).toBe(62);
    expect(parseValue("resting_hr", "0")).toBeNull();
  });

  it("formats deltas correctly", () => {
    expect(formatDelta("weight_g", -200)).toBe("−0.2 kg");
    expect(formatDelta("weight_g", 500)).toBe("+0.5 kg");
    expect(formatDelta("sleep_min", 15)).toBe("+15 min");
    expect(formatDelta("sleep_min", -30)).toBe("−30 min");
    expect(formatDelta("steps", 310)).toBe("+310");
    expect(formatDelta("resting_hr", -1)).toBe("−1 bpm");
    expect(formatDelta("steps", null)).toBe("—");
  });

  it("assigns appropriate delta colors", () => {
    expect(deltaColor("sleep_min", 15)).toBe("text-accent");
    expect(deltaColor("sleep_min", -15)).toBe("text-danger");
    expect(deltaColor("steps", 200)).toBe("text-accent");
    expect(deltaColor("steps", -200)).toBe("text-danger");
    expect(deltaColor("resting_hr", -2)).toBe("text-accent");
    expect(deltaColor("resting_hr", 2)).toBe("text-muted");
    expect(deltaColor("weight_g", -500)).toBe("text-muted");
    expect(deltaColor("weight_g", 0)).toBe("text-muted");
  });

  it("builds broken polylines when nulls are present", () => {
    const points = [10, 20, null, 40, 50];
    const polylines = buildPolylines(points, 100, 40, 0);
    expect(polylines).toHaveLength(2);
    // 5 points total: indices 0, 1, 2 (null), 3, 4
    // idx 0 -> x = 0.00, idx 1 -> x = 25.00
    // idx 3 -> x = 75.00, idx 4 -> x = 100.00
    expect(polylines[0]).toContain("0.00,");
    expect(polylines[0]).toContain("25.00,");
    expect(polylines[1]).toContain("75.00,");
    expect(polylines[1]).toContain("100.00,");
  });

  it("returns single continuous polyline when no nulls", () => {
    const points = [10, 20, 30];
    const polylines = buildPolylines(points, 100, 40, 0);
    expect(polylines).toHaveLength(1);
  });

  it("calculates lastPoint ignoring trailing or earlier nulls", () => {
    expect(lastPoint([10, 20, null], 100, 40, 0)).toEqual({ x: 50, y: 0 });
    expect(lastPoint([null, null], 100, 40, 0)).toBeNull();
  });
});
