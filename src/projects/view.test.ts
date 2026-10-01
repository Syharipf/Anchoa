import { describe, expect, test } from "bun:test";
import {
  KIND_LABELS,
  ROLE_LABELS,
  STATUS_LABELS,
  actorInitials,
  boardColumns,
  deadlineLabel,
  lastActivity,
  moveLabel,
  nextStatus,
  parentLabel,
  subLabel,
  toggleTaskStatus,
} from "./view";

describe("project view helpers", () => {
  test("ordinary projects keep their three columns", () => {
    expect(boardColumns(false).map(({ status, title }) => [status, title])).toEqual([
      ["plan", "Rencana"], ["doing", "Dikerjakan"], ["done", "Selesai"],
    ]);
  });

  test("agent projects show all five columns in workflow order", () => {
    expect(boardColumns(true).map(({ status, title }) => [status, title])).toEqual([
      ["plan", "Rencana"], ["doing", "Dikerjakan"], ["test", "Tes"],
      ["review", "Review"], ["done", "Selesai"],
    ]);
  });

  test("activity roles have Indonesian labels", () => {
    expect(ROLE_LABELS).toEqual({
      request: "Permintaan", plan: "Rencana", implement: "Implementasi", test: "Tes",
      review: "Review", merge: "Merge", note: "Catatan",
    });
  });

  test("actor avatars use at most two uppercase initials", () => {
    expect(actorInitials("Sol")).toBe("S");
    expect(actorInitials("Kamu")).toBe("K");
    expect(actorInitials("  Claude   Code  ")).toBe("CC");
    expect(actorInitials("Gemini CLI Agent")).toBe("GC");
    expect(actorInitials("Élodie Agent")).toBe("ÉA");
    expect(actorInitials(" 🐟 ")).toBe("🐟");
    expect(actorInitials("   ")).toBe("?");
  });

  test("card attribution uses the newest activity without reordering the thread", () => {
    const activities = [
      { actor: "Sol", role: "implement" as const, createdAt: 30 },
      { actor: "Kamu", role: "request" as const, createdAt: 10 },
      { actor: "Gemini", role: "review" as const, createdAt: 20 },
    ];
    expect(lastActivity(activities)?.actor).toBe("Sol");
    expect(activities[0].actor).toBe("Sol");
    expect(lastActivity([])).toBeNull();
    expect(lastActivity([{ ...activities[0] }, { ...activities[2], createdAt: 30 }])?.actor).toBe("Gemini");
  });

  test("kind labels map every ProjectKind to Indonesian", () => {
    expect(KIND_LABELS.app).toBe("Aplikasi");
    expect(KIND_LABELS.document).toBe("Dokumen");
    expect(KIND_LABELS.research).toBe("Riset");
    expect(KIND_LABELS.personal).toBe("Pribadi");
  });

  test("status labels provide label and tone", () => {
    expect(STATUS_LABELS.active).toEqual({ label: "Aktif", tone: "accent" });
    expect(STATUS_LABELS.late).toEqual({ label: "Terlambat", tone: "danger" });
    expect(STATUS_LABELS.done).toEqual({ label: "Selesai", tone: "muted" });
  });

  test("deadlineLabel formats empty, today, late, and future dates", () => {
    // 31 Oktober 2026 00:00:00 WIB (local)
    const oct31 = new Date(2026, 9, 31).getTime();

    expect(deadlineLabel(null, null)).toBe("");
    expect(deadlineLabel(null, 5)).toBe("");
    expect(deadlineLabel(oct31, 0)).toBe("hari ini");
    expect(deadlineLabel(oct31, -1)).toBe("terlambat 1 hari");
    expect(deadlineLabel(oct31, -3)).toBe("terlambat 3 hari");
    expect(deadlineLabel(oct31, 32)).toBe("31 Okt");
    expect(deadlineLabel(oct31, null)).toBe("31 Okt");
  });

  test("nextStatus cycles plan -> doing -> done -> plan", () => {
    expect(nextStatus("plan")).toBe("doing");
    expect(nextStatus("doing")).toBe("done");
    expect(nextStatus("test")).toBe("done");
    expect(nextStatus("review")).toBe("done");
    expect(nextStatus("done")).toBe("plan");
  });

  test("agent card buttons follow all five workflow columns", () => {
    expect(nextStatus("plan", true)).toBe("doing");
    expect(nextStatus("doing", true)).toBe("test");
    expect(nextStatus("test", true)).toBe("review");
    expect(nextStatus("review", true)).toBe("done");
    expect(nextStatus("done", true)).toBe("plan");
    expect(moveLabel("doing", true)).toBe("Pindah ke Tes");
    expect(moveLabel("test", true)).toBe("Pindah ke Review");
    expect(moveLabel("review", true)).toBe("Pindah ke Selesai");
    expect(moveLabel("done", true)).toBe("Kembalikan ke Rencana");
  });

  test("moveLabel provides button aria-labels for each column", () => {
    expect(moveLabel("plan")).toBe("Pindah ke Dikerjakan");
    expect(moveLabel("doing")).toBe("Pindah ke Selesai");
    expect(moveLabel("test")).toBe("Pindah ke Selesai");
    expect(moveLabel("review")).toBe("Pindah ke Selesai");
    expect(moveLabel("done")).toBe("Kembalikan ke Rencana");
  });

  test("subLabel formats subtask progress or returns null if none", () => {
    expect(subLabel({ subTotal: 0, subDone: 0 })).toBeNull();
    expect(subLabel({ subTotal: 5, subDone: 3 })).toBe("3/5");
    expect(subLabel({ subTotal: 1, subDone: 0 })).toBe("0/1");
  });

  test("toggleTaskStatus toggles done to plan and plan/doing to done", () => {
    expect(toggleTaskStatus("done")).toBe("plan");
    expect(toggleTaskStatus("plan")).toBe("done");
    expect(toggleTaskStatus("doing")).toBe("done");
    expect(toggleTaskStatus("test")).toBe("done");
    expect(toggleTaskStatus("review")).toBe("done");
  });

  test("parentLabel formats parent title with arrow", () => {
    expect(parentLabel("Tugas Induk")).toBe("↑ Tugas Induk");
    expect(parentLabel(null)).toBe("↑ Induk");
    expect(parentLabel(undefined)).toBe("↑ Induk");
  });
});
