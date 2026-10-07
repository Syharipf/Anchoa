import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../api";
import { monthLabel } from "../money";
import { Dialog, DialogActions, Field } from "../shell/Dialog";
import { FIELD } from "../shell/ui";
import { useToast } from "../shell/toast";
import { exportFinanceRecap } from "./exportPdf";
import { Segmented } from "./fields";

export type RecapKind = "monthly" | "yearly";

const KINDS = [
  { value: "monthly", label: "Bulanan" },
  { value: "yearly", label: "Tahunan" },
] as const;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const YEAR = /^\d{4}$/;


/** Picks Bulanan or Tahunan plus the period, then writes the recap PDF into a folder. */
export function ExportPdfDialog({ month, onClose }: Readonly<{ month: string; onClose: () => void }>) {
  const toast = useToast();
  const [kind, setKind] = useState<RecapKind>("monthly");
  const [monthValue, setMonthValue] = useState(month);
  const [year, setYear] = useState(month.slice(0, 4));
  const [busy, setBusy] = useState(false);
  const period = kind === "monthly" ? monthValue : year;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!(kind === "monthly" ? MONTH : YEAR).test(period)) {
      toast(kind === "monthly" ? "Pilih bulan yang valid" : "Tahun harus 4 angka", "error");
      return;
    }
    setBusy(true);
    const dir = await api.pickDirectory();
    if (!dir) { setBusy(false); return; }
    try {
      const path = await exportFinanceRecap(dir, kind, period);
      toast(`Rekap ${kind === "monthly" ? monthLabel(period) : period} disimpan ke ${path}`, "info");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Ekspor Rekap PDF" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Segmented label="Jenis rekap" options={KINDS} value={kind} onChange={setKind} />
        {kind === "monthly" ? (
          <Field label="Bulan">
            <input type="month" value={monthValue} onChange={(e) => setMonthValue(e.target.value)} className={FIELD} />
          </Field>
        ) : (
          <Field label="Tahun">
            <input
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className={FIELD}
            />
          </Field>
        )}
        <p className="m-0 text-xs text-muted">
          Berisi ringkasan, grafik arus kas, diagram kategori, dan tabel per kategori.
        </p>
        <DialogActions busy={busy} onCancel={onClose} />
      </form>
    </Dialog>
  );
}
