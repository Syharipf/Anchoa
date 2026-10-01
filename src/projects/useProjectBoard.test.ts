import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { api, type Activity, type Board } from "../api";
import { deferred, hookHarness } from "../test/hookHarness";
import { useProjectBoard } from "./useProjectBoard";

function board(id: string | null, agent = true): Board {
  return {
    project: id === null ? null : {
      id, name: id, kind: "app", description: "", deadlineAt: null, deadlineDays: null,
      repoUrl: null, agent, agentCommand: null, agentDir: null, status: "active", done: 0, total: 1,
    },
    columns: { plan: [{
      id: `${id}-task`, title: "Tugas", status: "plan", tag: null, dueAt: null,
      overdue: false, subDone: 0, subTotal: 0, projectId: id, projectName: id,
    }], doing: [], test: [], review: [], done: [] },
  };
}

function activity(actor: string): Activity {
  return { id: actor, taskId: "A-task", projectId: "A", actor, role: "note", kind: "message",
    title: "", body: actor, createdAt: 1 };
}

describe("project board polling", () => {
  let selectedId: string | null | undefined;
  let version: number;
  let harness: ReturnType<typeof hookHarness<ReturnType<typeof useProjectBoard>>>;
  let poll: (() => void) | undefined;
  let spies: { mockRestore: () => void }[];
  let clearIntervalSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    selectedId = "A";
    version = 0;
    poll = undefined;
    spies = [
      spyOn(api, "projectBoard").mockImplementation(async (id) => board(id)),
      spyOn(api, "taskActivities").mockResolvedValue([activity("Kamu")]),
      spyOn(api, "agentRunning").mockResolvedValue(["A"]),
      spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, delay: number) => {
        expect(delay).toBe(3000);
        poll = callback;
        return 1;
      }) as unknown as typeof setInterval),
    ];
    clearIntervalSpy = spyOn(globalThis, "clearInterval").mockImplementation(() => {});
    spies.push(clearIntervalSpy);
    harness = hookHarness(() => useProjectBoard(selectedId, version));
  });

  afterEach(() => {
    harness.dispose();
    spies.forEach((spy) => spy.mockRestore());
  });

  it("refreshes the board, all task activities, and running state every three seconds", async () => {
    harness.render();
    await harness.settle();
    expect(harness.render().running).toBe(true);
    expect(harness.render().activities["A-task"][0].actor).toBe("Kamu");
    poll!();
    await harness.settle();
    expect(api.projectBoard).toHaveBeenCalledTimes(2);
    expect(api.taskActivities).toHaveBeenCalledTimes(2);
    expect(api.agentRunning).toHaveBeenCalledTimes(2);
  });

  it("does not poll or fetch agent data for ordinary projects or loose tasks", async () => {
    spyOn(api, "projectBoard").mockImplementation(async (id) => board(id, false));
    harness.render();
    await harness.settle();
    expect(poll).toBeUndefined();
    selectedId = null;
    harness.render();
    await harness.settle();
    expect(poll).toBeUndefined();
    expect(api.taskActivities).not.toHaveBeenCalled();
    expect(api.agentRunning).not.toHaveBeenCalled();
  });

  it("discards an older board response after a newer poll completes", async () => {
    harness.render();
    await harness.settle();
    const old = deferred<Board>();
    spyOn(api, "projectBoard").mockReturnValueOnce(old.promise);
    poll!();
    poll!();
    await harness.settle();
    old.resolve(board("Old"));
    await harness.settle();
    expect(harness.render().board?.project?.id).toBe("A");
  });

  it("discards older activity and runner responses", async () => {
    harness.render();
    await harness.settle();
    const oldActivities = deferred<Activity[]>();
    const oldRunning = deferred<string[]>();
    spyOn(api, "taskActivities").mockReturnValueOnce(oldActivities.promise);
    spyOn(api, "agentRunning").mockReturnValueOnce(oldRunning.promise);
    poll!();
    await harness.settle();
    spyOn(api, "taskActivities").mockResolvedValue([activity("Sol")]);
    spyOn(api, "agentRunning").mockResolvedValue([]);
    poll!();
    await harness.settle();
    oldActivities.resolve([activity("Ancien")]);
    oldRunning.resolve(["A"]);
    await harness.settle();
    expect(harness.render().activities["A-task"][0].actor).toBe("Sol");
    expect(harness.render().running).toBe(false);
  });

  it("hides old project data on selection and ignores its in-flight requests", async () => {
    const old = deferred<Board>();
    spyOn(api, "projectBoard").mockReturnValueOnce(old.promise);
    harness.render();
    selectedId = "B";
    expect(harness.render().board).toBeNull();
    await harness.settle();
    old.resolve(board("A"));
    await harness.settle();
    expect(harness.render().board?.project?.id).toBe("B");
    expect(harness.render().activities["A-task"]).toBeUndefined();
  });

  it("cleans up polling when refreshing and when no project is selected", async () => {
    harness.render();
    await harness.settle();
    version++;
    harness.render();
    await harness.settle();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    selectedId = undefined;
    harness.render();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps the board available when one activity request fails", async () => {
    spyOn(api, "taskActivities").mockRejectedValueOnce(new Error("Unavailable"));
    harness.render();
    await harness.settle();
    expect(harness.render().board?.project?.id).toBe("A");
    expect(harness.render().running).toBe(true);
    poll!();
    await harness.settle();
    expect(harness.render().activities["A-task"][0].actor).toBe("Kamu");
  });
});
