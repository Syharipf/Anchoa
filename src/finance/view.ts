// Pure display rules for the Keuangan page (spec Fase 2 §5).
import type { AccountKind, AccountView, BillView, TransactionView } from "../api";
import { monthOf } from "../money";
import { shortDate } from "../format";

export const KIND_LABELS: Record<AccountKind, string> = {
  cash: "Tunai",
  bank: "Bank",
  ewallet: "E-wallet",
  credit: "Kartu kredit",
};

export type TransactionIcon = "car" | "food" | "bill" | "bag" | "income" | "transfer" | "other";

const CATEGORY_ICONS = new Map<string, TransactionIcon>([
  ["Transportasi", "car"],
  ["Makan & minum", "food"],
  ["Tagihan", "bill"],
  ["Belanja", "bag"],
]);

export function iconFor(t: Pick<TransactionView, "amount" | "category" | "transferId">): TransactionIcon {
  if (t.transferId) return "transfer";
  if (t.amount > 0) return "income";
  return CATEGORY_ICONS.get(t.category ?? "") ?? "other";
}

/** Money coming in from outside, shown in the accent colour. A transfer's incoming leg is not income. */
export function isIncome(t: Pick<TransactionView, "amount" | "transferId">): boolean {
  return t.amount > 0 && t.transferId === null;
}

/** "Makan & minum · BCA", or "BCA → GoPay" for a transfer. */
export function transactionMeta(t: TransactionView): string {
  if (t.transferId) return `${t.accountName} → ${t.counterAccountName ?? "?"}`;
  return `${t.category ?? "Tanpa kategori"} · ${t.accountName}`;
}

export interface MonthGroup {
  month: string;
  items: TransactionView[];
}

/** Consecutive rows of the same local month, in the given order (newest first). */
export function groupByMonth(items: TransactionView[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const t of items) {
    const month = monthOf(t.occurredAt);
    const last = groups.at(-1);
    if (last?.month === month) last.items.push(t);
    else groups.push({ month, items: [t] });
  }
  return groups;
}

/** Whole-percent share of the positive total, only for accounts with a positive balance. */
export function accountShares(accounts: AccountView[]): Map<string, number> {
  const total = accounts.reduce((sum, a) => sum + Math.max(a.balance, 0), 0);
  return new Map(accounts.filter((a) => a.balance > 0).map((a) => [a.id, Math.round((a.balance * 100) / total)]));
}

/** Chip on the dashboard Keuangan card (spec Fase 2 §5). `dueBills` is overdue or due today. */
export function billChip(dueBills: BillView[]): { text: string; tone: "danger" | "ink" | "accent" } {
  const late = dueBills.filter((b) => b.status === "overdue").length;
  if (late > 0) return { text: `${late} terlambat`, tone: "danger" };
  const today = dueBills.filter((b) => b.status === "dueToday");
  if (today.length === 1) return { text: `${today[0].name} hari ini`, tone: "ink" };
  if (today.length > 1) return { text: `${today.length} tagihan hari ini`, tone: "ink" };
  return { text: "Tagihan aman", tone: "accent" };
}

/** Second line of a bill row, e.g. "Terlambat 1 hari · sejak 28 Sep". */
export function billStatusText(b: BillView): string {
  if (b.status === "overdue") return `Terlambat ${b.daysLate} hari · sejak ${shortDate(b.dueAt)}`;
  if (b.status === "dueToday") return "Jatuh tempo hari ini";
  if (b.status === "paidToday") return "Lunas hari ini";
  return `Jatuh tempo ${shortDate(b.dueAt)}`;
}
