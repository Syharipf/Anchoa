import { useState, type FormEvent } from "react";
import { api, type AccountView, type BillView, type Repeat } from "../api";
import { dateInputToMs, msToDateInput } from "../format";
import { formatDigits, parseRupiah } from "../money";
import { Dialog, DialogActions, Field } from "../shell/Dialog";
import { FIELD } from "../shell/ui";
import { AccountSelect, MoneyField, Segmented } from "./fields";
import { useSave } from "./useSave";

const REPEATS = [
  { value: "once", label: "Sekali" },
  { value: "monthly", label: "Bulanan" },
] as const;

/** Add or edit a bill. `accounts` must not be empty. */
export function BillForm({
  edit,
  accounts,
  onClose,
  onSaved,
}: Readonly<{ edit?: BillView; accounts: AccountView[]; onClose: () => void; onSaved: () => void }>) {
  const [name, setName] = useState(edit?.name ?? "");
  const [amount, setAmount] = useState(edit ? formatDigits(edit.amount) : "");
  const [account, setAccount] = useState(edit?.accountId ?? accounts[0].id);
  const [repeat, setRepeat] = useState<Repeat>(edit?.repeat ?? "monthly");
  const [due, setDue] = useState(msToDateInput(edit?.dueAt ?? Date.now()));
  const { busy, run, toast } = useSave(onSaved);

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = parseRupiah(amount);
    const dueAt = dateInputToMs(due);
    if (value === null || value <= 0) {
      toast("Jumlah harus angka bulat lebih dari 0", "error");
      return;
    }
    if (dueAt === null) {
      toast("Jatuh tempo wajib diisi", "error");
      return;
    }
    void run(() => api.saveBill({ id: edit?.id, name, amount: value, accountId: account, repeat, dueAt }));
  }

  const remove = edit ? () => void run(() => api.deleteBill(edit.id)) : undefined;

  return (
    <Dialog title={edit ? "Ubah tagihan" : "Tagihan baru"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Nama">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Listrik, Internet, Kos…" className={FIELD} />
        </Field>
        <MoneyField label="Jumlah" value={amount} onChange={setAmount} />
        <AccountSelect label="Dibayar dari" accounts={accounts} value={account} onChange={setAccount} />
        <Segmented label="Pengulangan" options={REPEATS} value={repeat} onChange={setRepeat} />
        <Field label="Jatuh tempo">
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={FIELD} />
        </Field>
        <DialogActions busy={busy} onCancel={onClose} onDelete={remove} />
      </form>
    </Dialog>
  );
}
