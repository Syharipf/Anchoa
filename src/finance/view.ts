// Pure display rules for the Keuangan page (spec Fase 2 §5).
import type { AccountKind, AccountView, TransactionView } from "../api";
import { monthOf } from "../money";

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
