import { useEffect, useState } from "react";
import { api, type HabitHistory, type HabitInput, type HabitRow } from "../api";
import { msToDateInput } from "../format";
import {
  DAY_INITIALS,
  DAY_NAMES,
  STATE_STYLE,
  longSchedule,
  toggleDay,
} from "./view";

function formatMonthLabel(mStr: string): string {
  const [y, m] = mStr.split("-").map(Number);
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function StatBox({
  value,
  label,
  note,
}: Readonly<{
  value: string | number;
  label: string;
  note?: string;
}>) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[10px] bg-stage p-2.5">
      <span className="font-mono text-lg text-ink">{value}</span>
      <span className="text-[11px] text-muted">{label}</span>
      {note && <span className="text-[10px] leading-snug text-muted">{note}</span>}
    </div>
  );
}

export function HabitDetail({
  habit,
  today,
  onEdit,
  onDelete,
  onUpdate,
  onCheckDate,
}: Readonly<{
  habit: HabitRow | null;
  today: string;
  onEdit: (habit: HabitRow) => void;
  onDelete: (id: string) => void;
  onUpdate: (input: HabitInput) => void;
  onCheckDate?: (id: string, date: string, done: boolean) => void;
}>) {
  const maxMonth = today.slice(0, 7);
  const [month, setMonth] = useState(maxMonth);
  const [history, setHistory] = useState<HabitHistory | null>(null);

  useEffect(() => {
    setMonth(maxMonth);
  }, [habit?.id, maxMonth]);

  useEffect(() => {
    if (!habit) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    api.habitHistory(habit.id, month).then(
      (data) => {
        if (!cancelled) {
          setHistory(data);
        }
      },
      () => {
        if (!cancelled) {
          setHistory(null);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [habit, month]);

  if (!habit) {
    return (
      <aside
        aria-labelledby="h-detail"
        className="flex min-h-0 w-full flex-col items-center justify-center rounded-[14px] border border-line bg-surface p-6 text-center text-muted"
      >
        <h2 id="h-detail" className="sr-only">
          Habit details
        </h2>
        <p className="m-0 text-sm">Select a habit to view details.</p>
      </aside>
    );
  }

  const createdMonth = msToDateInput(habit.createdAt).slice(0, 7);
  const canPrev = month > createdMonth;
  const canNext = month < maxMonth;

  function changeMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    const dt = new Date(y, m - 1 + delta, 1);
    const nextY = dt.getFullYear();
    const nextM = String(dt.getMonth() + 1).padStart(2, "0");
    setMonth(`${nextY}-${nextM}`);
  }

  const mDone = history?.cells.filter((c) => c.state === "done").length ?? 0;
  const mSched =
    history?.cells.filter((c) => c.state === "done" || c.state === "miss").length ?? 0;
  const monthName = formatMonthLabel(month);
  const heatLabel = `${habit.name}, ${monthName}: ${mDone} of ${mSched} scheduled days completed`;

  const hasTime = Boolean(habit.remindAt && habit.remindAt.trim());
  const timeDisplay = habit.remindAt ? habit.remindAt.replace(".", ":") : "–";
  const remNote = habit.remindOn
    ? "Shows in notification panel"
    : "Off — no reminder";

  const [ty, tm, td] = today.split("-").map(Number);
  const yestDt = new Date(ty, tm - 1, td - 1);
  const yesterdayStr = `${yestDt.getFullYear()}-${String(yestDt.getMonth() + 1).padStart(2, "0")}-${String(yestDt.getDate()).padStart(2, "0")}`;
  const yestCell = history?.cells.find((c) => c.date === yesterdayStr);
  const missedYesterday = yestCell && (yestCell.state === "miss" || yestCell.state === "todo");
  const doneYesterday = yestCell && yestCell.state === "done";
  return (
    <aside
      aria-labelledby="h-detail"
      className="flex min-h-0 w-full flex-col gap-3.5 overflow-y-auto rounded-[14px] border border-line bg-surface p-4"
    >
      <div className="flex flex-col gap-1">
         <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {habit.icon && <span className="text-xl">{habit.icon}</span>}
            <h2
              id="h-detail"
              title={habit.name}
              className="m-0 truncate font-display text-lg font-semibold text-ink"
            >
              {habit.name}
            </h2>
            {habit.category && (
              <span className="rounded-md border border-line bg-surface-2 px-2 py-0.5 text-[10px] uppercase font-semibold text-accent shrink-0">
                {habit.category}
              </span>
            )}
            {habit.archived && (
              <span className="rounded-md border border-warn/40 bg-warn/15 px-2 py-0.5 text-[10px] font-medium text-warn shrink-0">
                Archived
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => onEdit(habit)}
              className="rounded-full border border-line px-3 py-1 text-xs text-ink transition-colors hover:bg-surface-2"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onDelete(habit.id)}
              className="rounded-full border border-danger/40 px-3 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger-row"
            >
              Delete
            </button>
          </div>
        </div>
        <span className="text-xs text-muted">{longSchedule(habit)}</span>
      </div>
      {habit.targetDays && habit.targetDays > 0 && (
        <div className="flex flex-col gap-1.5 rounded-[10px] bg-stage p-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-ink">Target {habit.targetDays} Days</span>
            <span className="font-mono text-accent">
              {habit.streak} / {habit.targetDays} ({Math.min(100, Math.round((habit.streak / habit.targetDays) * 100))}%)
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-accent transition-all duration-300 rounded-full"
              style={{ width: `${Math.min(100, (habit.streak / habit.targetDays) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Yesterday Check Tolerance */}
      {missedYesterday && onCheckDate && (
        <div className="flex items-center justify-between gap-2 rounded-[10px] border border-warn/30 bg-warn/10 p-2.5 text-xs">
          <span className="text-warn font-medium">Forgot to check yesterday?</span>
          <button
            type="button"
            onClick={() => onCheckDate(habit.id, yesterdayStr, true)}
            className="rounded-md bg-accent px-2 py-1 text-[11px] font-semibold text-canvas hover:bg-accent-hover transition-colors"
          >
            ✓ Check Yesterday
          </button>
        </div>
      )}
      {doneYesterday && onCheckDate && (
        <div className="flex items-center justify-between gap-2 rounded-[10px] border border-line bg-stage p-2 text-xs">
          <span className="text-muted text-[11px]">Checked yesterday ✓</span>
          <button
            type="button"
            onClick={() => onCheckDate(habit.id, yesterdayStr, false)}
            className="text-[11px] text-muted hover:text-danger underline"
          >
            Undo yesterday
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <StatBox value={habit.streak} label="current streak" />
        <StatBox value={habit.best} label="longest" />
        <StatBox
          value={`${habit.rate30}%`}
          label="30-day consistency"
          note="30 scheduled days"
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <span className="flex-1 text-[13px] font-medium text-ink">History</span>
          <button
            type="button"
            onClick={() => changeMonth(-1)}
            disabled={!canPrev}
            aria-label="Previous month"
            className="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-muted transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-disabled"
          >
            ‹
          </button>
          <span className="min-w-[100px] text-center font-mono text-xs text-muted">
            {monthName}
          </span>
          <button
            type="button"
            onClick={() => changeMonth(1)}
            disabled={!canNext}
            aria-label="Next month"
            className="flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-muted transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-disabled"
          >
            ›
          </button>
        </div>

        <div aria-hidden="true" className="grid grid-cols-7 gap-1">
          {DAY_INITIALS.map((init, idx) => (
            <span key={idx} className="text-center font-mono text-[10px] text-muted">
              {init}
            </span>
          ))}
        </div>

        <div role="img" aria-label={heatLabel} className="grid grid-cols-7 gap-1">
          {history?.cells.map((cell, idx) => {
            if (cell.day === 0) {
              return (
                <span
                  key={idx}
                  className="box-border h-8 rounded-md border border-transparent bg-transparent"
                />
              );
            }
            return (
              <span
                key={cell.date}
                className={`box-border flex h-8 items-center justify-center rounded-md font-mono text-[11px] ${
                  cell.state === "todo" ? "border-2" : "border"
                } ${STATE_STYLE[cell.state]}`}
              >
                {cell.day}
              </span>
            );
          })}
        </div>

        <div
          aria-hidden="true"
          className="flex items-center gap-3 pt-1 text-[11px] text-muted"
        >
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded bg-accent" />
            Done
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded bg-line" />
            Missed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded border border-dashed border-disabled" />
            Off
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 border-t border-line pt-3">
        <div className="flex items-center gap-2.5">
          <div className="flex flex-1 flex-col">
            <span id="h-rem" className="text-[13px] font-medium text-ink">
              Reminder
            </span>
            <span className="text-[11px] text-muted">{remNote}</span>
          </div>
          <span
            className={`rounded bg-stage px-2 py-1 font-mono text-xs ${
              habit.remindOn ? "text-ink" : "text-disabled"
            }`}
          >
            {timeDisplay}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={habit.remindOn}
            aria-labelledby="h-rem"
            disabled={!hasTime}
            title={hasTime ? undefined : "Set reminder time first"}
            onClick={() => {
              if (!hasTime) return;
              onUpdate({
                id: habit.id,
                name: habit.name,
                days: habit.days,
                remindAt: habit.remindAt,
                remindOn: !habit.remindOn,
              });
            }}
            className={`relative flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              habit.remindOn ? "bg-accent" : "bg-disabled"
            }`}
          >
            <span
              className={`h-4 w-4 rounded-full transition-transform ${
                habit.remindOn ? "translate-x-4 bg-canvas" : "translate-x-0 bg-muted"
              }`}
            />
          </button>
        </div>

        <fieldset className="m-0 grid grid-cols-7 gap-1 border-0 p-0">
          <legend className="sr-only">Scheduled days</legend>
          {DAY_INITIALS.map((init, i) => {
            const active = (habit.days & (1 << i)) !== 0;
            const fullLabel = `${DAY_NAMES[i]}${active ? ", scheduled" : ", off"}`;
            return (
              <button
                key={i}
                type="button"
                aria-pressed={active}
                aria-label={fullLabel}
                onClick={() => {
                  const newDays = toggleDay(habit.days, i);
                  if (newDays !== habit.days) {
                    onUpdate({
                      id: habit.id,
                      name: habit.name,
                      days: newDays,
                      remindAt: habit.remindAt,
                      remindOn: habit.remindOn,
                    });
                  }
                }}
                className={`h-7.5 rounded-lg border text-xs font-medium transition-colors ${
                  active
                    ? "border-field-focus bg-surface-2 text-ink"
                    : "border-line bg-transparent text-[#5b6475] hover:border-disabled"
                }`}
              >
                {init}
              </button>
            );
          })}
        </fieldset>
      </div>
    </aside>
  );
}
