// Helper functions and metadata for the profile page.
import type { NotifyDelivery, NotifyPrefs, NotifyStatus, ProfileStats } from "../api";

export function profileInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "Y";
  return parts
    .map((part) => Array.from(part)[0])
    .join("")
    .toLocaleUpperCase("en-US");
}

export function formatSince(since: number | null): string {
  if (since === null) return "Using Anchoa recently";
  const d = new Date(since);
  const monthYear = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return `Using Anchoa since ${monthYear}`;
}

export interface StatItem {
  readonly label: string;
  readonly value: number;
}

export function profileStatsList(stats?: ProfileStats | null): readonly StatItem[] {
  return [
    { label: "day streak", value: stats?.habitStreak ?? 0 },
    { label: "tasks completed", value: stats?.tasksDone ?? 0 },
    { label: "journal entries", value: stats?.journalEntries ?? 0 },
    { label: "notes", value: stats?.notes ?? 0 },
  ];
}

export interface NotifyPrefOption {
  readonly key: Exclude<keyof NotifyPrefs, "journalAt">;
  readonly label: string;
  readonly description: string;
}

export const NOTIFY_PREF_OPTIONS: readonly NotifyPrefOption[] = [
  {
    key: "task",
    label: "Tasks",
    description: "Deadlines and tasks due today",
  },
  {
    key: "bill",
    label: "Bills",
    description: "Due dates and overdue reminders",
  },
  {
    key: "budget",
    label: "Budget limit",
    description: "Alert when exceeding 80% of budget limit",
  },
  {
    key: "habit",
    label: "Habits",
    description: "Reminder for unchecked daily habits",
  },
  {
    key: "journal",
    label: "Journal",
    description: "Daily reminder to write journal",
  },
] as const;

export const OS_PERMISSION_LABEL: Readonly<Record<NotifyStatus["permission"], string>> = {
  granted: "System notifications: active",
  denied: "System notifications: denied",
  prompt: "System notifications: not allowed yet",
};

export const DELIVERY_STATE_LABEL: Readonly<Record<NotifyDelivery["state"], string>> = {
  shown: "Delivered",
  denied: "System denied",
  failed: "Delivery failed",
  skipped: "Skipped, category disabled",
};

/** Rows of the delivery log shown under the notification switches. */
export const RECENT_DELIVERIES_SHOWN = 5;
