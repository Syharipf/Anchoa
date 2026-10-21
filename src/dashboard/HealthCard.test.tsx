import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { HealthToday } from "../api";
import { HealthCard } from "./HealthCard";

describe("HealthCard", () => {
  it("renders null if today is undefined", () => {
    const html = renderToStaticMarkup(<HealthCard onSelect={() => {}} />);
    expect(html).toBe("");
  });

  it("renders null if all 4 metric values are null", () => {
    const emptyToday: HealthToday = {
      date: "2026-10-21",
      fields: [
        { kind: "weight_g", value: null, delta: null },
        { kind: "sleep_min", value: null, delta: null },
        { kind: "steps", value: null, delta: null },
        { kind: "resting_hr", value: null, delta: null },
      ],
    };
    const html = renderToStaticMarkup(<HealthCard today={emptyToday} onSelect={() => {}} />);
    expect(html).toBe("");
  });

  it("renders summary values and delta when metrics exist", () => {
    const today: HealthToday = {
      date: "2026-10-21",
      fields: [
        { kind: "weight_g", value: 68400, delta: -200 },
        { kind: "sleep_min", value: 450, delta: 15 },
        { kind: "steps", value: 8420, delta: 310 },
        { kind: "resting_hr", value: 62, delta: -1 },
      ],
    };
    const onSelect = mock((_p: string) => {});
    const html = renderToStaticMarkup(<HealthCard today={today} onSelect={onSelect} />);

    expect(html).toContain("Health");
    expect(html).toContain("68.4");
    expect(html).toContain("kg");
    expect(html).toContain("−0.2 kg");
    expect(html).toContain("7h 30m");
    expect(html).toContain("+15 min");
    expect(html).toContain("8,420");
    expect(html).toContain("+310");
  });

  it("handles click and navigates to health page", () => {
    const onSelect = mock((_p: string) => {});
    const today: HealthToday = {
      date: "2026-10-21",
      fields: [
        { kind: "weight_g", value: 68400, delta: null },
        { kind: "sleep_min", value: null, delta: null },
        { kind: "steps", value: null, delta: null },
        { kind: "resting_hr", value: null, delta: null },
      ],
    };
    const card = HealthCard({ today, onSelect });
    expect(card).not.toBeNull();
    (card!.props.onClick as () => void)();
    expect(onSelect).toHaveBeenCalledWith("health");
  });
});
