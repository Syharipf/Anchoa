import type { BillView } from "../api";
import { formatRupiah } from "../money";
import { H2, PANEL } from "../shell/ui";
import { FinanceIcon } from "./icons";
import { billStatusText } from "./view";

function BillRow({
  bill: b,
  onEdit,
  onPay,
}: Readonly<{ bill: BillView; onEdit: (bill: BillView) => void; onPay: (bill: BillView) => void }>) {
  const late = b.status === "overdue";
  const payable = late || b.status === "dueToday";
  return (
    <div className={`flex items-center gap-2 rounded-lg px-2 py-2 ${late ? "bg-danger-row" : ""}`}>
      <button onClick={() => onEdit(b)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-warn">
          <FinanceIcon name="bill" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm">{b.name}</span>
          <span className={`text-xs ${late ? "text-danger" : "text-muted"}`}>{billStatusText(b)}</span>
        </span>
      </button>
      {payable && (
        <button
          onClick={() => onPay(b)}
          className="min-h-8 shrink-0 rounded-full bg-accent px-3 text-xs font-semibold text-canvas transition-transform hover:scale-105 active:scale-95"
        >
          Tandai lunas
        </button>
      )}
      {b.status === "upcoming" && <span className="shrink-0 font-mono text-sm">{formatRupiah(b.amount)}</span>}
      {b.status === "paidToday" && <span className="shrink-0 text-xs text-accent">✓ Lunas</span>}
    </div>
  );
}

/** "Tagihan": every unfinished bill, soonest first, with "Tandai lunas" once it is due (spec Fase 2 §5). */
export function BillsSection({
  bills,
  onAdd,
  onEdit,
  onPay,
}: Readonly<{ bills: BillView[]; onAdd: () => void; onEdit: (bill: BillView) => void; onPay: (bill: BillView) => void }>) {
  return (
    <section aria-labelledby="tagihan-judul" className={`${PANEL} flex flex-col gap-2`}>
      <div className="flex items-center justify-between">
        <h2 id="tagihan-judul" className={H2}>
          Tagihan
        </h2>
        <button onClick={onAdd} className="text-xs text-accent hover:text-accent-hover">
          + Tambah
        </button>
      </div>
      {bills.length === 0 && <p className="m-0 text-sm text-muted">Belum ada tagihan</p>}
      {bills.map((b) => (
        <BillRow key={b.id} bill={b} onEdit={onEdit} onPay={onPay} />
      ))}
    </section>
  );
}
