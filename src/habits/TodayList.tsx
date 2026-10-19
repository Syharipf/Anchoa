import { useState } from "react";
import type { HabitRow } from "../api";
import { PRIMARY } from "../shell/ui";
import { FlameIcon } from "./icons";
import {
  DAY_INITIALS,
  STATE_STYLE,
  metaLabel,
} from "./view";

export type ExtendedHabitFilter = "all" | "open" | "archived";

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

function HabitRowItem({
  row,
  selected,
  onSelect,
  onToggle,
  onCheckYesterday,
}: Readonly<{
  row: HabitRow;
  selected: boolean;
  onSelect: (id: string) => void;
  onToggle: (id: string, done: boolean) => void;
  onCheckYesterday?: (id: string) => void;
}>) {
  const doneW = row.week.filter((s) => s === "done").length;
  const schedW = row.week.filter((s) => s !== "off" && s !== "blank" && s !== "future").length;
  const weekLabel = `7 hari terakhir: ${doneW} dari ${schedW} hari terjadwal selesai`;

  // Check if yesterday was missed (index 5 in 0..6 week array)
  const yesterdayState = row.week.length >= 2 ? row.week[row.week.length - 2] : null;
  const missedYesterday = yesterdayState === "miss" || yesterdayState === "todo";

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
      className={`flex items-center gap-3.5 rounded-xl p-3 transition-colors ${
        selected ? "bg-surface-2 border border-line" : "hover:bg-surface-2/60 border border-transparent"
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
        className="flex min-w-0 flex-1 flex-col gap-1 border-0 bg-transparent py-0.5 text-left"
      >
        <div className="flex items-center gap-2">
          {row.icon && <span className="text-base shrink-0">{row.icon}</span>}
          <span
            className={`text-sm font-medium ${
              row.doneToday ? "text-muted line-through" : "text-ink"
            }`}
          >
            {row.name}
          </span>
          {row.category && (
            <span className="rounded px-1.5 py-0.2 font-mono text-[10px] uppercase font-semibold bg-surface-2 text-accent/90 shrink-0">
              {row.category}
            </span>
          )}
          {row.targetDays && row.targetDays > 0 && (
            <span className="rounded bg-stage px-1.5 py-0.2 font-mono text-[10px] text-muted shrink-0">
              Target {row.targetDays}h
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <BellIcon />
            <span>{metaLabel(row)}</span>
          </span>

          {missedYesterday && onCheckYesterday && !row.archived && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCheckYesterday(row.id);
              }}
              title="Centang untuk hari kemarin"
              className="rounded bg-warn/15 px-2 py-0.5 font-medium text-[11px] text-warn hover:bg-warn/25 transition-colors"
            >
              + Centang Kemarin
            </button>
          )}
        </div>
      </button>

      <span role="img" aria-label={weekLabel} className="flex gap-1 shrink-0">
        {row.week.map((state, idx) => (
          <span
            key={idx}
            className={`box-border h-3.5 w-3.5 rounded border ${STATE_STYLE[state]}`}
          />
        ))}
      </span>

      <span
        aria-label={`Streak: ${row.streak} hari`}
        className={`flex w-16 shrink-0 items-center justify-end gap-1 font-mono text-sm ${
          row.streak > 0 ? "text-accent font-semibold" : "text-muted"
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
  onCheckYesterday,
  onNewHabit,
}: Readonly<{
  today: string;
  habits: readonly HabitRow[];
  todayDone: number;
  todayTotal: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleCheck: (id: string, done: boolean) => void;
  onCheckYesterday?: (id: string) => void;
  onNewHabit: () => void;
}>) {
  const [filter, setFilter] = useState<ExtendedHabitFilter>("all");

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
    if (filter === "archived") return h.archived;
    if (h.archived) return false;
    if (filter === "open") return h.scheduledToday && !h.doneToday;
    return true;
  });

  const allDone = todayTotal > 0 && todayDone === todayTotal;
  const emptyFilter = filter === "open" && filtered.length === 0 && habits.some((h) => !h.archived);

  return (
    <section
      aria-labelledby="h-today"
      className="flex min-h-0 flex-1 flex-col rounded-2xl border border-line bg-surface p-4 shadow-sm"
    >
      <div className="flex items-center gap-2.5 pb-3 border-b border-line">
        <h2 id="h-today" className="m-0 font-display text-base font-semibold text-ink">
          Centang hari ini
        </h2>
        <fieldset className="m-0 ml-2 flex gap-1 border-0 p-0">
          <legend className="sr-only">Saring habit</legend>
          <button
            type="button"
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
            className={`min-h-7 rounded-md px-2.5 text-xs transition-colors ${
              filter === "all" ? "bg-surface-2 text-ink font-medium" : "text-muted hover:text-ink"
            }`}
          >
            Semua
          </button>
          <button
            type="button"
            aria-pressed={filter === "open"}
            onClick={() => setFilter("open")}
            className={`min-h-7 rounded-md px-2.5 text-xs transition-colors ${
              filter === "open" ? "bg-surface-2 text-ink font-medium" : "text-muted hover:text-ink"
            }`}
          >
            Belum
          </button>
          <button
            type="button"
            aria-pressed={filter === "archived"}
            onClick={() => setFilter("archived")}
            className={`min-h-7 rounded-md px-2.5 text-xs transition-colors ${
              filter === "archived" ? "bg-surface-2 text-warn font-medium" : "text-muted hover:text-ink"
            }`}
          >
            Arsip
          </button>
        </fieldset>
        <span aria-hidden="true" className="ml-auto flex gap-1 pr-[76px]">
          {dayHeads.map((dh, idx) => (
            <span
              key={idx}
              className={`w-3.5 text-center font-mono text-[10px] ${
                dh.isToday ? "text-accent font-semibold" : "text-muted"
              }`}
            >
              {dh.initial}
            </span>
          ))}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pt-3">
        {filtered.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
            <p className="m-0 text-sm text-muted">
              {filter === "archived"
                ? "Tidak ada habit di arsip"
                : filter === "open"
                  ? "Semua habit sudah dicentang!"
                  : "Belum ada habit"}
            </p>
            {filter === "all" && (
              <button type="button" onClick={onNewHabit} className={PRIMARY}>
                Buat habit baru
              </button>
            )}
          </div>
        ) : (
          filtered.map((row) => (
            <HabitRowItem
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onSelect={onSelect}
              onToggle={onToggleCheck}
              onCheckYesterday={onCheckYesterday}
            />
          ))
        )}

        {allDone && filter !== "archived" && (
          <p className="m-2.5 text-xs text-accent font-medium text-center py-2">
            ✨ Hebat! Semua habit hari ini sudah berhasil dicentang.
          </p>
        )}
        {emptyFilter && (
          <p className="m-2.5 text-xs text-muted text-center py-2">
            Tidak ada habit yang belum dicentang.
          </p>
        )}
      </div>
    </section>
  );
}
