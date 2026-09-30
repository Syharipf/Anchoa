import { useEffect, useState, type ReactNode } from "react";
import {
  api,
  errorMessage,
  type AccountView,
  type BillView,
  type Categories,
  type FinanceOverview,
  type TransactionView,
} from "../api";
import { addMonths, formatRupiah, monthLabel } from "../money";
import { useToast } from "../shell/toast";
import { H1, PRIMARY, SECONDARY } from "../shell/ui";
import { AccountForm } from "./AccountForm";
import { AccountsSection } from "./AccountsSection";
import { BillForm } from "./BillForm";
import { BillsSection } from "./BillsSection";
import { BudgetForm } from "./BudgetForm";
import { CashFlowChart } from "./CashFlowChart";
import { SummaryCards } from "./SummaryCards";
import { TransactionForm } from "./TransactionForm";
import { TransactionList } from "./TransactionList";

/** The form open over the page, if any. */
type OpenForm =
  | { form: "transaction"; edit?: TransactionView }
  | { form: "account"; edit?: AccountView }
  | { form: "bill"; edit?: BillView }
  | { form: "budget" }
  | null;

const MONTH_NAV =
  "flex h-8 w-8 items-center justify-center rounded-lg text-ink transition-colors hover:bg-surface-2 disabled:text-disabled disabled:hover:bg-transparent";

function Chevron({ d }: Readonly<{ d: string }>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Keuangan page (docs/design/artboards/Keuangan.dc.html, spec Fase 2 §5). */
export function FinancePage({ newTransaction, onChanged }: Readonly<{ newTransaction: boolean; onChanged: () => void }>) {
  const toast = useToast();
  const [month, setMonth] = useState<string | null>(null);
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [accounts, setAccounts] = useState<AccountView[] | null>(null);
  const [bills, setBills] = useState<BillView[] | null>(null);
  const [categories, setCategories] = useState<Categories | null>(null);
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState<OpenForm>(newTransaction ? { form: "transaction" } : null);

  useEffect(() => {
    api.financeOverview(month).then(setOverview, (e) => toast(errorMessage(e), "error"));
  }, [month, version, toast]);

  useEffect(() => {
    const fail = (e: unknown) => toast(errorMessage(e), "error");
    api.listAccounts().then(setAccounts, fail);
    api.listBills().then(setBills, fail);
    api.financeCategories().then(setCategories, fail);
  }, [version, toast]);

  if (!overview || !accounts || !bills) return <h1 className={H1}>Keuangan</h1>;

  const close = () => setOpen(null);
  const refresh = () => {
    setVersion((v) => v + 1);
    onChanged();
  };
  const saved = () => {
    setOpen(null);
    refresh();
  };
  const pay = (bill: BillView) =>
    api.payBill(bill.id).then(
      (paid) => {
        refresh();
        toast(`Tercatat ${formatRupiah(bill.amount)}`, "info", {
          label: "Ubah",
          run: () => setOpen({ form: "transaction", edit: paid }),
        });
      },
      (e) => toast(errorMessage(e), "error"),
    );

  const form = (): ReactNode => {
    if (open === null) return null;
    if (open.form === "account") return <AccountForm edit={open.edit} onClose={close} onSaved={saved} />;
    if (open.form === "budget") return <BudgetForm current={overview.budget?.amount ?? null} onClose={close} onSaved={saved} />;
    if (accounts.length === 0) return <AccountForm note="Buat akun dulu" onClose={close} onSaved={saved} />;
    if (open.form === "bill") return <BillForm edit={open.edit} accounts={accounts} onClose={close} onSaved={saved} />;
    return <TransactionForm edit={open.edit} accounts={accounts} categories={categories} onClose={close} onSaved={saved} />;
  };

  return (
    <>
      <div className="flex items-center gap-4">
        <h1 className={H1}>Keuangan</h1>
        <div className="flex items-center gap-1">
          <button aria-label="Bulan sebelumnya" onClick={() => setMonth(addMonths(overview.month, -1))} className={MONTH_NAV}>
            <Chevron d="M15 6l-6 6 6 6" />
          </button>
          <span aria-live="polite" className="min-w-[150px] text-center font-display text-base font-semibold">
            {monthLabel(overview.month)}
          </span>
          <button
            aria-label="Bulan berikutnya"
            disabled={overview.month >= overview.currentMonth}
            onClick={() => setMonth(addMonths(overview.month, 1))}
            className={MONTH_NAV}
          >
            <Chevron d="M9 6l6 6-6 6" />
          </button>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            disabled
            title="Hadir di Fase 5"
            className={`${SECONDARY} disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent`}
          >
            Catat lewat suara
          </button>
          <button onClick={() => setOpen({ form: "transaction" })} className={PRIMARY}>
            + Transaksi
          </button>
        </div>
      </div>
      <SummaryCards overview={overview} onBudget={() => setOpen({ form: "budget" })} />
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] items-start gap-3.5">
        <div className="flex min-w-0 flex-col gap-3.5">
          <CashFlowChart chart={overview.chart} month={overview.month} onPick={setMonth} />
          <TransactionList until={overview.month} version={version} onEdit={(t) => setOpen({ form: "transaction", edit: t })} />
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <AccountsSection
            accounts={accounts}
            onAdd={() => setOpen({ form: "account" })}
            onEdit={(a) => setOpen({ form: "account", edit: a })}
          />
          <BillsSection
            bills={bills}
            onAdd={() => setOpen({ form: "bill" })}
            onEdit={(b) => setOpen({ form: "bill", edit: b })}
            onPay={(b) => void pay(b)}
          />
        </div>
      </div>
      {form()}
    </>
  );
}
