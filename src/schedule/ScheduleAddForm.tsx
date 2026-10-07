import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../api";
import { dateInputToMs } from "../format";
import { Dialog, DialogActions, Field } from "../shell/Dialog";
import { FIELD } from "../shell/ui";

/** Pure validation so tests can pin it without rendering. */
export function validateScheduleInput(
  title: string,
  date: string,
): { dueAt: number } | { error: string } {
  if (title.trim() === "") return { error: "Judul tidak boleh kosong" };
  const dueAt = dateInputToMs(date);
  if (dueAt === null) return { error: `Tanggal tidak valid: ${date}` };
  return { dueAt };
}

/** Manual add: title + date, wired to the reused `create_task` command. */
export function ScheduleAddForm({
  defaultDate,
  onClose,
  onSaved,
}: Readonly<{
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void;
}>) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const checked = validateScheduleInput(title, date);
    if ("error" in checked) {
      setError(checked.error);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.createTask({ title: title.trim(), status: "plan", dueAt: checked.dueAt });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Tugas baru" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <Field label="Judul">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Apa yang perlu dikerjakan?"
            className={FIELD}
          />
        </Field>
        <Field label="Tanggal">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={FIELD}
          />
        </Field>
        {error !== null && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {error}
          </p>
        )}
        <DialogActions busy={busy} onCancel={onClose} />
      </form>
    </Dialog>
  );
}
