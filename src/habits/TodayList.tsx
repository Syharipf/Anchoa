import { useState } from "react";
import type { HabitRow } from "../api";
import { PRIMARY } from "../shell/ui";
import { DAY_INITIALS, STATE_STYLE, metaLabel } from "./view";

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

function FlameIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2.5c.8 3.2 5 5.3 5 10a5 5 0 0 1-10 0c0-2.3 1.1-3.9 2.4-5 .1 1.7.9 2.8 2.1 3.2-.6-3 .1-5.9.5-8.2z" />
    </svg>
  );
}

function HabitRowItem({
  row,
  selected,
  onSelect,
  onToggle,
}: Readonly<{
  row: HabitRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, done: boolean) => void;
}>) {
  const doneW = row.week.filter((s) => s === "done").length;
  const schedW = row.week.filter((s) => s !== "off" && s !== "blank" && s !== "future").length;
  const weekLabel = `7 hari terakhir: ${doneW} dari ${schedW} hari terjadwal selesai`;

  let checkBtnClass =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-transform hover:scale-105 active:scale-95";
  if (row.doneToday) {
    checkBtnClass += " border-accent bg-accent text-canvas";
  } else if (row.scheduledToday) {
    checkBtnClass += " border-disabled bg-transparent hover:border-muted";
  } else {
    checkBtnClass =
      "flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-full border-2 border-line bg-transparent opacity-40";
  }

  return (
    <div
      className={`flex items-center gap-3.5 rounded-[10px] p-2.5 transition-colors ${
        selected ? "bg-surface-2" : "hover:bg-surface-2"
      }`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={row.doneToday}
        aria-label={`Tandai ${row.name} ${row.doneToday ? "belum selesai" : "selesai"}`}
        disabled={!row.scheduledToday}
        title={!row.scheduledToday ? "Libur hari ini" : undefined}
        onClick={() => onToggle(row.id, !row.doneToday)}
        className={checkBtnClass}
      >
        {row.doneToday && <CheckIcon />}
      </button>

      <button
        type="button"
        onClick={() => onSelect(row.id)}
        aria-pressed={selected}
        className="flex min-w-0 flex-1 flex-col gap-0.5 border-0 bg-transparent py-1 text-left"
      >
        <span
          className={`text-sm font-medium ${
            row.doneToday ? "text-muted line-through" : "text-ink"
          }`}
        >
          {row.name}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <BellIcon />
          <span>{metaLabel(row)}</span>
        </span>
      </button>

      <span role="img" aria-label={weekLabel} className="flex gap-1">
        {row.week.map((state, idx) => (
          <span
            key={idx}
            className={`box-border h-3.5 w-3.5 rounded border ${STATE_STYLE[state]}`}
          />
        ))}
      </span>

      <span
        title="Streak saat ini"
        className={`flex w-16 shrink-0 items-center justify-end gap-1 font-mono text-[13px] ${
          row.streak > 0 ? "text-accent" : "text-[#5b6475]"
        }`}
      >
        <FlameIcon />
        <span>{row.streak}</span>
      </span>
    </div>
  );
}

export function TodayList({
  today,
  habits,
  todayDone,
  todayTotal,
  selectedId,
  onSelect,
  onToggleCheck,
  onNewHabit,
}: Readonly<{
  today: string;
  habits: readonly HabitRow[];
  todayDone: number;
  todayTotal: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleCheck: (id: string, done: boolean) => void;
  onNewHabit: () => void;
}>) {
  const [filter, setFilter] = useState<"all" | "open">("all");

  const [y, m, d] = today.split("-").map(Number);
  const dayHeads = [6, 5, 4, 3, 2, 1, 0].map((offset) => {
    const dt = new Date(y, m - 1, d - offset);
    const dayIdx = (dt.getDay() + 6) % 7;
    return {
      initial: DAY_INITIALS[dayIdx],
      isToday: offset === 0,
    };
  });

  const filtered = habits.filter((h) => {
    if (filter === "open") {
      return !h.doneToday;
    }
    return true;
  });

  const allDone = todayTotal > 0 && todayDone === todayTotal;
  const emptyFilter = filter === "open" && filtered.length === 0 && habits.length > 0;

  return (
    <section
      aria-labelledby="h-today"
      className="flex min-h-0 flex-1 flex-col rounded-[14px] border border-line bg-surface p-3"
    >
      <div className="flex items-center gap-2.5 px-1.5 pb-2.5">
        <h2 id="h-today" className="m-0 font-display text-base font-semibold">
          Centang hari ini
        </h2>
        <fieldset className="m-0 ml-2 flex gap-1 border-0 p-0">
          <legend className="sr-only">Saring habit</legend>
          <button
            type="button"
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
            className={`min-h-7 rounded-md px-2.5 text-xs transition-colors ${
              filter === "all" ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
            }`}
          >
            Semua
          </button>
          <button
            type="button"
            aria-pressed={filter === "open"}
            onClick={() => setFilter("open")}
            className={`min-h-7 rounded-md px-2.5 text-xs transition-colors ${
              filter === "open" ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"
            }`}
          >
            Belum
          </button>
        </fieldset>
        <span aria-hidden="true" className="ml-auto flex gap-1 pr-[72px]">
          {dayHeads.map((dh, idx) => (
            <span
              key={idx}
              className={`w-3.5 text-center font-mono text-[10px] ${
                dh.isToday ? "text-accent" : "text-muted"
              }`}
            >
              {dh.initial}
            </span>
          ))}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {habits.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
            <p className="m-0 text-sm text-muted">Belum ada habit</p>
            <button type="button" onClick={onNewHabit} className={PRIMARY}>
              Buat habit
            </button>
          </div>
        ) : (
          filtered.map((row) => (
            <HabitRowItem
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onSelect={onSelect}
              onToggle={onToggleCheck}
            />
          ))
        )}

        {allDone && (
          <p className="m-2.5 text-[13px] text-accent">
            Semua habit hari ini sudah dicentang.
          </p>
        )}
        {emptyFilter && (
          <p className="m-2.5 text-[13px] text-muted">
            Tidak ada habit yang belum dicentang.
          </p>
        )}
      </div>
    </section>
  );
}
