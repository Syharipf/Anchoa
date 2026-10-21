import { useState, type FormEvent } from "react";
import { api, errorMessage, type ScheduleItem } from "../api";
import { dateInputToMs } from "../format";
import { Dialog, Field } from "../shell/Dialog";
import { FIELD, PRIMARY, SECONDARY } from "../shell/ui";

const DANGER_BUTTON =
  "min-h-10 rounded-full border border-danger/40 px-4 text-[13px] text-danger transition-colors hover:bg-danger/10 disabled:opacity-50";
export function CalendarEventForm({
  item,
  onClose,
  onSaved,
}: Readonly<{
  item: ScheduleItem;
  onClose: () => void;
  onSaved: () => void;
}>) {
  const [title, setTitle] = useState(item.title);
  const [startDate, setStartDate] = useState(item.startDate ?? item.dueDate);
  const [dueDate, setDueDate] = useState(item.dueDate);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (title.trim() === "") {
      setError("Title cannot be empty");
      return;
    }
    const startMs = dateInputToMs(startDate);
    const dueMs = dateInputToMs(dueDate);
    if (startMs === null || dueMs === null) {
      setError("Invalid date");
      return;
    }
    const startAt = Math.min(startMs, dueMs);
    // Exclusive end boundary for full day
    const endAt = Math.max(startMs, dueMs) + 86_400_000;

    setError(null);
    setBusy(true);
    try {
      await api.calendarUpdateEvent({
        id: item.id,
        title: title.trim(),
        startAt,
        endAt,
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    if (!window.confirm("Delete this event from Google Calendar?")) return;
    setBusy(true);
    setError(null);
    try {
      await api.calendarDeleteEvent(item.id);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog title="Edit Google Calendar event" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <Field label="Title">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={FIELD}
            />
          </Field>
          <Field label="End">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={FIELD}
            />
          </Field>
        </div>
        {error !== null && (
          <p role="alert" className="m-0 text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDelete()}
            className={DANGER_BUTTON}
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className={SECONDARY}
            >
              Cancel
            </button>
            <button type="submit" disabled={busy} className={PRIMARY}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
