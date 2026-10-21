import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Consistency, HabitRow } from "../api";
import { HabitDetail } from "./HabitDetail";
import { SummaryCards } from "./SummaryCards";

const habit: HabitRow = {
  id: "h1",
  name: "Olahraga",
  days: 127,
  remindAt: null,
  remindOn: false,
  autoJournal: false,
  scheduledToday: true,
  doneToday: false,
  streak: 3,
  best: 5,
  rate30: 21,
  week: ["done", "done", "miss", "done", "todo", "off", "off"],
  createdAt: new Date(2026, 8, 25).getTime(),
};

const consistency: Consistency = { percent: 21, done: 4, scheduled: 19 };

describe("consistency metrics in UI", () => {
  it("renders the 30-day consistency ratio in SummaryCards", () => {
    const html = renderToStaticMarkup(
      <SummaryCards
        todayDone={0}
        todayTotal={1}
        topStreak={null}
        consistency={consistency}
        habits={[habit]}
      />,
    );
    expect(html).toContain("4/19 days");
    expect(html).toContain("21");
    expect(html).toContain("30-day consistency");
  });

  it("renders 30-day consistency rate in HabitDetail", () => {
    const html = renderToStaticMarkup(
      <HabitDetail habit={habit} today="2026-09-29" onEdit={() => {}} onDelete={() => {}} onUpdate={() => {}} />,
    );
    expect(html).toContain("21%");
    expect(html).toContain("30-day consistency");
  });
});
