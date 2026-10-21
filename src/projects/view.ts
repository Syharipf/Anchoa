import type {
  Activity,
  ActivityRole,
  BoardFilter,
  Columns,
  Priority,
  ProjectKind,
  ProjectStatus,
  TaskCard,
  TaskStatus,
} from "../api";
import { shortDate } from "../format";

export const KIND_LABELS: Record<ProjectKind, string> = {
  app: "App",
  document: "Document",
  research: "Research",
  personal: "Personal",
};

export const STATUS_LABELS: Record<ProjectStatus, { label: string; tone: "accent" | "danger" | "muted" }> = {
  active: { label: "Active", tone: "accent" },
  late: { label: "Overdue", tone: "danger" },
  done: { label: "Done", tone: "muted" },
};
export const PRIORITY_LABELS: Readonly<Record<Priority, { label: string; className: string }>> = {
  1: { label: "High", className: "text-danger" },
  2: { label: "Medium", className: "text-warn" },
  3: { label: "Low", className: "text-muted" },
};

/** The card being dropped, or null when it stays in its own column. */
export function dropTarget(columns: Columns, id: string, status: TaskStatus): TaskCard | null {
  const card = Object.values(columns).flat().find((c) => c.id === id);
  return card && card.status !== status ? card : null;
}

export function hasFilter(filter: BoardFilter): boolean {
  return Boolean(filter.query?.trim() || filter.tag || filter.priority || filter.due);
}


const AGENT_COLUMNS: readonly Readonly<{ status: TaskStatus; title: string; dot: string }>[] = [
  { status: "plan", title: "Plan", dot: "bg-muted" },
  { status: "doing", title: "In Progress", dot: "bg-accent" },
  { status: "test", title: "Test", dot: "bg-cat-project" },
  { status: "review", title: "Review", dot: "bg-cat-bill" },
  { status: "done", title: "Done", dot: "bg-field-focus" },
];
const PROJECT_COLUMNS = AGENT_COLUMNS.filter(({ status }) => status !== "test" && status !== "review");

export function boardColumns(agent: boolean) {
  return agent ? AGENT_COLUMNS : PROJECT_COLUMNS;
}

export const ROLE_LABELS: Readonly<Record<ActivityRole, string>> = {
  request: "Request",
  plan: "Plan",
  implement: "Implementation",
  test: "Test",
  review: "Review",
  merge: "Merge",
  note: "Note",
};

export function actorInitials(actor: string): string {
  return actor.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => Array.from(part)[0]).join("").toLocaleUpperCase("en-US") || "?";
}

/** Activities store the local user as "Kamu"; the UI shows English. Keep the stored value for sync. */
export function actorLabel(actor: string): string {
  return actor === "Kamu" ? "You" : actor;
}

export function lastActivity<T extends Pick<Activity, "actor" | "role" | "createdAt">>(activities: readonly T[]): T | null {
  return activities.reduce<T | null>((latest, activity) =>
    latest === null || activity.createdAt >= latest.createdAt ? activity : latest, null);
}

export function deadlineLabel(deadlineAt: number | null, deadlineDays: number | null): string {
  if (deadlineAt === null) return "";
  if (deadlineDays === 0) return "today";
  if (deadlineDays !== null && deadlineDays < 0) {
    const days = Math.abs(deadlineDays);
    return `${days} ${days === 1 ? "day" : "days"} overdue`;
  }
  return shortDate(deadlineAt);
}

export function nextStatus(status: TaskStatus, agent = false): TaskStatus {
  if (agent) {
    const index = AGENT_COLUMNS.findIndex((column) => column.status === status);
    return AGENT_COLUMNS[(index + 1) % AGENT_COLUMNS.length].status;
  }
  if (status === "plan") return "doing";
  if (status !== "done") return "done";
  return "plan";
}

export function moveLabel(status: TaskStatus, agent = false): string {
  if (status === "done") return "Move back to Plan";
  const title = AGENT_COLUMNS.find((column) => column.status === nextStatus(status, agent))?.title;
  return `Move to ${title}`;
}

export function subLabel(card: Pick<TaskCard, "subDone" | "subTotal">): string | null {
  if (card.subTotal <= 0) return null;
  return `${card.subDone}/${card.subTotal}`;
}

export function toggleTaskStatus(status: TaskStatus): TaskStatus {
  return status === "done" ? "plan" : "done";
}

export function parentLabel(parentTitle: string | null | undefined): string {
  return parentTitle ? `↑ ${parentTitle}` : "↑ Parent";
}

export type ActivityFilter = "all" | "tasks" | "test";

export const ACTIVITY_FILTERS: readonly Readonly<{ id: ActivityFilter; label: string }>[] = [
  { id: "all", label: "All" },
  { id: "tasks", label: "Plans & tasks" },
  { id: "test", label: "Tests" },
];

export function matchActivityFilter(
  activity: Pick<Activity, "role" | "kind">,
  filter: ActivityFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "tasks") {
    return (
      activity.kind === "status" ||
      activity.role === "request" ||
      activity.role === "plan" ||
      activity.role === "implement" ||
      activity.role === "merge"
    );
  }
  if (filter === "test") {
    return activity.role === "test" || activity.role === "review";
  }
  return true;
}

export function filterActivities<T extends Pick<Activity, "role" | "kind">>(
  activities: readonly T[],
  filter: ActivityFilter,
): T[] {
  return activities.filter((activity) => matchActivityFilter(activity, filter));
}

export interface ConnectedAgent {
  readonly name: string;
  readonly initials: string;
  readonly lastActiveAt: number;
}

export function connectedAgents(
  activities: readonly Pick<Activity, "actor" | "createdAt">[],
): ConnectedAgent[] {
  const latest = new Map<string, number>();
  for (const a of activities) {
    const actor = a.actor.trim();
    if (!actor) continue;
    const lower = actor.toLowerCase();
    if (lower === "kamu" || lower === "anchoa") continue;
    const current = latest.get(actor);
    if (current === undefined || a.createdAt > current) {
      latest.set(actor, a.createdAt);
    }
  }
  return Array.from(latest.entries())
    .map(([name, lastActiveAt]) => ({
      name,
      initials: actorInitials(name),
      lastActiveAt,
    }))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt || a.name.localeCompare(b.name));
}

export const AGENT_QUICK_BUTTONS = [
  "Run tests",
  "Fix failing tests",
  "Continue to next task",
  "Summarize today's progress",
] as const;

export const AGENT_CLI_SNIPPET = `## Reporting to Anchoa
- Task status: "$ANCHOA_CLI" agent task status --task "$ANCHOA_TASK" <STATUS> --actor <NAME>
- Create plan: "$ANCHOA_CLI" agent plan --task "$ANCHOA_TASK" --actor <NAME> --file <PATH.md>
- Record log/test: "$ANCHOA_CLI" agent log --task "$ANCHOA_TASK" --actor <NAME> --role implement|test|review --body "..."`;
