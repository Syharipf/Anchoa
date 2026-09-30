import { useState, type FormEvent } from "react";
import { api } from "../api";
import { formatDigits, parseRupiah } from "../money";
import { Dialog, DialogActions } from "../shell/Dialog";
import { MoneyField } from "./fields";
import { useSave } from "./useSave";

/** The one monthly spending limit (spec K11). It only warns; transactions are never refused. */
export function BudgetForm({
  current,
  onClose,
  onSaved,
}: Readonly<{ current: number | null; onClose: () => void; onSaved: () => void }>) {
  const [amount, setAmount] = useState(current === null ? "" : formatDigits(current));
  const { busy, run, toast } = useSave(onSaved);

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = parseRupiah(amount);
    if (value === null || value <= 0) {
      toast("Batas harus angka bulat lebih dari 0", "error");
      return;
    }
    void run(() => api.setBudget(value));
  }

  const remove = current === null ? undefined : () => void run(() => api.setBudget(null));

  return (
    <Dialog title="Batas pengeluaran bulanan" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="m-0 text-sm text-muted">Berlaku setiap bulan. Hanya peringatan: transaksi tetap bisa dicatat.</p>
        <MoneyField label="Batas per bulan" value={amount} onChange={setAmount} />
        <DialogActions busy={busy} onCancel={onClose} onDelete={remove} deleteLabel="Hapus batas" />
      </form>
    </Dialog>
  );
}
