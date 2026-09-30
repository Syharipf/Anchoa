import type { BudgetLevel, FinanceSummary } from "../api";
import { billChip } from "../finance/view";
import { formatBalance, formatRupiah } from "../money";
import type { PageId } from "../shell/nav";
import { H2, PANEL } from "../shell/ui";

const CHIP = { danger: "bg-danger-row text-danger", ink: "bg-surface-2 text-ink", accent: "bg-surface-2 text-accent" } as const;
const LEVEL_TEXT: Record<BudgetLevel, string> = { ok: "text-muted", warn: "text-warn", over: "text-danger" };

/** Bento card: balance, spent this month against the limit, and the bill chip. Opens Keuangan. */
export function FinanceCard({ finance, onSelect }: Readonly<{ finance?: FinanceSummary; onSelect: (page: PageId) => void }>) {
  const chip = finance ? billChip(finance.dueBills) : null;
  return (
    <button
      onClick={() => onSelect("keuangan")}
      className={`${PANEL} flex flex-col items-start gap-1.5 text-left transition-colors hover:bg-surface-2`}
    >
      <span className={`${H2} block`}>Keuangan</span>
      {finance && !finance.hasAccounts && <span className="text-xs text-muted">Belum ada akun</span>}
      {finance?.hasAccounts && chip && (
        <>
          <span className={`font-display text-[22px] font-semibold ${finance.balance < 0 ? "text-danger" : ""}`}>
            {formatBalance(finance.balance)}
          </span>
          <span className={`text-xs ${LEVEL_TEXT[finance.budget?.level ?? "ok"]}`}>
            Keluar bulan ini {formatRupiah(finance.expense)}
            {finance.budget && ` dari ${formatRupiah(finance.budget.amount)}`}
          </span>
          <span className={`mt-1 rounded-md px-2 py-0.5 text-xs ${CHIP[chip.tone]}`}>{chip.text}</span>
        </>
      )}
    </button>
  );
}
