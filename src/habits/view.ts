import type { DayState } from "../api";

export const DAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"] as const;
export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
export const SHORT_DAY_NAMES = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

/**
 * Toggles the bit at `index` (0 = Monday .. 6 = Sunday).
 * Cannot produce 0: if toggling turns off the last active day, returns the current `days`.
 */
export function toggleDay(days: number, index: number): number {
  if (index < 0 || index > 6) {
    return days;
  }
  const next = days ^ (1 << index);
  if (next === 0) {
    return days;
  }
  return next;
}

/**
 * Human-readable schedule label:
 * 127 -> "Every day", 31 -> "Mon–Fri", 96 -> "Sat–Sun".
 * Other consecutive days use "Tue–Thu".
 * Non-consecutive days use "Mon, Wed, Fri".
 */
export function scheduleLabel(days: number): string {
  if (days === 127) {
    return "Every day";
  }
  if (days === 31) {
    return "Mon–Fri";
  }
  if (days === 96) {
    return "Sat–Sun";
  }

  const active: number[] = [];
  for (let i = 0; i < 7; i++) {
    if ((days & (1 << i)) !== 0) {
      active.push(i);
    }
  }

  if (active.length === 0) {
    return "";
  }

  const isConsecutive =
    active.length > 1 &&
    active.every((val, idx) => idx === 0 || val === active[idx - 1] + 1);

  if (isConsecutive) {
    const first = SHORT_DAY_NAMES[active[0]];
    const last = SHORT_DAY_NAMES[active[active.length - 1]];
    return `${first}–${last}`;
  }

  return active.map((i) => SHORT_DAY_NAMES[i]).join(", ");
}

/** Formats "HH:MM" (or "HH.MM") to local time display "HH:MM". */
function formatTime(remindAt: string | null | undefined): string {
  if (!remindAt) {
    return "";
  }
  return remindAt.replace(".", ":");
}

/**
 * Row subtitle meta label:
 * "06:30 · Every day", or "Every day" without time.
 */
export function metaLabel(row: { days: number; remindAt?: string | null }): string {
  const sched = scheduleLabel(row.days);
  const time = formatTime(row.remindAt);
  if (!time) {
    return sched;
  }
  return `${time} · ${sched}`;
}

/**
 * Long schedule description for the detail panel:
 * "Every day at 06:30", or "Every day" without time.
 */
export function longSchedule(row: { days: number; remindAt?: string | null }): string {
  const sched = scheduleLabel(row.days);
  const time = formatTime(row.remindAt);
  if (!time) {
    return sched;
  }
  return `${sched} at ${time}`;
}

/** Tailwind classes for each DayState, mirroring `look()` from the design artboard. */
export const STATE_STYLE: Record<DayState, string> = {
  done: "bg-accent border-accent text-canvas border-solid",
  miss: "bg-line border-line text-[#7d8696] border-solid",
  off: "bg-transparent border-disabled text-[#5b6475] border-dashed",
  todo: "bg-transparent border-accent text-ink border-solid",
  future: "bg-transparent border-transparent text-disabled border-solid",
  blank: "bg-transparent border-transparent text-transparent border-solid",
};

/**
 * Determines whether the reminder should be turned on:
 * - A habit without a reminder time must not have its reminder switched on (returns false).
 * - When a reminder time is entered, defaults to true unless an existing habit already had a reminder time configured.
 */
export function resolveRemindOn(
  remindAt: string | null | undefined,
  edit?: { remindAt?: string | null; remindOn?: boolean } | null,
): boolean {
  const hasTime = Boolean(remindAt && remindAt.trim());
  if (!hasTime) {
    return false;
  }
  const editHadTime = Boolean(edit?.remindAt && edit.remindAt.trim());
  if (editHadTime) {
    return edit?.remindOn ?? true;
  }
  return true;
}

export type HabitFilter = "all" | "open";

/**
 * Returns true if the habit is scheduled today and not yet done (the 'open' rule).
 */
export function isHabitOpen(habit: { scheduledToday: boolean; doneToday: boolean }): boolean {
  return habit.scheduledToday && !habit.doneToday;
}

/**
 * Filters habits according to the selected filter tab ('all' or 'open').
 * The 'open' filter lists only habits that are scheduled today and not yet done.
 */
export function filterHabits<T extends { scheduledToday: boolean; doneToday: boolean }>(
  habits: readonly T[],
  filter: HabitFilter,
): T[] {
  if (filter === "open") {
    return habits.filter(isHabitOpen);
  }
  return [...habits];
}

