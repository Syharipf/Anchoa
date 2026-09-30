import { useEffect, useState } from "react";
import { api, errorMessage, type Flow, type TransactionView } from "../api";
import { shortDate } from "../format";
import { formatRupiah, monthLabel, signedRupiah } from "../money";
import { useToast } from "../shell/toast";
import { H2, PANEL, ROW, SECONDARY } from "../shell/ui";
import { Segmented } from "./fields";
import { FinanceIcon } from "./icons";
import { groupByMonth, iconFor, isIncome, transactionMeta } from "./view";

const FLOWS = [
  { value: "all", label: "Semua" },
  { value: "in", label: "Masuk" },
  { value: "out", label: "Keluar" },
] as const;

function TransactionRow({ t, onEdit }: Readonly<{ t: TransactionView; onEdit: (t: TransactionView) => void }>) {
  const income = isIncome(t);
  return (
    <button onClick={() => onEdit(t)} className={`${ROW} flex items-center gap-3 px-2 py-2 text-left`}>
      <span className="w-12 shrink-0 font-mono text-xs text-muted">{shortDate(t.occurredAt)}</span>
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 ${income ? "text-accent" : "text-muted"}`}
      >
        <FinanceIcon name={iconFor(t)} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{t.title || "Tanpa keterangan"}</span>
        <span className="truncate text-xs text-muted">{transactionMeta(t)}</span>
      </span>
      {t.scheduled && <span className="shrink-0 rounded-md border border-line px-1.5 py-px text-[11px] text-muted">terjadwal</span>}
      <span className={`shrink-0 font-mono text-sm ${income ? "text-accent" : ""}`}>
        {t.transferId ? formatRupiah(t.amount) : signedRupiah(t.amount)}
      </span>
    </button>
  );
}

/** "Transaksi terbaru": everything up to the end of `until`, 50 rows at a time (spec Fase 2 §4). */
export function TransactionList({
  until,
  version,
  onEdit,
}: Readonly<{ until: string; version: number; onEdit: (t: TransactionView) => void }>) {
  const toast = useToast();
  const [flow, setFlow] = useState<Flow>("all");
  const [items, setItems] = useState<TransactionView[] | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    api.listTransactions(until, flow, 0).then(
      (page) => {
        setItems(page.items);
        setMore(page.more);
      },
      (e) => toast(errorMessage(e), "error"),
    );
  }, [until, flow, version, toast]);

  const loadMore = () =>
    api.listTransactions(until, flow, items?.length ?? 0).then(
      (page) => {
        setItems((list) => [...(list ?? []), ...page.items]);
        setMore(page.more);
      },
      (e) => toast(errorMessage(e), "error"),
    );

  return (
    <section aria-labelledby="transaksi-judul" className={`${PANEL} flex flex-col gap-2`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="transaksi-judul" className={H2}>
          Transaksi terbaru
        </h2>
        <div className="w-[220px]">
          <Segmented label="Filter transaksi" options={FLOWS} value={flow} onChange={setFlow} />
        </div>
      </div>
      {items?.length === 0 && <p className="m-0 py-6 text-center text-sm text-muted">Tidak ada transaksi untuk filter ini.</p>}
      {groupByMonth(items ?? []).map((g) => (
        <div key={g.month} className="flex flex-col">
          <span className="px-2 pt-2 pb-1 text-[11px] tracking-[0.08em] text-muted uppercase">{monthLabel(g.month)}</span>
          {g.items.map((t) => (
            <TransactionRow key={t.id} t={t} onEdit={onEdit} />
          ))}
        </div>
      ))}
      {more && (
        <button onClick={() => void loadMore()} className={`${SECONDARY} self-center`}>
          Muat lagi
        </button>
      )}
    </section>
  );
}
