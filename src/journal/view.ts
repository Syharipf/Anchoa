// Display rules and helpers for the Jurnal page (spec Fase 4 §5).
import type { EntryKind } from "../api";

export interface KindMeta {
  readonly label: string;
  readonly icon: string;
}

export const KIND_META: Record<EntryKind, KindMeta> = {
  idea: {
    label: "Idea",
    icon: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  },
  vent: {
    label: "Vent",
    icon: "M4 5h16v11H9l-5 4z",
  },
  note: {
    label: "Note",
    icon: "M6 3h9l3 3v15H6zM9 11h6M9 15h6",
  },
};

export interface JournalTemplate {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly kind: EntryKind;
  readonly title: string;
  readonly body: string;
}

export const JOURNAL_TEMPLATES: readonly JournalTemplate[] = [
  {
    id: "daily-reflection",
    label: "Daily reflection",
    description: "Evaluate today and what was learned",
    kind: "note",
    title: "Daily reflection",
    body: "### What went well today?\n\n\n### What challenges did I face?\n\n\n### What are the lessons for tomorrow?\n",
  },
  {
    id: "gratitude",
    label: "3 things to be grateful for",
    description: "Gratitude exercise for meaningful things",
    kind: "note",
    title: "3 things to be grateful for",
    body: "1. \n2. \n3. \n",
  },
  {
    id: "weekly-review",
    label: "Weekly review",
    description: "Reflect on accomplishments and direction for next week",
    kind: "note",
    title: "Weekly review",
    body: "### Biggest achievements this week\n\n\n### Unfinished or delayed items\n\n\n### Main focus for next week\n",
  },
  {
    id: "guided-vent",
    label: "Guided vent",
    description: "Untangle emotions and find what you can control",
    kind: "vent",
    title: "Guided vent",
    body: "### What am I feeling right now?\n\n\n### Why does this bother me?\n\n\n### What is within my control?\n",
  },
];

/** Formats a daily recap markdown body from dashboard state. */
export function formatDailyRecap(data: {
  tasks: readonly { title: string; done?: boolean }[];
  habits: readonly { name: string; doneToday: boolean }[];
  income?: number;
  expense?: number;
}): string {
  const doneTasks = data.tasks.filter((t) => t.done);
  const pendingTasks = data.tasks.filter((t) => !t.done);

  let body = "### 🎯 Today's Tasks\n";
  if (doneTasks.length === 0 && pendingTasks.length === 0) {
    body += "_No tasks scheduled for today._\n";
  } else {
    for (const t of doneTasks) body += `- [x] ${t.title}\n`;
    for (const t of pendingTasks) body += `- [ ] ${t.title}\n`;
  }

  body += "\n### 🌟 Habits\n";
  if (data.habits.length === 0) {
    body += "_No habits scheduled yet._\n";
  } else {
    for (const h of data.habits) {
      body += `- [${h.doneToday ? "x" : " "}] ${h.name}\n`;
    }
  }

  if (data.income !== undefined || data.expense !== undefined) {
    body += "\n### 💰 Finance\n";
    if (data.income !== undefined && data.income > 0) {
      body += `- Income: Rp ${Math.abs(data.income).toLocaleString("id-ID")}\n`;
    }
    if (data.expense !== undefined && data.expense > 0) {
      body += `- Expenses: Rp ${Math.abs(data.expense).toLocaleString("id-ID")}\n`;
    }
    if ((!data.income || data.income === 0) && (!data.expense || data.expense === 0)) {
      body += "_No transactions recorded today._\n";
    }
  }

  body += "\n### 📝 Quick Reflection\n\n";
  return body;
}

export const MOODS = ["Heavy", "Down", "Neutral", "Good", "Great"] as const;

export interface MoodBar {
  readonly h: number;
  readonly c: string;
  readonly active: boolean;
}

/** 5-bar indicator for list items: height scales with level, filled up to mood. */
export function moodBars(mood: number | null | undefined): MoodBar[] {
  const m = mood ?? 0;
  return [1, 2, 3, 4, 5].map((i) => ({
    h: 2 + i * 1.6,
    c: i <= m ? "#C6F36B" : "#2E3440",
    active: i <= m,
  }));
}

export const PROMPTS = [
  "What is one small thing that went well today?",
  "What drained your energy most this week, and what can be reduced?",
  "What idea keeps coming to mind that you haven't tried yet?",
  "Who or what made you feel grateful today?",
  "What challenge are you currently facing and how are you working through it?",
  "If today could be replayed, what would you do differently?",
  "What interesting thing did you learn or discover recently?",
  "What are you looking forward to or hoping to accomplish tomorrow?",
] as const;

/** Cycles to the next prompt index. */
export function nextPrompt(currentIndex: number, total: number = PROMPTS.length): number {
  if (total <= 0) {
    return 0;
  }
  return ((currentIndex + 1) % total + total) % total;
}

const TAG_REGEX = /^[a-zA-Z0-9-]+$/;

/**
 * Parses and validates an input tag: strips leading '#', trims, validates
 * [a-zA-Z0-9-], and returns lowercased tag string or null if invalid.
 */
export function parseTag(text: string): string | null {
  const trimmed = text.trim();
  const withoutHash = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (!withoutHash || !TAG_REGEX.test(withoutHash)) {
    return null;
  }
  return withoutHash.toLowerCase();
}

/** Joins array of tags to a single space-separated string for the backend patch. */
export function tagsToText(tags: readonly string[]): string {
  return tags
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .join(" ");
}
