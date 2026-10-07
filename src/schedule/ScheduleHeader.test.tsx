import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ItemKind } from "../api";
import { ScheduleHeader } from "./ScheduleHeader";

const COUNTS: Record<ItemKind, number> = { project: 0, bill: 0, personal: 0, calendar: 0 };
const OFF: ReadonlySet<ItemKind> = new Set<ItemKind>();

function header(counts: Record<ItemKind, number> = COUNTS, off: ReadonlySet<ItemKind> = OFF) {
  return renderToStaticMarkup(
    <ScheduleHeader
      view="calendar"
      onViewChange={() => {}}
      periodLabel="Oktober 2026"
      onPrev={() => {}}
      onNext={() => {}}
      onToday={() => {}}
      off={off}
      onToggleKind={() => {}}
      counts={counts}
      onOpenAssistant={() => {}}
      onAdd={() => {}}
    />,
  );
}

test("header offers both the manual add and the voice add", () => {
  const html = header();
  expect(html).toContain("Tambah tugas lewat suara");
  expect(html).toContain("<span>Tambah</span>");
});

test("the Google Kalender filter appears only with events or while hidden", () => {
  expect(header()).not.toContain("Google Kalender");
  expect(header({ ...COUNTS, calendar: 2 })).toContain("Google Kalender");
  expect(header(COUNTS, new Set<ItemKind>(["calendar"]))).toContain("Google Kalender");
});