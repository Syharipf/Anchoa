import { useState, type FormEvent } from "react";
import { api, type AccountView, type Categories, type TransactionView } from "../api";
import { dateInputToMs, msToDateInput } from "../format";
import { formatDigits, parseRupiah } from "../money";
import { Dialog, DialogActions, Field } from "../shell/Dialog";
import { FIELD } from "../shell/ui";
import { AccountSelect, MoneyField, Segmented } from "./fields";
import { useSave } from "./useSave";

type Kind = "expense" | "income" | "transfer";

const KINDS = [
  { value: "expense", label: "Pengeluaran" },
  { value: "income", label: "Pemasukan" },
  { value: "transfer", label: "Transfer" },
] as const;

// ponytail: remembered for this session only; persist it if people ask for it across restarts.
let lastAccountId: string | null = null;

function kindOf(t: TransactionView): Kind {
  if (t.transferId) return "transfer";
  return t.amount > 0 ? "income" : "expense";
}

/** Add or edit an expense, income or transfer. `accounts` must not be empty. */
export function TransactionForm({
  edit,
  accounts,
  categories,
  onClose,
  onSaved,
}: Readonly<{
  edit?: TransactionView;
  accounts: AccountView[];
  categories: Categories | null;
  onClose: () => void;
  onSaved: () => void;
}>) {
  const defaultAccount = accounts.find((a) => a.id === lastAccountId)?.id ?? accounts[0].id;
  const [kind, setKind] = useState<Kind>(edit ? kindOf(edit) : "expense");
  const [amount, setAmount] = useState(edit ? formatDigits(Math.abs(edit.amount)) : "");
  const [account, setAccount] = useState(edit?.accountId ?? defaultAccount);
  const [to, setTo] = useState(edit?.counterAccountId ?? accounts.find((a) => a.id !== account)?.id ?? account);
  const [category, setCategory] = useState(edit?.category ?? "");
  const [title, setTitle] = useState(edit?.title ?? "");
  const [date, setDate] = useState(msToDateInput(edit?.occurredAt ?? Date.now()));
  const [body, setBody] = useState(edit?.body ?? "");
  const { busy, run, toast } = useSave(onSaved);
  const suggestions = kind === "income" ? categories?.income : categories?.expense;
  // A saved transfer cannot become a plain transaction or the other way round (the backend refuses).
  const locked = (k: Kind) => edit !== undefined && (k === "transfer") !== (kind === "transfer");

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = parseRupiah(amount);
    const occurredAt = dateInputToMs(date);
    if (value === null || value <= 0) {
      toast("Jumlah harus angka bulat lebih dari 0", "error");
      return;
    }
    if (occurredAt === null) {
      toast("Tanggal wajib diisi", "error");
      return;
    }
    lastAccountId = account;
    void run(() =>
      kind === "transfer"
        ? api.saveTransfer({ transferId: edit?.transferId ?? undefined, fromAccountId: account, toAccountId: to, amount: value, occurredAt, title })
        : api.saveTransaction({ id: edit?.id, kind, amount: value, accountId: account, occurredAt, category, title, body }),
    );
  }

  const remove = edit ? () => void run(() => api.deleteTransaction(edit.id)) : undefined;

  return (
    <Dialog title={edit ? "Ubah transaksi" : "Transaksi baru"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Segmented label="Jenis transaksi" options={KINDS} value={kind} onChange={setKind} disabled={locked} />
        <MoneyField label="Jumlah" value={amount} onChange={setAmount} />
        {kind === "transfer" ? (
          <div className="grid grid-cols-2 gap-3">
            <AccountSelect label="Dari" accounts={accounts} value={account} onChange={setAccount} />
            <AccountSelect label="Ke" accounts={accounts} value={to} onChange={setTo} />
          </div>
        ) : (
          <>
            <AccountSelect label="Akun" accounts={accounts} value={account} onChange={setAccount} />
            <Field label="Kategori">
              <input list="finance-categories" value={category} onChange={(e) => setCategory(e.target.value)} className={FIELD} />
              <datalist id="finance-categories">
                {suggestions?.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
          </>
        )}
        <Field label="Keterangan">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={kind === "transfer" ? "Transfer" : "Tanpa keterangan"}
            className={FIELD}
          />
        </Field>
        <Field label="Tanggal">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} />
        </Field>
        {kind !== "transfer" && (
          <Field label="Catatan">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} className={`${FIELD} resize-none`} />
          </Field>
        )}
        <DialogActions busy={busy} onCancel={onClose} onDelete={remove} />
      </form>
    </Dialog>
  );
}
