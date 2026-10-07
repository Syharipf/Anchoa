import { useEffect, useState } from "react";
import type { BudgetLevel, FinanceSummary } from "../api";
import { billChip } from "../finance/view";
import { formatBalance, formatRupiah } from "../money";
import type { PageId } from "../shell/nav";

const CHIP = { danger: "border-danger bg-danger-row text-danger", ink: "border-line bg-surface-2 text-muted", accent: "border-accent bg-surface-2 text-accent" } as const;
const DOT = { danger: "bg-danger", ink: "bg-muted", accent: "bg-accent" } as const;
const LEVEL_TEXT: Record<BudgetLevel, string> = { ok: "text-muted", warn: "text-warn", over: "text-danger" };

const MONEY_STORAGE_KEY = "anchoa.money.hidden";

function loadMoneyHidden(): boolean {
  try { return localStorage.getItem(MONEY_STORAGE_KEY) === "1"; } catch { return false; }
}
function saveMoneyHidden(hidden: boolean): void {
  try { localStorage.setItem(MONEY_STORAGE_KEY, hidden ? "1" : "0"); } catch {}
}

/** Bento card: balance, spent this month against the limit, and the bill chip. Opens Keuangan. */
export function FinanceCard({ finance, onSelect }: Readonly<{ finance?: FinanceSummary; onSelect: (page: PageId) => void }>) {
  const [moneyHidden, setMoneyHidden] = useState(loadMoneyHidden);
  useEffect(() => saveMoneyHidden(moneyHidden), [moneyHidden]);

  const chip = finance ? billChip(finance.dueBills) : null;
  return (
    <button
      type="button"
      onClick={() => onSelect("keuangan")}
      className="flex flex-col items-start gap-1.5 overflow-hidden rounded-[14px] border border-line bg-surface p-3 px-3.5 text-left text-ink transition-colors hover:bg-surface-2"
    >
      <div className="flex w-full items-center gap-2">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted"
          aria-hidden="true"
        >
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <path d="M16 12.5h2" />
          <path d="M3 10h18" />
        </svg>
        <span id="c-uang" className="font-display text-sm font-semibold text-ink">Keuangan</span>
        <span className="ml-auto text-xs text-accent">›</span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); setMoneyHidden((c) => !c); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setMoneyHidden((c) => !c); } }}
          className="rounded-full bg-surface-2 p-2 text-xs text-muted transition-colors hover:bg-surface"
          aria-label={moneyHidden ? "Tampilkan saldo" : "Sembunyikan saldo"}
        >
          {moneyHidden ? "••••••" : "👁"}
        </span>
      </div>
      {finance && !finance.hasAccounts && <span className="text-xs text-muted">Belum ada akun</span>}
      {finance?.hasAccounts && chip && (
        <>
          {moneyHidden || (
            <span className="text-[11px] uppercase tracking-[0.08em] text-muted">Saldo</span>
          )}
          {moneyHidden || (
            <span className={`font-mono text-[22px] font-medium leading-[1.1] ${finance.balance < 0 ? "text-danger" : ""}`}>
              {formatBalance(finance.balance)}
            </span>
          )}
          <span className={`text-xs ${LEVEL_TEXT[finance.budget?.level ?? "ok"]}`}>
            Keluar bulan ini {formatRupiah(finance.expense)}
            {finance.budget && ` dari ${formatRupiah(finance.budget.amount)}`}
          </span>
          <span className={`mt-auto flex items-center gap-1.5 self-start rounded-full border px-2.5 py-[3px] text-xs ${CHIP[chip.tone]}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${DOT[chip.tone]}`} />
            {chip.text}
          </span>
        </>
      )}
    </button>
  );
}