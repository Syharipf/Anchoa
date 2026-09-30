import type { DayTask } from "../api";

export interface ReminderGroup {
  title: "Terlambat" | "Hari ini";
  tasks: DayTask[];
}

/** Notification panel content until modules store their own notifications (spec UI lanjutan U6). */
export function reminders(today: DayTask[]): ReminderGroup[] {
  const open = today.filter((t) => t.completedAt === null);
  const groups: ReminderGroup[] = [
    { title: "Terlambat", tasks: open.filter((t) => t.overdue) },
    { title: "Hari ini", tasks: open.filter((t) => !t.overdue) },
  ];
  return groups.filter((g) => g.tasks.length > 0);
}

export function reminderCount(today: DayTask[]): number {
  return today.filter((t) => t.completedAt === null).length;
}
