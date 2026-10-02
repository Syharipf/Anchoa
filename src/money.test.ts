import { describe, expect, test } from "bun:test";
import {
  addMonths,
  formatBalance,
  formatDigits,
  formatRupiah,
  monthLabel,
  monthOf,
  monthShort,
  parseRupiah,
  signedRupiah,
} from "./money";

describe("rupiah formatting", () => {
  test("groups thousands with dots and drops the sign", () => {
    expect(formatRupiah(25000)).toBe("Rp 25.000");
    expect(formatRupiah(-1500000)).toBe("Rp 1.500.000");
    expect(formatRupiah(0)).toBe("Rp 0");
  });

  test("signed and balance forms", () => {
    expect(signedRupiah(25000)).toBe("+Rp 25.000");
    expect(signedRupiah(-5000)).toBe("−Rp 5.000");
    expect(signedRupiah(0)).toBe("Rp 0");
    expect(formatBalance(-50000)).toBe("−Rp 50.000");
    expect(formatBalance(975000)).toBe("Rp 975.000");
  });

  test("form digits keep a plain minus", () => {
    expect(formatDigits(1000000)).toBe("1.000.000");
    expect(formatDigits(-25000)).toBe("-25.000");
  });
});

describe("parseRupiah", () => {
  test("round trips integer minor units up to the JavaScript precision limit", () => {
    for (const amount of [0, 1, -1, 25001, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
      expect(parseRupiah(formatDigits(amount))).toBe(amount);
      expect(Number.isSafeInteger(parseRupiah(formatDigits(amount)))).toBe(true);
    }
    for (const bad of ["9007199254740992", "9.007.199.254.740.992", "-9007199254740992", "1e3", "Infinity", "NaN", "+1", "0x10"]) {
      expect(parseRupiah(bad)).toBeNull();
    }
  });

  test("accepts plain, grouped and Rp-prefixed amounts", () => {
    expect(parseRupiah("25000")).toBe(25000);
    expect(parseRupiah("25.000")).toBe(25000);
    expect(parseRupiah("Rp 25.000")).toBe(25000);
    expect(parseRupiah(" rp25.000 ")).toBe(25000);
    expect(parseRupiah("-50.000")).toBe(-50000);
  });

  test("rejects decimals and text", () => {
    for (const bad of ["25,5", "25.5", "1.2345", "abc", "", "Rp", "--5"]) {
      expect(parseRupiah(bad)).toBeNull();
    }
  });
});

describe("months", () => {
  test("labels", () => {
    expect(monthLabel("2026-09")).toBe("September 2026");
    expect(monthShort("2026-08")).toBe("Agu");
  });

  test("addMonths crosses years", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-09", -5)).toBe("2026-04");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
  });

  test("monthOf uses the local date", () => {
    // 30 Sep 20:00 UTC is 1 Oct 03:00 in Jakarta (bun run test sets TZ=Asia/Jakarta).
    expect(monthOf(Date.UTC(2026, 8, 30, 20))).toBe("2026-10");
  });

  test("monthOf switches on the exact Jakarta midnight millisecond", () => {
    const midnight = Date.parse("2027-01-01T00:00:00+07:00");
    expect(monthOf(midnight - 1)).toBe("2026-12");
    expect(monthOf(midnight)).toBe("2027-01");
  });
});
