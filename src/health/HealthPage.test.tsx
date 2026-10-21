import { afterEach, describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { elements, hookHarness } from "../test/hookHarness";
import { HealthPage } from "./HealthPage";
import { TodayFields } from "./TodayFields";
import { api, type HealthDayRow, type HealthSeries, type HealthToday } from "../api";

const sampleToday: HealthToday = {
  date: "2026-10-21",
  fields: [
    { kind: "weight_g", value: 68400, delta: -200 },
    { kind: "sleep_min", value: 450, delta: 15 },
    { kind: "steps", value: 8420, delta: 310 },
    { kind: "resting_hr", value: 62, delta: -1 },
  ],
};

const sampleWeightSeries: HealthSeries = {
  kind: "weight_g",
  points: [68400, 68500],
  min: 68400,
  max: 68500,
  avg: 68450,
};

const sampleSleepSeries: HealthSeries = {
  kind: "sleep_min",
  points: [450, 460],
  min: 450,
  max: 460,
  avg: 455,
};

const sampleStepSeries: HealthSeries = {
  kind: "steps",
  points: [8420, 9000],
  min: 8420,
  max: 9000,
  avg: 8710,
};

const sampleHistory: HealthDayRow[] = [
  {
    date: "2026-10-21",
    weightG: 68400,
    sleepMin: 450,
    steps: 8420,
    restingHr: 62,
    note: null,
  },
  {
    date: "2026-10-20",
    weightG: null,
    sleepMin: 420,
    steps: 7000,
    restingHr: null,
    note: null,
  },
];

describe("HealthPage & TodayFields", () => {
  const origToday = api.healthToday;
  const origSeries = api.healthSeries;
  const origHistory = api.healthHistory;
  const origSave = api.saveHealthMetric;

  afterEach(() => {
    api.healthToday = origToday;
    api.healthSeries = origSeries;
    api.healthHistory = origHistory;
    api.saveHealthMetric = origSave;
  });

  it("renders 4 fields in TodayFields and displays values and units", () => {
    const html = renderToStaticMarkup(
      <TodayFields today={sampleToday} onSaved={() => {}} />,
    );
    expect(html).toContain("Weight");
    expect(html).toContain("Sleep");
    expect(html).toContain("Steps");
    expect(html).toContain("Resting HR");
    expect(html).toContain("68.4");
    expect(html).toContain("kg");
    expect(html).toContain("7:30");
    expect(html).toContain("h:m");
    expect(html).toContain("8,420");
    expect(html).toContain("steps");
    expect(html).toContain("62");
    expect(html).toContain("bpm");
  });

  it("saves metric on blur with canonical integer and today's date when changed", async () => {
    const saveMock = mock(async () => ({
      kind: "weight_g" as const,
      date: "2026-10-21",
      value: 69500,
      note: null,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    }));
    api.saveHealthMetric = saveMock;

    const onSaved = mock(() => {});
    const harness = hookHarness(() =>
      TodayFields({ today: sampleToday, onSaved }),
    );
    const node = harness.render();

    // Find input for Weight
    const inputs = elements(node).filter((el) => el.type === "input");
    const weightInput = inputs.find((el) => el.props["aria-label"] === "Weight");
    expect(weightInput).toBeDefined();
    (weightInput!.props.onChange as (e: unknown) => void)({
      target: { value: "69.5" },
    });
    const updatedNode = harness.render();
    const updatedInput = elements(updatedNode)
      .filter((el) => el.type === "input")
      .find((el) => el.props["aria-label"] === "Weight");
    // Trigger blur
    await (updatedInput!.props.onBlur as () => Promise<void>)();
    expect(saveMock).toHaveBeenCalledWith("weight_g", "2026-10-21", 69500);
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows '—' for missing values in history rows", async () => {
    api.healthToday = mock(async () => sampleToday);
    api.healthSeries = mock(async (kind) => {
      if (kind === "weight_g") return sampleWeightSeries;
      if (kind === "sleep_min") return sampleSleepSeries;
      return sampleStepSeries;
    });
    api.healthHistory = mock(async () => sampleHistory);

    const harness = hookHarness(() =>
      HealthPage(),
    );
    harness.render();
    await harness.settle();
    const loaded = harness.render();
    const html = renderToStaticMarkup(loaded);
    expect(html).toContain("Oct 21");
    expect(html).toContain("Oct 20");
    expect(html).toContain("—");
  });

  it("renders empty state 'No data yet' when all metrics are null", async () => {
    const emptyToday: HealthToday = {
      date: "2026-10-21",
      fields: [
        { kind: "weight_g", value: null, delta: null },
        { kind: "sleep_min", value: null, delta: null },
        { kind: "steps", value: null, delta: null },
        { kind: "resting_hr", value: null, delta: null },
      ],
    };
    const emptySeries = (kind: HealthToday["fields"][0]["kind"]): HealthSeries => ({
      kind,
      points: [],
      min: null,
      max: null,
      avg: null,
    });
    api.healthToday = mock(async () => emptyToday);
    api.healthSeries = mock(async (k) => emptySeries(k));
    api.healthHistory = mock(async () => []);

    const harness = hookHarness(() =>
      HealthPage(),
    );
    harness.render();
    await harness.settle();
    const loaded = harness.render();
    const html = renderToStaticMarkup(loaded);

    expect(html).toContain("No data yet");
  });
});
