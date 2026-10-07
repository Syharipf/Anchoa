import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ScheduleItem } from "../api";
import { CalendarEventForm } from "./CalendarEventForm";

const dummyEvent: ScheduleItem = {
  key: "calendar:e1",
  source: "calendar",
  id: "e1",
  kind: "calendar",
  title: "Rapat Tahunan",
  groupId: "calendar",
  groupName: "Google Kalender",
  startDate: "2026-10-15",
  dueDate: "2026-10-16",
  status: "plan",
  overdue: false,
  checkable: false,
};

test("CalendarEventForm renders title, dates, and buttons", () => {
  const html = renderToStaticMarkup(
    <CalendarEventForm item={dummyEvent} onClose={() => {}} onSaved={() => {}} />,
  );
  expect(html).toContain('role="dialog"');
  expect(html).toContain("Edit acara Google Kalender");
  expect(html).toContain('value="Rapat Tahunan"');
  expect(html).toContain('value="2026-10-15"');
  expect(html).toContain('value="2026-10-16"');
  expect(html).toContain("Hapus");
  expect(html).toContain("Simpan");
});
