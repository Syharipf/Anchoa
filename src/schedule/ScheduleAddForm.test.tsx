import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ScheduleAddForm, validateScheduleInput } from "./ScheduleAddForm";

test("empty title is rejected", () => {
  expect(validateScheduleInput("   ", "2026-10-06")).toEqual({
    error: "Judul tidak boleh kosong",
  });
});

test("invalid date is rejected", () => {
  expect(validateScheduleInput("Belanja", "bukan-tanggal")).toEqual({
    error: "Tanggal tidak valid: bukan-tanggal",
  });
});

test("form renders title, date defaulting to today, and inline error slot", () => {
  const html = renderToStaticMarkup(
    <ScheduleAddForm defaultDate="2026-10-06" onClose={() => {}} onSaved={() => {}} />,
  );
  expect(html).toContain('role="dialog"');
  expect(html).toContain("Tugas baru");
  expect(html).toContain('value="2026-10-06"');
  expect(html).not.toContain('role="alert"');
});
