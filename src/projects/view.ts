import type { Activity, ActivityRole, ProjectKind, ProjectStatus, TaskCard, TaskStatus } from "../api";
import { shortDate } from "../format";

export const KIND_LABELS: Record<ProjectKind, string> = {
  app: "Aplikasi",
  document: "Dokumen",
  research: "Riset",
  personal: "Pribadi",
};

export const STATUS_LABELS: Record<ProjectStatus, { label: string; tone: "accent" | "danger" | "muted" }> = {
  active: { label: "Aktif", tone: "accent" },
  late: { label: "Terlambat", tone: "danger" },
  done: { label: "Selesai", tone: "muted" },
};

const AGENT_COLUMNS: readonly Readonly<{ status: TaskStatus; title: string; dot: string }>[] = [
  { status: "plan", title: "Rencana", dot: "bg-muted" },
  { status: "doing", title: "Dikerjakan", dot: "bg-accent" },
  { status: "test", title: "Tes", dot: "bg-cat-project" },
  { status: "review", title: "Review", dot: "bg-cat-bill" },
  { status: "done", title: "Selesai", dot: "bg-field-focus" },
];
const PROJECT_COLUMNS = AGENT_COLUMNS.filter(({ status }) => status !== "test" && status !== "review");

export function boardColumns(agent: boolean) {
  return agent ? AGENT_COLUMNS : PROJECT_COLUMNS;
}

export const ROLE_LABELS: Readonly<Record<ActivityRole, string>> = {
  request: "Permintaan",
  plan: "Rencana",
  implement: "Implementasi",
  test: "Tes",
  review: "Review",
  merge: "Merge",
  note: "Catatan",
};

export function actorInitials(actor: string): string {
  return actor.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => Array.from(part)[0]).join("").toLocaleUpperCase("id-ID") || "?";
}

export function lastActivity<T extends Pick<Activity, "actor" | "role" | "createdAt">>(activities: readonly T[]): T | null {
  return activities.reduce<T | null>((latest, activity) =>
    latest === null || activity.createdAt >= latest.createdAt ? activity : latest, null);
}

export function deadlineLabel(deadlineAt: number | null, deadlineDays: number | null): string {
  if (deadlineAt === null) return "";
  if (deadlineDays === 0) return "hari ini";
  if (deadlineDays !== null && deadlineDays < 0) {
    return `terlambat ${Math.abs(deadlineDays)} hari`;
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
  if (status === "done") return "Kembalikan ke Rencana";
  const title = AGENT_COLUMNS.find((column) => column.status === nextStatus(status, agent))?.title;
  return `Pindah ke ${title}`;
}

export function subLabel(card: Pick<TaskCard, "subDone" | "subTotal">): string | null {
  if (card.subTotal <= 0) return null;
  return `${card.subDone}/${card.subTotal}`;
}

export function toggleTaskStatus(status: TaskStatus): TaskStatus {
  return status === "done" ? "plan" : "done";
}

export function parentLabel(parentTitle: string | null | undefined): string {
  return parentTitle ? `↑ ${parentTitle}` : "↑ Induk";
}

export type ActivityFilter = "all" | "tasks" | "test";

export const ACTIVITY_FILTERS: readonly Readonly<{ id: ActivityFilter; label: string }>[] = [
  { id: "all", label: "Semua" },
  { id: "tasks", label: "Rencana & tugas" },
  { id: "test", label: "Tes" },
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
  "Jalankan tes",
  "Perbaiki tes yang gagal",
  "Lanjutkan tugas berikutnya",
  "Ringkas progres hari ini",
] as const;

export const AGENT_CLI_SNIPPET = `## Melapor ke Anchoa
- Status tugas: "$ANCHOA_CLI" agent task status --task "$ANCHOA_TASK" <STATUS> --actor <NAMA>
- Buat rencana: "$ANCHOA_CLI" agent plan --task "$ANCHOA_TASK" --actor <NAMA> --file <PATH.md>
- Catat log/tes: "$ANCHOA_CLI" agent log --task "$ANCHOA_TASK" --actor <NAMA> --role implement|test|review --body "..."`;
