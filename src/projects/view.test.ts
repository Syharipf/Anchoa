import { describe, expect, test } from "bun:test";
import {
  KIND_LABELS,
  STATUS_LABELS,
  deadlineLabel,
  moveLabel,
  nextStatus,
  parentLabel,
  subLabel,
  toggleTaskStatus,
} from "./view";

describe("project view helpers", () => {
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
