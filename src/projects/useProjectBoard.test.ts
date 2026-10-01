import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { api, type Activity, type Board, type LastActor } from "../api";
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
  let openTaskId: string | null;
  let harness: ReturnType<typeof hookHarness<ReturnType<typeof useProjectBoard>>>;
  let timers: Map<number, () => void>;
  let spies: { mockRestore: () => void }[];
  let clearIntervalSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    selectedId = "A";
    version = 0;
    openTaskId = null;
    timers = new Map();
    let timerId = 0;
    spies = [
      spyOn(api, "projectBoard").mockImplementation(async (id) => board(id)),
      spyOn(api, "agentLastActors").mockImplementation(async (id) => ({ [`${id}-task`]: { actor: "Kamu", role: "note" } })),
      spyOn(api, "taskActivities").mockResolvedValue([activity("Kamu")]),
      spyOn(api, "agentRunning").mockResolvedValue(["A"]),
      spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, delay: number) => {
        expect(delay).toBe(3000);
        timers.set(++timerId, callback);
        return timerId;
      }) as unknown as typeof setInterval),
    ];
    clearIntervalSpy = spyOn(globalThis, "clearInterval").mockImplementation((id) => { timers.delete(Number(id)); });
    spies.push(clearIntervalSpy);
    harness = hookHarness(() => useProjectBoard(selectedId, version, openTaskId));
  });

  afterEach(() => {
    selectedId = undefined;
    harness.render();
    harness.dispose();
    spies.forEach((spy) => spy.mockRestore());
  });

  function poll() {
    [...timers.values()].forEach((run) => run());
  }

  it("polls one actor map and running state regardless of the number of completed cards", async () => {
    const data = board("A");
    data.columns.done = Array.from({ length: 100 }, (_, index) => ({
      ...data.columns.plan[0], id: `done-${index}`, status: "done",
    }));
    spyOn(api, "projectBoard").mockResolvedValue(data);
    harness.render();
    await harness.settle();
    expect(harness.render().running).toBe(true);
    expect(harness.render().lastActors["A-task"]).toEqual({ actor: "Kamu", role: "note" });
    expect(harness.render().activities).toBeUndefined();
    poll();
    await harness.settle();
    expect(api.projectBoard).toHaveBeenCalledTimes(2);
    expect(api.agentLastActors).toHaveBeenCalledTimes(2);
    expect(api.agentLastActors).toHaveBeenLastCalledWith("A");
    expect(api.taskActivities).not.toHaveBeenCalled();
    expect(api.agentRunning).toHaveBeenCalledTimes(2);
  });

  it("does not poll or fetch agent data for ordinary projects or loose tasks", async () => {
    spyOn(api, "projectBoard").mockImplementation(async (id) => board(id, false));
    openTaskId = "A-task";
    harness.render();
    await harness.settle();
    expect(timers.size).toBe(0);
    selectedId = null;
    harness.render();
    await harness.settle();
    expect(timers.size).toBe(0);
    expect(api.agentLastActors).not.toHaveBeenCalled();
    expect(api.taskActivities).not.toHaveBeenCalled();
    expect(api.agentRunning).not.toHaveBeenCalled();
  });

  it("discards an older board response after a newer poll completes", async () => {
    harness.render();
    await harness.settle();
    const old = deferred<Board>();
    spyOn(api, "projectBoard").mockReturnValueOnce(old.promise);
    poll();
    poll();
    await harness.settle();
    old.resolve(board("Old"));
    await harness.settle();
    expect(harness.render().board?.project?.id).toBe("A");
  });

  it("discards older actor map and runner responses", async () => {
    harness.render();
    await harness.settle();
    const oldActors = deferred<Record<string, LastActor>>();
    const oldRunning = deferred<string[]>();
    spyOn(api, "agentLastActors").mockReturnValueOnce(oldActors.promise);
    spyOn(api, "agentRunning").mockReturnValueOnce(oldRunning.promise);
    poll();
    await harness.settle();
    spyOn(api, "agentLastActors").mockResolvedValue({ "A-task": { actor: "Sol", role: "implement" } });
    spyOn(api, "agentRunning").mockResolvedValue([]);
    poll();
    await harness.settle();
    oldActors.resolve({ "A-task": { actor: "Ancien", role: "note" } });
    oldRunning.resolve(["A"]);
    await harness.settle();
    expect(harness.render().lastActors["A-task"].actor).toBe("Sol");
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
    expect(harness.render().lastActors["A-task"]).toBeUndefined();
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

  it("keeps the board and previous actors available when the actor map fails", async () => {
    harness.render();
    await harness.settle();
    expect(harness.render().board?.project?.id).toBe("A");
    expect(harness.render().running).toBe(true);
    spyOn(api, "agentLastActors").mockRejectedValueOnce(new Error("Unavailable"));
    poll();
    await harness.settle();
    expect(harness.render().lastActors["A-task"].actor).toBe("Kamu");
    expect(harness.render().board?.project?.id).toBe("A");
    poll();
    await harness.settle();
    expect(api.agentLastActors).toHaveBeenCalledTimes(3);
  });

  it("fetches only the open task on opening, polling, and changes", async () => {
    harness.render();
    await harness.settle();
    expect(api.taskActivities).not.toHaveBeenCalled();
    openTaskId = "A-task";
    harness.render();
    await harness.settle();
    expect(api.taskActivities).toHaveBeenCalledTimes(1);
    expect(api.taskActivities).toHaveBeenLastCalledWith("A-task");
    expect(harness.render().activities?.[0].actor).toBe("Kamu");
    expect(api.projectBoard).toHaveBeenCalledTimes(1);
    poll();
    await harness.settle();
    expect(api.taskActivities).toHaveBeenCalledTimes(2);
    version++;
    harness.render();
    await harness.settle();
    expect(api.taskActivities).toHaveBeenCalledTimes(3);
    openTaskId = null;
    expect(harness.render().activities).toBeUndefined();
    poll();
    await harness.settle();
    expect(api.taskActivities).toHaveBeenCalledTimes(3);
    openTaskId = "A-task";
    harness.render();
    await harness.settle();
    expect(api.taskActivities).toHaveBeenCalledTimes(4);
  });

  it("discards older open-thread responses while keeping newer activities", async () => {
    openTaskId = "A-task";
    harness.render();
    await harness.settle();
    const old = deferred<Activity[]>();
    spyOn(api, "taskActivities").mockReturnValueOnce(old.promise).mockResolvedValue([activity("Sol")]);
    poll();
    poll();
    await harness.settle();
    old.resolve([activity("Ancien")]);
    await harness.settle();
    expect(harness.render().activities?.[0].actor).toBe("Sol");
  });

  it("ignores in-flight thread responses after switching tasks or closing the panel", async () => {
    const data = board("A");
    data.columns.plan.push({ ...data.columns.plan[0], id: "second" });
    spyOn(api, "projectBoard").mockResolvedValue(data);
    const old = deferred<Activity[]>();
    spyOn(api, "taskActivities").mockReturnValueOnce(old.promise)
      .mockResolvedValue([{ ...activity("Sol"), taskId: "second" }]);
    openTaskId = "A-task";
    harness.render();
    await harness.settle();
    openTaskId = "second";
    expect(harness.render().activities).toBeUndefined();
    await harness.settle();
    old.resolve([activity("Ancien")]);
    await harness.settle();
    expect(harness.render().activities?.[0].taskId).toBe("second");
    const closing = deferred<Activity[]>();
    spyOn(api, "taskActivities").mockReturnValueOnce(closing.promise);
    poll();
    openTaskId = null;
    harness.render();
    closing.resolve([activity("Ancien")]);
    await harness.settle();
    expect(harness.render().activities).toBeUndefined();
  });

  it("hides the thread and ignores its requests when the project changes", async () => {
    const old = deferred<Activity[]>();
    spyOn(api, "taskActivities").mockReturnValueOnce(old.promise);
    openTaskId = "A-task";
    harness.render();
    await harness.settle();
    selectedId = "B";
    expect(harness.render().activities).toBeUndefined();
    await harness.settle();
    old.resolve([activity("Ancien")]);
    await harness.settle();
    expect(harness.render().activities).toBeUndefined();
    expect(api.taskActivities).toHaveBeenCalledTimes(1);
  });

  it("keeps board metadata available if the open thread fails and retries on polling", async () => {
    openTaskId = "A-task";
    spyOn(api, "taskActivities").mockRejectedValueOnce(new Error("Unavailable"));
    harness.render();
    await harness.settle();
    expect(harness.render().board?.project?.id).toBe("A");
    expect(harness.render().running).toBe(true);
    expect(harness.render().lastActors["A-task"].actor).toBe("Kamu");
    poll();
    await harness.settle();
    expect(harness.render().activities?.[0].actor).toBe("Kamu");
  });
});
