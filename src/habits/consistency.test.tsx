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

describe("consistency rule is stated in the UI", () => {
  it("summarises the overview ratio as scheduled days, not checklist items", () => {
    const html = renderToStaticMarkup(
      <SummaryCards
        todayDone={0}
        todayTotal={1}
        topStreak={null}
        consistency={consistency}
        habits={[habit]}
      />,
    );
    // Matches `rate30` in src-tauri/src/habits.rs: done / scheduled over scheduled days.
    expect(html).toContain("4 dari 19 hari terjadwal selesai");
    expect(html).toContain("per hari, bukan per checklist");
    expect(html).toContain("Hari di luar jadwal mingguan tidak masuk hitungan");
    expect(html).toContain("hari ini baru masuk setelah dicentang");
  });

  it("states the same rule next to a single habit's 30-day rate", () => {
    const html = renderToStaticMarkup(
      <HabitDetail habit={habit} today="2026-09-29" onEdit={() => {}} onDelete={() => {}} onUpdate={() => {}} />,
    );
    expect(html).toContain("21%");
    expect(html).toContain("hari terjadwal yang dicentang");
    expect(html).toContain("hari di luar jadwal mingguan tidak dihitung");
    expect(html).toContain("hari ini masuk setelah dicentang");
  });
});
