import type { AccountView } from "../api";
import { formatBalance } from "../money";
import { H2, PANEL, ROW, SECONDARY } from "../shell/ui";
import { FinanceIcon } from "./icons";
import { accountShares, KIND_LABELS } from "./view";

/** Colours of the stacked share bar, in account order. */
const SEGMENTS = ["bg-accent", "bg-heat-2", "bg-heat-3", "bg-muted"];

export function AccountsSection({
  accounts,
  onAdd,
  onEdit,
}: Readonly<{ accounts: AccountView[]; onAdd: () => void; onEdit: (account: AccountView) => void }>) {
  const shares = accountShares(accounts);
  return (
    <section aria-labelledby="akun-judul" className={`${PANEL} flex flex-col gap-3`}>
      <div className="flex items-center justify-between">
        <h2 id="akun-judul" className={H2}>
          Akun
        </h2>
        <button onClick={onAdd} className="text-xs text-accent hover:text-accent-hover">
          + Tambah
        </button>
      </div>
      {accounts.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 text-sm text-muted">Belum ada akun</p>
          <button onClick={onAdd} className={SECONDARY}>
            Buat akun
          </button>
        </div>
      ) : (
        <>
          <div aria-hidden="true" className="flex h-1.5 gap-[3px]">
            {[...shares].map(([id, share], i) => (
              <span key={id} className={`rounded-[3px] ${SEGMENTS[i % SEGMENTS.length]}`} style={{ width: `${share}%` }} />
            ))}
          </div>
          <div className="flex flex-col">
            {accounts.map((a) => {
              const share = shares.get(a.id);
              return (
                <button key={a.id} onClick={() => onEdit(a)} className={`${ROW} flex items-center gap-3 px-2 py-2 text-left`}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
                    <FinanceIcon name={a.kind} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm">{a.name}</span>
                    <span className="text-xs text-muted">{share === undefined ? KIND_LABELS[a.kind] : `${share}% saldo`}</span>
                  </span>
                  <span className={`font-mono text-sm ${a.balance < 0 ? "text-danger" : ""}`}>{formatBalance(a.balance)}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
