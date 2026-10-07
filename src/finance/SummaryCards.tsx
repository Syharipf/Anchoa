import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { FishProgress } from "../components/FishProgress";
import type { FinanceOverview } from "../api";
import { formatBalance, formatRupiah, monthLabel, monthShort, signedRupiah } from "../money";

const MONEY_STORAGE_KEY = "anchoa.money.hidden";

function loadMoneyHidden(): boolean {
  try { return localStorage.getItem(MONEY_STORAGE_KEY) === "1"; } catch { return false; }
}
function saveMoneyHidden(hidden: boolean): void {
  try { localStorage.setItem(MONEY_STORAGE_KEY, hidden ? "1" : "0"); } catch {}
}

const CARD = "rounded-[14px] border border-line bg-surface p-4 sm:p-[18px] flex flex-col gap-1.5";
const VALUE = "font-mono text-2xl font-medium";

function Card({ label, value, tone = "", note, action }: Readonly<{ label: string; value: string; tone?: string; note: string; action?: ReactNode }>) {
  return (
    <section className={CARD}>
      <span className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{label}</span>
        {action}
      </span>
      <span className={`${VALUE} ${tone}`}>{value}</span>
      <span className="text-xs text-muted">{note}</span>
    </section>
  );
}

/** Saldo, Pemasukan, Pengeluaran (with the monthly limit) and Arus bersih. */
export function SummaryCards({ overview: o, onBudget }: Readonly<{ overview: FinanceOverview; onBudget: () => void }>) {
  const [moneyHidden, setMoneyHidden] = useState(loadMoneyHidden);
  useEffect(() => saveMoneyHidden(moneyHidden), [moneyHidden]);
  const used = o.budget ? Math.min(100, Math.round((o.expense * 100) / o.budget.amount)) : 0;
  const eye = (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); setMoneyHidden((c) => !c); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setMoneyHidden((c) => !c); } }}
      className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[9px] text-muted transition-colors hover:bg-surface"
      aria-label={moneyHidden ? "Tampilkan saldo" : "Sembunyikan saldo"}
    >
      {moneyHidden ? "•••" : "₡"}
    </span>
  );
  return (
    <div className="grid grid-cols-4 gap-3.5">
      <Card
        label="Saldo total"
        value={moneyHidden ? "•••" : formatBalance(o.balance)}
        tone={o.balance < 0 ? "text-danger" : ""}
        note={`${o.accountCount} akun · per hari ini`}
        action={eye}
      />
      <Card
        label={`Pemasukan ${monthShort(o.month)}`}
        value={formatRupiah(o.income)}
        tone={o.income > 0 ? "text-accent" : ""}
        note={monthLabel(o.month)}
      />
      <button
        onClick={onBudget}
        aria-label={`Pengeluaran ${monthLabel(o.month)} ${formatRupiah(o.expense)}. Atur batas pengeluaran`}
        className={`${CARD} text-left transition-colors hover:bg-surface-2`}
      >
        <span className="text-xs text-muted">Pengeluaran {monthShort(o.month)}</span>
        <span className={VALUE}>{formatRupiah(o.expense)}</span>
        {o.budget ? (
          <>
            <span className="text-xs text-muted">dari {formatRupiah(o.budget.amount)}</span>
            <FishProgress
              role="meter"
              value={used}
              label={`Pemakaian anggaran ${monthLabel(o.month)}`}
              tone={o.budget.level === "over" ? "danger" : o.budget.level === "warn" ? "warning" : "accent"}
              className="mt-1 h-2"
            />
          </>
        ) : (
          <span className="text-xs text-muted">Atur batas</span>
        )}
      </button>
      <Card
        label="Arus bersih"
        value={signedRupiah(o.net)}
        tone={o.net < 0 ? "text-danger" : "text-accent"}
        note="pemasukan − pengeluaran"
      />
    </div>
  );
}
