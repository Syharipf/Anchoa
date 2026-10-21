import { useState, type FormEvent } from "react";
import { api, type AccountView, type BillView, type Repeat } from "../api";
import { dateInputToMs, msToDateInput } from "../format";
import { formatDigits, parseRupiah } from "../money";
import { Dialog, DialogActions, Field } from "../shell/Dialog";
import { FIELD } from "../shell/ui";
import { AccountSelect, MoneyField, Segmented } from "./fields";
import { useSave } from "./useSave";

const REPEATS = [
  { value: "once", label: "Once" },
  { value: "monthly", label: "Monthly" },
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
      toast("Amount must be a whole number greater than 0", "error");
      return;
    }
    if (dueAt === null) {
      toast("Due date is required", "error");
      return;
    }
    void run(() => api.saveBill({ id: edit?.id, name, amount: value, accountId: account, repeat, dueAt }));
  }

  const remove = edit ? () => void run(() => api.deleteBill(edit.id)) : undefined;

  return (
    <Dialog title={edit ? "Edit bill" : "New bill"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Electricity, Internet, Rent…" className={FIELD} />
        </Field>
        <MoneyField label="Amount" value={amount} onChange={setAmount} />
        <AccountSelect label="Paid from" accounts={accounts} value={account} onChange={setAccount} />
        <Segmented label="Repeat" options={REPEATS} value={repeat} onChange={setRepeat} />
        <Field label="Due date">
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={FIELD} />
        </Field>
        <DialogActions busy={busy} onCancel={onClose} onDelete={remove} />
      </form>
    </Dialog>
  );
}
