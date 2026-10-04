import { describe, expect, test } from "bun:test";
import type { Columns, Priority, TaskCard } from "../api";
import {
  ACTIVITY_FILTERS,
  AGENT_QUICK_BUTTONS,
  KIND_LABELS,
  ROLE_LABELS,
  STATUS_LABELS,
  actorInitials,
  boardColumns,
  connectedAgents,
  deadlineLabel,
  filterActivities,
  lastActivity,
  matchActivityFilter,
  moveLabel,
  nextStatus,
  parentLabel,
  subLabel,
  toggleTaskStatus,
  PRIORITY_LABELS,
  dropTarget,
  hasFilter,
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

  test("activity filters define standard filter categories", () => {
    expect(ACTIVITY_FILTERS.map((f) => [f.id, f.label])).toEqual([
      ["all", "Semua"],
      ["tasks", "Rencana & tugas"],
      ["test", "Tes"],
    ]);
  });

  test("filterActivities filters activities by role and status kind", () => {
    const items = [
      { id: "1", role: "request" as const, kind: "message" as const },
      { id: "2", role: "plan" as const, kind: "result" as const },
      { id: "3", role: "implement" as const, kind: "message" as const },
      { id: "4", role: "merge" as const, kind: "link" as const },
      { id: "5", role: "test" as const, kind: "result" as const },
      { id: "6", role: "review" as const, kind: "message" as const },
      { id: "7", role: "test" as const, kind: "status" as const },
      { id: "8", role: "note" as const, kind: "message" as const },
    ];

    expect(filterActivities(items, "all").map((i) => i.id)).toEqual([
      "1", "2", "3", "4", "5", "6", "7", "8",
    ]);

    // Rencana & tugas: request, plan, implement, merge, or kind: status
    expect(filterActivities(items, "tasks").map((i) => i.id)).toEqual([
      "1", "2", "3", "4", "7",
    ]);

    // Tes: test or review
    expect(filterActivities(items, "test").map((i) => i.id)).toEqual([
      "5", "6", "7",
    ]);

    expect(matchActivityFilter({ role: "request", kind: "message" }, "tasks")).toBe(true);
    expect(matchActivityFilter({ role: "test", kind: "message" }, "tasks")).toBe(false);
    expect(matchActivityFilter({ role: "test", kind: "result" }, "test")).toBe(true);
    expect(matchActivityFilter({ role: "request", kind: "message" }, "all")).toBe(true);
  });

  test("connectedAgents lists unique non-user actors with latest timestamp and initials", () => {
    const activities = [
      { actor: "Claude Code", createdAt: 100 },
      { actor: "Sol", createdAt: 200 },
      { actor: "Kamu", createdAt: 300 },
      { actor: "Anchoa", createdAt: 400 },
      { actor: "kamu", createdAt: 500 },
      { actor: "anchoa", createdAt: 600 },
      { actor: "Claude Code", createdAt: 700 },
      { actor: "  Opus 5.5  ", createdAt: 150 },
      { actor: "", createdAt: 800 },
      { actor: "   ", createdAt: 900 },
    ];

    const agents = connectedAgents(activities);
    expect(agents).toEqual([
      { name: "Claude Code", initials: "CC", lastActiveAt: 700 },
      { name: "Sol", initials: "S", lastActiveAt: 200 },
      { name: "Opus 5.5", initials: "O5", lastActiveAt: 150 },
    ]);
  });

  test("connectedAgents returns empty list when only Kamu/Anchoa or empty", () => {
    expect(connectedAgents([])).toEqual([]);
    expect(connectedAgents([{ actor: "Kamu", createdAt: 10 }, { actor: "Anchoa", createdAt: 20 }])).toEqual([]);
  });

  test("quick buttons provide standard prompts", () => {
    expect(AGENT_QUICK_BUTTONS).toEqual([
      "Jalankan tes",
      "Perbaiki tes yang gagal",
      "Lanjutkan tugas berikutnya",
      "Ringkas progres hari ini",
    ]);
  });

  test("dropTarget only returns cards that change column", () => {
    const card: TaskCard = { id: "a", title: "A", status: "plan", tag: null, dueAt: null, overdue: false,
      subDone: 0, subTotal: 0, projectId: null, projectName: null, priority: null };
    const columns: Columns = { plan: [card], doing: [], test: [], review: [], done: [] };
    expect(dropTarget(columns, "a", "doing")).toBe(card);
    expect(dropTarget(columns, "a", "plan")).toBeNull();
    expect(dropTarget(columns, "missing", "doing")).toBeNull();
  });

  test("hasFilter ignores a blank search and priority labels follow the spec", () => {
    expect(hasFilter({})).toBe(false);
    expect(hasFilter({ query: "  " })).toBe(false);
    expect(hasFilter({ due: "none" })).toBe(true);
    expect([1, 2, 3].map((p) => PRIORITY_LABELS[p as Priority].label)).toEqual(["Tinggi", "Sedang", "Rendah"]);
  });
});

