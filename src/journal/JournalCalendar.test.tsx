import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api, type CalendarView } from "../api";
import { elements, hookHarness } from "../test/hookHarness";
import { JournalCalendar, moodDotColor } from "./JournalCalendar";

type CalendarHarness = {
  render(runEffects?: boolean): ReactNode;
  settle(): Promise<ReactNode>;
  dispose(): void;
};

function makeCalendarView(month = "2026-10"): CalendarView {
  return {
    month,
    currentStreak: 3,
    bestStreak: 12,
    days: [
      { date: `${month}-01`, count: 1, mood: 5 },
      { date: `${month}-02`, count: 2, mood: null },
      { date: `${month}-03`, count: 0, mood: null },
      { date: `${month}-04`, count: 1, mood: 1 },
    ],
  };
}

function findButton(node: ReactNode, label: string) {
  const el = elements(node).find(
    (e) =>
      e.type === "button" &&
      (e.props["aria-label"] === label ||
        (e.props["aria-label"] as string | undefined)?.startsWith(label) ||
        (Array.isArray(e.props.children)
          ? e.props.children.some((c: unknown) => c === label)
          : e.props.children === label)),
  );
  expect(el).toBeDefined();
  return el!;
}

describe("moodDotColor", () => {
  it("maps moods 1..5 and null to theme colors", () => {
    expect(moodDotColor(null)).toBe("#5B6475");
    expect(moodDotColor(1)).toBe("#FF8A7A");
    expect(moodDotColor(2)).toBe("#E89A6A");
    expect(moodDotColor(3)).toBe("#C9CED8");
    expect(moodDotColor(4)).toBe("#86B33A");
    expect(moodDotColor(5)).toBe("#C6F36B");
    expect(moodDotColor(0)).toBe("#FF8A7A");
    expect(moodDotColor(6)).toBe("#C6F36B");
  });
});

describe("JournalCalendar", () => {
  let harness: CalendarHarness | undefined;
  let spies: { mockRestore: () => void }[];

  beforeEach(() => {
    spies = [
      spyOn(api, "journalCalendar").mockImplementation(async (month: string) =>
        makeCalendarView(month),
      ),
    ];
  });

  afterEach(() => {
    harness?.dispose();
    for (const spy of spies) spy.mockRestore();
  });

  it("renders streaks and controlled calendarView", async () => {
    const onSelect = mock((_date: string) => {});
    const view = makeCalendarView("2026-10");
    harness = hookHarness(() =>
      JournalCalendar({
        calendarView: view,
        selectedDate: "2026-10-01",
        onSelectDate: onSelect,
      }),
    );
    await harness.settle();

    const rendered = harness.render();
    const textNodes = elements(rendered).flatMap((el) => {
      const ch = el.props.children;
      if (Array.isArray(ch)) {
        return ch.flatMap((c: unknown) =>
          typeof c === "string" ? [c] : typeof c === "number" ? [String(c)] : [],
        );
      }
      return typeof ch === "string" ? [ch] : typeof ch === "number" ? [String(ch)] : [];
    });

    expect(textNodes).toContain("3");
    expect(textNodes).toContain("12");
    expect(textNodes).toContain("Streak saat ini");
    expect(textNodes).toContain("Terpanjang");
    expect(textNodes).toContain("Oktober 2026");

    const day1Btn = findButton(rendered, "2026-10-01");
    expect(day1Btn.props["aria-pressed"]).toBe(true);

    (day1Btn.props.onClick as () => void)();
    expect(onSelect).toHaveBeenCalledWith("2026-10-01");
  });

  it("renders mood dots for entries with mood and gray for entries without mood", async () => {
    const view = makeCalendarView("2026-10");
    harness = hookHarness(() =>
      JournalCalendar({
        calendarView: view,
        onSelectDate: () => {},
      }),
    );
    await harness.settle();
    const rendered = harness.render();

    // day 1: count 1, mood 5 -> dot with #C6F36B
    const day1Btn = findButton(rendered, "2026-10-01");
    const day1Dot = elements(day1Btn).find((el) => (el.props.style as Record<string, unknown>)?.backgroundColor === "#C6F36B");
    expect(day1Dot).toBeDefined();

    // day 2: count 2, mood null -> dot with #5B6475
    const day2Btn = findButton(rendered, "2026-10-02");
    const day2Dot = elements(day2Btn).find((el) => (el.props.style as Record<string, unknown>)?.backgroundColor === "#5B6475");
    expect(day2Dot).toBeDefined();

    // day 3: count 0 -> no background dot
    const day3Btn = findButton(rendered, "2026-10-03");
    const day3Dot = elements(day3Btn).find((el) => (el.props.style as Record<string, unknown>)?.backgroundColor);
    expect(day3Dot).toBeUndefined();
  });
  it("loads calendarView from API and navigates months", async () => {
    const onSelect = mock((_date: string) => {});
    harness = hookHarness(() =>
      JournalCalendar({
        initialMonth: "2026-10",
        onSelectDate: onSelect,
      }),
    );
    await harness.settle();

    expect(api.journalCalendar).toHaveBeenCalledWith("2026-10");

    // Click previous month
    const prevBtn = findButton(harness.render(), "Bulan sebelumnya");
    (prevBtn.props.onClick as () => void)();
    await harness.settle();

    expect(api.journalCalendar).toHaveBeenCalledWith("2026-09");

    // Click next month twice
    const nextBtn = findButton(harness.render(), "Bulan berikutnya");
    (nextBtn.props.onClick as () => void)();
    await harness.settle();
    expect(api.journalCalendar).toHaveBeenCalledWith("2026-10");

    (nextBtn.props.onClick as () => void)();
    await harness.settle();
    expect(api.journalCalendar).toHaveBeenCalledWith("2026-11");
  });

  it("updates month when selectedDate changes to different month", async () => {
    let selDate = "2026-10-04";
    harness = hookHarness(() =>
      JournalCalendar({
        selectedDate: selDate,
        onSelectDate: () => {},
      }),
    );
    await harness.settle();
    expect(api.journalCalendar).toHaveBeenCalledWith("2026-10");

    selDate = "2026-05-15";
    harness.render();
    await harness.settle();
    expect(api.journalCalendar).toHaveBeenCalledWith("2026-05");
  });
});
