// Run with TZ=Asia/Jakarta (see the "test" script in package.json).
import { describe, expect, test } from "bun:test";
import { dateInputToMs, fullDate, greeting, msToDateInput, relativeTime, shortDate } from "./format";

const at = (iso: string) => new Date(iso).getTime();

describe("relativeTime", () => {
  const now = at("2026-09-29T14:00:00+07:00");
  test("short spans", () => {
    expect(relativeTime(now - 30_000, now)).toBe("baru saja");
    expect(relativeTime(now - 2 * 60_000, now)).toBe("2 menit lalu");
    expect(relativeTime(now - 5 * 3_600_000, now)).toBe("5 jam lalu");
  });
  test("calendar days", () => {
    expect(relativeTime(at("2026-09-28T09:00:00+07:00"), now)).toBe("kemarin");
    expect(relativeTime(at("2026-09-26T09:00:00+07:00"), now)).toBe("3 hari lalu");
    expect(relativeTime(at("2026-09-12T09:00:00+07:00"), now)).toBe("12 Sep");
  });
});

describe("dates", () => {
  test("short Indonesian date", () => {
    expect(shortDate(at("2026-09-12T08:00:00+07:00"))).toBe("12 Sep");
  });
  test("date input round trip uses local midnight", () => {
    expect(dateInputToMs("2026-10-01")).toBe(at("2026-10-01T00:00:00+07:00"));
    expect(msToDateInput(at("2026-10-01T00:00:00+07:00"))).toBe("2026-10-01");
    expect(dateInputToMs("")).toBeNull();
    expect(msToDateInput(null)).toBe("");
  });
});

describe("greeting", () => {
  test("follows the hour boundaries", () => {
    expect(greeting(4)).toBe("Selamat pagi");
    expect(greeting(10)).toBe("Selamat pagi");
    expect(greeting(11)).toBe("Selamat siang");
    expect(greeting(14)).toBe("Selamat siang");
    expect(greeting(15)).toBe("Selamat sore");
    expect(greeting(17)).toBe("Selamat sore");
    expect(greeting(18)).toBe("Selamat malam");
    expect(greeting(3)).toBe("Selamat malam");
  });
});

describe("fullDate", () => {
  test("weekday, day and month in Indonesian", () => {
    expect(fullDate(at("2026-09-29T08:00:00+07:00"))).toBe("Selasa, 29 September");
  });
});
