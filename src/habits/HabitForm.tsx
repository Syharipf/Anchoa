import { useState, type FormEvent } from "react";
import { api, type HabitRow } from "../api";
import { useSave } from "../finance/useSave";
import { Dialog, DialogActions, Field } from "../shell/Dialog";
import { FIELD } from "../shell/ui";
import { DAY_INITIALS, DAY_NAMES, resolveRemindOn, toggleDay } from "./view";

export function HabitForm({
  edit,
  onClose,
  onSaved,
}: Readonly<{
  edit?: HabitRow | null;
  onClose: () => void;
  onSaved: (id?: string) => void;
}>) {
  const [name, setName] = useState(edit?.name ?? "");
  const [remindAt, setRemindAt] = useState(edit?.remindAt ?? "");
  const [days, setDays] = useState(edit?.days ?? 127);
  const { busy, run, toast } = useSave(() => {});

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast("Nama habit tidak boleh kosong", "error");
      return;
    }
    const trimmedTime = remindAt.trim();
    const validRemindAt = trimmedTime === "" ? null : trimmedTime;
    void run(async () => {
      const saved = await api.saveHabit({
        id: edit?.id,
        name: trimmed,
        days,
        remindAt: validRemindAt,
        remindOn: resolveRemindOn(validRemindAt, edit),
      });
      onSaved(saved.id);
    });
  }

  const remove = edit
    ? () =>
        void run(async () => {
          await api.deleteHabit(edit.id);
          onSaved();
        })
    : undefined;

  return (
    <Dialog title={edit ? "Ubah habit" : "Habit baru"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <Field label="Nama">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama habit…"
            className={FIELD}
          />
        </Field>

        <Field label="Jam pengingat (opsional)">
          <input
            type="time"
            value={remindAt}
            onChange={(e) => setRemindAt(e.target.value)}
            className={FIELD}
          />
        </Field>

        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1 text-xs text-muted">Hari aktif</legend>
          <div className="grid grid-cols-7 gap-1">
            {DAY_INITIALS.map((init, i) => {
              const active = (days & (1 << i)) !== 0;
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={active}
                  aria-label={DAY_NAMES[i]}
                  onClick={() => setDays((prev) => toggleDay(prev, i))}
                  className={`h-9 rounded-lg border text-xs font-medium transition-colors ${
                    active
                      ? "border-field-focus bg-surface-2 text-ink"
                      : "border-line bg-transparent text-[#5b6475] hover:border-disabled"
                  }`}
                >
                  {init}
                </button>
              );
            })}
          </div>
        </fieldset>

        <DialogActions busy={busy} onCancel={onClose} onDelete={remove} />
      </form>
    </Dialog>
  );
}
