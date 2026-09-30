import { describe, expect, test } from "bun:test";
import type { AccountView, BillView, TransactionView } from "../api";
import { accountShares, billChip, groupByMonth, iconFor, isIncome, transactionMeta } from "./view";

const tx = (over: Partial<TransactionView> = {}): TransactionView => ({
  id: "t",
  title: "",
  body: "",
  amount: -1000,
  category: null,
  accountId: "a",
  accountName: "BCA",
  occurredAt: 0,
  createdAt: 0,
  transferId: null,
  counterAccountId: null,
  counterAccountName: null,
  billId: null,
  scheduled: false,
  ...over,
});

const account = (id: string, balance: number): AccountView => ({
  id,
  name: id,
  kind: "bank",
  currency: "IDR",
  openingBalance: 0,
  balance,
});

describe("transaction rows", () => {
  test("icons follow transfers, income and the category", () => {
    expect(iconFor(tx({ transferId: "x" }))).toBe("transfer");
    expect(iconFor(tx({ amount: 5000, category: "Gaji" }))).toBe("income");
    expect(iconFor(tx({ category: "Transportasi" }))).toBe("car");
    expect(iconFor(tx({ category: "Makan & minum" }))).toBe("food");
    expect(iconFor(tx({ category: "constructor" }))).toBe("other");
    expect(iconFor(tx())).toBe("other");
  });

  test("income leaves out the incoming leg of a transfer", () => {
    expect(isIncome(tx({ amount: 5000 }))).toBe(true);
    expect(isIncome(tx({ amount: 5000, transferId: "x" }))).toBe(false);
    expect(isIncome(tx())).toBe(false);
  });

  test("meta line", () => {
    expect(transactionMeta(tx({ category: "Belanja" }))).toBe("Belanja · BCA");
    expect(transactionMeta(tx())).toBe("Tanpa kategori · BCA");
    expect(transactionMeta(tx({ transferId: "x", counterAccountName: "GoPay" }))).toBe("BCA → GoPay");
  });

  test("groups consecutive rows by local month", () => {
    const sep = new Date(2026, 8, 29).getTime();
    const aug = new Date(2026, 7, 31).getTime();
    const groups = groupByMonth([tx({ id: "a", occurredAt: sep }), tx({ id: "b", occurredAt: sep }), tx({ id: "c", occurredAt: aug })]);
    expect(groups.map((g) => [g.month, g.items.map((t) => t.id)])).toEqual([
      ["2026-09", ["a", "b"]],
      ["2026-08", ["c"]],
    ]);
  });
});

describe("accountShares", () => {
  test("splits the positive total and skips debt and empty accounts", () => {
    const shares = accountShares([account("bank", 850000), account("tunai", 125000), account("kartu", -50000), account("kosong", 0)]);
    expect([...shares]).toEqual([
      ["bank", 87],
      ["tunai", 13],
    ]);
  });
});

const bill = (name: string, status: BillView["status"]): BillView => ({
  id: name,
  name,
  amount: 1000,
  accountId: "a",
  accountName: "BCA",
  repeat: "monthly",
  dueAt: 0,
  status,
  daysLate: status === "overdue" ? 1 : 0,
});

describe("billChip", () => {
  test("late bills first, then today's, else all clear", () => {
    expect(billChip([bill("Listrik", "overdue"), bill("Air", "dueToday")])).toEqual({ text: "1 terlambat", tone: "danger" });
    expect(billChip([bill("Air", "dueToday")])).toEqual({ text: "Air hari ini", tone: "ink" });
    expect(billChip([bill("Air", "dueToday"), bill("Gas", "dueToday")])).toEqual({ text: "2 tagihan hari ini", tone: "ink" });
    expect(billChip([])).toEqual({ text: "Tagihan aman", tone: "accent" });
  });
});
