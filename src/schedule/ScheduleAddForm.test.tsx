import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ScheduleAddForm, validateScheduleInput } from "./ScheduleAddForm";

test("empty title is rejected", () => {
  expect(validateScheduleInput("   ", "2026-10-06")).toEqual({
    error: "Title cannot be empty",
  });
});

test("invalid date is rejected", () => {
  expect(validateScheduleInput("Shopping", "not-a-date")).toEqual({
    error: "Invalid date: not-a-date",
  });
});

test("form renders title, date defaulting to today, and inline error slot", () => {
  const html = renderToStaticMarkup(
    <ScheduleAddForm defaultDate="2026-10-06" onClose={() => {}} onSaved={() => {}} />,
  );
  expect(html).toContain('role="dialog"');
  expect(html).toContain("New task");
  expect(html).toContain('value="2026-10-06"');
  expect(html).not.toContain('role="alert"');
});
