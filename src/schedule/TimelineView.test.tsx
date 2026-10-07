import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ScheduleItem } from "../api";
import { TimelineGroup } from "./TimelineView";

test.each([
  ["test", "Tes"],
  ["review", "Review"],
] as const)("timeline describes tasks in %s", (status, label) => {
  const item: ScheduleItem = {
    key: "task:t1", source: "task", id: "t1", kind: "project", title: "Tugas",
    groupId: "p1", groupName: "Proyek", dueDate: "2026-10-01", status,
    overdue: false, checkable: true,
  };
  const html = renderToStaticMarkup(
    <TimelineGroup
      group={{ id: "p1", name: "Proyek", kind: "project", items: [item] }}
      window={{ from: "2026-10-01", to: "2026-10-01", days: ["2026-10-01"] }}
      today="2026-10-01"
      onOpenItem={() => {}}
      onOpenFinance={() => {}}
    />,
  );
  expect(html).toContain(`aria-label="Tugas · 1 Okt · ${label}"`);
});

test("Google Kalender events render read-only, without any button", () => {
  const item: ScheduleItem = {
    key: "calendar:e1", source: "calendar", id: "e1", kind: "calendar", title: "Rapat",
    groupId: "calendar", groupName: "Google Kalender", startDate: "2026-10-01", dueDate: "2026-10-01",
    status: "plan", overdue: false, checkable: false,
  };
  const html = renderToStaticMarkup(
    <TimelineGroup
      group={{ id: "calendar", name: "Google Kalender", kind: "calendar", items: [item] }}
      window={{ from: "2026-10-01", to: "2026-10-01", days: ["2026-10-01"] }}
      today="2026-10-01"
      onOpenItem={() => {}}
      onOpenFinance={() => {}}
    />,
  );
  expect(html).toContain('title="Rapat · 1 Okt · Hanya baca · Google Kalender"');
  expect(html).not.toContain("<button");
});
