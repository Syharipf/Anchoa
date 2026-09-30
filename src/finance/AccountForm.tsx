import { useState, type FormEvent } from "react";
import { api, type AccountKind, type AccountView } from "../api";
import { formatDigits, parseRupiah } from "../money";
import { Dialog, DialogActions, Field } from "../shell/Dialog";
import { FIELD } from "../shell/ui";
import { MoneyField } from "./fields";
import { useSave } from "./useSave";
import { KIND_LABELS } from "./view";

const KINDS = Object.entries(KIND_LABELS) as [AccountKind, string][];

/** Add or edit an account. `note` explains why the form opened, e.g. "Buat akun dulu". */
export function AccountForm({
  edit,
  note,
  onClose,
  onSaved,
}: Readonly<{ edit?: AccountView; note?: string; onClose: () => void; onSaved: () => void }>) {
  const [name, setName] = useState(edit?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(edit?.kind ?? "bank");
  const [opening, setOpening] = useState(edit ? formatDigits(edit.openingBalance) : "");
  const { busy, run, toast } = useSave(onSaved);

  function submit(e: FormEvent) {
    e.preventDefault();
    // Empty means zero. A negative opening balance is debt, e.g. on a credit card.
    const openingBalance = opening.trim() === "" ? 0 : parseRupiah(opening);
    if (openingBalance === null) {
      toast("Saldo awal harus angka bulat", "error");
      return;
    }
    void run(() => api.saveAccount({ id: edit?.id, name, kind, openingBalance }));
  }

  const remove = edit ? () => void run(() => api.deleteAccount(edit.id)) : undefined;

  return (
    <Dialog title={edit ? "Ubah akun" : "Akun baru"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {note && <p className="m-0 rounded-[10px] bg-surface-2 px-3 py-2 text-sm text-ink">{note}</p>}
        <Field label="Nama">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="BCA, GoPay, Tunai…" className={FIELD} />
        </Field>
        <Field label="Jenis">
          <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)} className={FIELD}>
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <MoneyField label="Saldo awal" value={opening} onChange={setOpening} />
        <DialogActions busy={busy} onCancel={onClose} onDelete={remove} />
      </form>
    </Dialog>
  );
}
