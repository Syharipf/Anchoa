// Run with TZ=Asia/Jakarta (see the "test" script in package.json).
import { describe, expect, test } from "bun:test";
import {
  clockLabel,
  dateInputToMs,
  formatBytes,
  fullDate,
  greeting,
  msToDateInput,
  relativeTime,
  shortDate,
  upcomingLabel,
} from "./format";

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
  test("rejects malformed or impossible calendar dates without rolling into another day", () => {
    for (const bad of ["bad-date", "2026-02-30", "1900-02-29", "2026-13-01", "2026-00-01", "2026-09-00", "2026-9-01", "2026-09-1", "2026-09-29T00:00", "0000-01-01"]) {
      expect(dateInputToMs(bad)).toBeNull();
    }
    expect(dateInputToMs("2028-02-29")).toBe(at("2028-02-29T00:00:00+07:00"));
  });

  test("dates before year 1000 round-trip through the date input", () => {
    const value = msToDateInput(dateInputToMs("0999-01-01"));
    expect(value).toBe("0999-01-01");
    expect(dateInputToMs(value)).not.toBeNull();
  });

  test("date inputs follow Jakarta midnight even while UTC remains on the previous day", () => {
    const midnight = at("2026-10-01T00:00:00+07:00");
    expect(msToDateInput(midnight - 1)).toBe("2026-09-30");
    expect(msToDateInput(midnight)).toBe("2026-10-01");
  });

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

describe("clockLabel", () => {
  test("short weekday, date, month and 24-hour time", () => {
    expect(clockLabel(at("2026-09-30T00:48:00+07:00"))).toBe("Rab 30 Sep · 00:48");
    expect(clockLabel(at("2026-09-29T22:05:00+07:00"))).toBe("Sel 29 Sep · 22:05");
  });
});

describe("upcomingLabel", () => {
  test("reads the local date without shifting it", () => {
    expect(upcomingLabel("2026-10-01")).toEqual({ weekday: "Kam", day: 1 });
    expect(upcomingLabel("2026-10-04")).toEqual({ weekday: "Min", day: 4 });
  });
});

describe("formatBytes", () => {
  test("formats byte sizes using Indonesian conventions", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(Math.round(12.3 * 1024 * 1024))).toBe("12,3 MB");
  });

  test("formats whole units and gigabytes", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(Math.round(2.5 * 1024 * 1024 * 1024))).toBe("2,5 GB");
  });
});
