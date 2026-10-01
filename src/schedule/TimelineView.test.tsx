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
