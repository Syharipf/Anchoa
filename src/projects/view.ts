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
