import { useState, type FormEvent } from "react";
import { api, type HabitRow } from "../api";
import { useSave } from "../finance/useSave";
import { Dialog, DialogActions, Field } from "../shell/Dialog";
import { FIELD } from "../shell/ui";
import { DAY_INITIALS, DAY_NAMES, resolveRemindOn, toggleDay } from "./view";

export const HABIT_CATEGORIES = [
  { id: "kesehatan", label: "Kesehatan", defaultIcon: "🏃" },
  { id: "belajar", label: "Belajar", defaultIcon: "📚" },
  { id: "produktivitas", label: "Produktivitas", defaultIcon: "⚡" },
  { id: "keuangan", label: "Keuangan", defaultIcon: "💰" },
  { id: "mindfulness", label: "Mindfulness", defaultIcon: "🧘" },
] as const;

export const EMOJI_OPTIONS = ["🏃", "💧", "📚", "⚡", "🧘", "💰", "💪", "🍎", "🛌", "✍️", "🎯", "🚶"];

const TARGET_OPTIONS = [
  { label: "Tanpa Target", value: 0 },
  { label: "30 Hari (Challenge)", value: 30 },
  { label: "66 Hari (Pembentukan Otomatis)", value: 66 },
  { label: "100 Hari (Mastery)", value: 100 },
];

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
  const [category, setCategory] = useState<string>(edit?.category ?? "kesehatan");
  const [icon, setIcon] = useState<string>(edit?.icon ?? "🏃");
  const [targetDays, setTargetDays] = useState<number>(edit?.targetDays ?? 0);
  const [archived, setArchived] = useState<boolean>(edit?.archived ?? false);
  const [remindAt, setRemindAt] = useState(edit?.remindAt ?? "");
  const [days, setDays] = useState(edit?.days ?? 127);
  const autoJournal = edit?.autoJournal ?? false;
  const { busy, run, toast } = useSave(() => {});

  function handleSelectCategory(catId: string) {
    setCategory(catId);
    const cat = HABIT_CATEGORIES.find((c) => c.id === catId);
    if (cat && (!icon || EMOJI_OPTIONS.includes(icon))) {
      setIcon(cat.defaultIcon);
    }
  }

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
        category,
        icon,
        targetDays: targetDays > 0 ? targetDays : null,
        archived,
        days,
        remindAt: validRemindAt,
        remindOn: resolveRemindOn(validRemindAt, edit),
        autoJournal,
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
      <form onSubmit={submit} className="flex flex-col gap-4">
        {/* Category & Icon Selector */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-muted font-medium">Kategori</label>
          <div className="flex flex-wrap gap-1.5">
            {HABIT_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleSelectCategory(c.id)}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                  category === c.id
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-line bg-stage text-muted hover:text-ink"
                }`}
              >
                <span>{c.defaultIcon}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Emoji picker row */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted font-medium">Ikon Kebiasaan</label>
          <div className="flex flex-wrap gap-1.5">
            {EMOJI_OPTIONS.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => setIcon(em)}
                className={`flex h-8 w-8 items-center justify-center rounded-lg border text-base transition-transform ${
                  icon === em
                    ? "border-accent bg-surface-2 scale-110 shadow-sm"
                    : "border-line bg-stage hover:border-muted"
                }`}
              >
                {em}
              </button>
            ))}
          </div>
        </div>

        <Field label="Nama Habit">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Misalnya: Minum 2L air, Membaca 15 menit…"
            className={FIELD}
          />
        </Field>

        {/* Target Challenge */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted font-medium">Target / Tantangan</label>
          <select
            value={targetDays}
            onChange={(e) => setTargetDays(Number(e.target.value))}
            className={`${FIELD} py-1.5`}
          >
            {TARGET_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

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

        {edit && (
          <div className="flex items-center justify-between border-t border-line pt-3">
            <div className="flex flex-col">
              <span className="text-xs font-medium text-ink">Arsipkan Habit</span>
              <span className="text-[11px] text-muted">
                Sembunyikan dari daftar harian tanpa menghapus riwayat
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={archived}
              onClick={() => setArchived(!archived)}
              className={`flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors ${
                archived ? "bg-accent" : "bg-disabled"
              }`}
            >
              <span
                className={`h-[18px] w-[18px] rounded-full bg-[#12151B] transition-transform ${
                  archived ? "translate-x-[18px]" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        )}

        <DialogActions
          busy={busy}
          onCancel={onClose}
          onDelete={remove}
          deleteLabel="Hapus habit"
        />
      </form>
    </Dialog>
  );
}
