import type { ProjectKind, ProjectStatus, TaskCard, TaskStatus } from "../api";
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

export function deadlineLabel(deadlineAt: number | null, deadlineDays: number | null): string {
  if (deadlineAt === null) return "";
  if (deadlineDays === 0) return "hari ini";
  if (deadlineDays !== null && deadlineDays < 0) {
    return `terlambat ${Math.abs(deadlineDays)} hari`;
  }
  return shortDate(deadlineAt);
}

export function nextStatus(status: TaskStatus): TaskStatus {
  if (status === "plan") return "doing";
  if (status === "doing") return "done";
  return "plan";
}

export function moveLabel(status: TaskStatus): string {
  if (status === "plan") return "Pindah ke Dikerjakan";
  if (status === "doing") return "Pindah ke Selesai";
  return "Kembalikan ke Rencana";
}

export function subLabel(card: Pick<TaskCard, "subDone" | "subTotal">): string | null {
  if (card.subTotal <= 0) return null;
  return `${card.subDone}/${card.subTotal}`;
}
