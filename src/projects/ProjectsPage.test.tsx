import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import { api, type Activity, type Board, type ProjectDetail, type TaskCard } from "../api";
import { deferred, elements, hookHarness } from "../test/hookHarness";
import { AgentRequest } from "./AgentRequest";
import { AgentTab } from "./AgentTab";
import { AgentThread } from "./AgentThread";
import { Kanban } from "./Kanban";
import { ProjectHeader } from "./ProjectHeader";
import { ProjectList } from "./ProjectList";
import { ProjectsPage } from "./ProjectsPage";

const agent: ProjectDetail = { id: "agent", name: "Agen", kind: "app", description: "", deadlineAt: null,
  deadlineDays: null, repoUrl: null, agent: true, agentDir: null, agentCommand: null, status: "active", done: 0, total: 2 };
const ordinary = { ...agent, id: "ordinary", name: "Biasa", agent: false };
const task: TaskCard = { id: "0199a1b0-0000-7000-8000-000000000001", title: "Tugas", status: "doing", tag: null, dueAt: null,
  overdue: false, subDone: 0, subTotal: 0, projectId: agent.id, projectName: agent.name, priority: null };
const request: Activity = { id: "request", taskId: task.id, projectId: agent.id, actor: "Kamu",
  role: "request", kind: "message", title: "Tugas", body: "Tugas", createdAt: 1 };

describe("project page agent routing", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let spies: { mockRestore: () => void }[];
  let timers: Map<number, () => void>;
  const openItem = mock(() => {});
  const changed = mock(() => {});
  function props<T>(type: unknown): T {
    const element = elements(harness.render()).find((element) => element.type === type);
    expect(element).toBeDefined();
    return element!.props as T;
  }
  const kanban = () => props<ComponentProps<typeof Kanban>>(Kanban);
  const thread = () => props<ComponentProps<typeof AgentThread>>(AgentThread);
  const list = () => props<ComponentProps<typeof ProjectList>>(ProjectList);
  const header = () => props<ComponentProps<typeof ProjectHeader>>(ProjectHeader);
  const agentTab = () => props<ComponentProps<typeof AgentTab>>(AgentTab);

  beforeEach(async () => {
    openItem.mockClear();
    changed.mockClear();
    timers = new Map();
    let timerId = 0;
    spies = [
      spyOn(api, "projectsOverview").mockResolvedValue({ projects: [agent, ordinary], activeCount: 2, loose: { done: 0, total: 0 }, upcoming: [] }),
      spyOn(api, "projectBoard").mockImplementation(async (id): Promise<Board> => ({
        project: id === agent.id ? agent : ordinary,
        columns: { plan: [], doing: [task], test: [], review: [], done: [] },
        tags: [],
      })),
      spyOn(api, "taskActivities").mockResolvedValue([request]),
      spyOn(api, "projectActivities").mockResolvedValue([request]),
      spyOn(api, "agentLastActors").mockResolvedValue({ [task.id]: { actor: "Sol", role: "implement" } }),
      spyOn(api, "agentRunning").mockResolvedValue([]),
      spyOn(api, "updateTask").mockResolvedValue({ ...task, parentId: null, parentTitle: null, startAt: null, subtasks: [] }),
      spyOn(globalThis, "setInterval").mockImplementation(((run: () => void) => {
        timers.set(++timerId, run);
        return timerId;
      }) as unknown as typeof setInterval),
      spyOn(globalThis, "clearInterval").mockImplementation((id) => { timers.delete(Number(id)); }),
    ];
    harness = hookHarness(() => ProjectsPage({ onOpenItem: openItem, onChanged: changed, onOpenAssistant: () => {} }));
    harness.render();
    await harness.settle();
  });

  afterEach(() => {
    // Changing the selection exercises the effect cleanup before disposing the harness.
    list().onSelect(null);
    harness.render();
    harness.dispose();
    spies.forEach((spy) => spy.mockRestore());
  });

  it("opens agent cards in Utas and ordinary cards in the existing item view", async () => {
    expect(kanban().agent).toBe(true);
    expect(kanban().lastActors?.[task.id]).toEqual({ actor: "Sol", role: "implement" });
    expect(api.taskActivities).not.toHaveBeenCalled();
    kanban().onOpenItem(task.id);
    expect(thread().task.id).toBe(task.id);
    await harness.settle();
    expect(thread().activities).toEqual([request]);
    expect(api.taskActivities).toHaveBeenCalledTimes(1);
    expect(api.taskActivities).toHaveBeenLastCalledWith(task.id);
    expect(openItem).not.toHaveBeenCalled();
    list().onSelect(ordinary.id);
    await harness.settle();
    expect(kanban().agent).toBe(false);
    kanban().onOpenItem(task.id);
    expect(openItem).toHaveBeenCalledWith(task.id);
    expect(elements(harness.render()).some((element) => element.type === AgentThread || element.type === AgentRequest || element.type === AgentTab)).toBe(false);
  });

  it("chooses the newest attributed card's log without reading closed threads", async () => {
    const second = { ...task, id: "0199a1b0-0000-7000-8000-000000000002" };
    // Newest, but only moved by the user: no agent ran for it, so its log is not the one to show.
    const manual = { ...task, id: "0199a1b0-0000-7000-8000-000000000003" };
    spyOn(api, "projectBoard").mockResolvedValue({ project: agent, columns: { plan: [second, manual], doing: [task], test: [], review: [], done: [] }, tags: [] });
    spyOn(api, "agentLastActors").mockResolvedValue({
      [task.id]: { actor: "Sol", role: "implement" },
      [second.id]: { actor: "Kamu", role: "request" },
      [manual.id]: { actor: "Kamu", role: "note" },
    });
    header().onTabChange?.("agent");
    await harness.settle();
    agentTab().onRefresh();
    header().onTabChange?.("kanban");
    await harness.settle();
    kanban().onOpenItem(task.id);
    header().onTabChange?.("agent");
    await harness.settle();
    agentTab().onShowLog();
    await harness.settle();
    expect(thread().showLog).toBe(true);
    expect(thread().task.id).toBe(second.id);
    await harness.settle();
    expect(api.taskActivities).toHaveBeenCalledTimes(1);
    expect(api.taskActivities).toHaveBeenLastCalledWith(task.id);
    kanban().onOpenItem(task.id);
    expect(thread().showLog).toBe(false);
  });

  it("polls only the open thread and refreshes it after reply and status callbacks", async () => {
    kanban().onOpenItem(task.id);
    await harness.settle();
    expect(api.taskActivities).toHaveBeenCalledTimes(1);
    [...timers.values()].forEach((run) => run());
    await harness.settle();
    expect(api.taskActivities).toHaveBeenCalledTimes(2);
    const reply = { ...request, id: "reply", role: "note" as const, body: "Balasan", createdAt: 2 };
    spyOn(api, "taskActivities").mockResolvedValue([request, reply]);
    thread().onChanged();
    await harness.settle();
    expect(api.taskActivities).toHaveBeenCalledTimes(3);
    expect(thread().activities).toEqual([request, reply]);
    await kanban().onMoveCard(task);
    await harness.settle();
    expect(api.taskActivities).toHaveBeenCalledTimes(4);
    thread().onChanged();
    await harness.settle();
    expect(api.taskActivities).toHaveBeenCalledTimes(5);
    thread().onClose();
    harness.render();
    [...timers.values()].forEach((run) => run());
    await harness.settle();
    expect(api.taskActivities).toHaveBeenCalledTimes(5);
    expect(api.projectBoard).toHaveBeenCalledTimes(6);
  });

  it("discards a pending thread after selecting a different card", async () => {
    const second = { ...task, id: "second" };
    spyOn(api, "projectBoard").mockResolvedValue({ project: agent, columns: { plan: [second], doing: [task], test: [], review: [], done: [] }, tags: [] });
    header().onTabChange?.("agent");
    await harness.settle();
    agentTab().onRefresh();
    header().onTabChange?.("kanban");
    await harness.settle();
    const old = deferred<Activity[]>();
    const secondActivity = { ...request, taskId: second.id, actor: "Gemini" };
    spyOn(api, "taskActivities").mockReturnValueOnce(old.promise).mockResolvedValue([secondActivity]);
    kanban().onOpenItem(task.id);
    harness.render();
    kanban().onOpenItem(second.id);
    await harness.settle();
    old.resolve([request]);
    await harness.settle();
    expect(thread().task.id).toBe(second.id);
    expect(thread().activities).toEqual([secondActivity]);
    expect(api.taskActivities).toHaveBeenCalledTimes(2);
  });

  it("advances agent cards to Tes while ordinary cards still advance to Selesai", async () => {
    await kanban().onMoveCard(task);
    await harness.settle();
    expect(api.updateTask).toHaveBeenLastCalledWith(task.id, { status: "test" });
    list().onSelect(ordinary.id);
    await harness.settle();
    await kanban().onMoveCard(task);
    expect(api.updateTask).toHaveBeenLastCalledWith(task.id, { status: "done" });
  });

  it("does not reopen an old project's thread when a request finishes after switching projects", async () => {
    header().onTabChange?.("agent");
    await harness.settle();
    const oldAgentTab = agentTab();
    list().onSelect(ordinary.id);
    await harness.settle();
    oldAgentTab.onRequested(task);
    list().onSelect(agent.id);
    await harness.settle();
    expect(elements(harness.render()).some((element) => element.type === AgentThread)).toBe(false);
  });

  it("switches between Kanban and Agen kode tabs and opens task thread via Lihat di Kanban", async () => {
    expect(header().tab).toBe("kanban");
    expect(elements(harness.render()).some((e) => e.type === Kanban)).toBe(true);
    expect(elements(harness.render()).some((e) => e.type === AgentTab)).toBe(false);

    header().onTabChange?.("agent");
    await harness.settle();
    expect(header().tab).toBe("agent");
    expect(elements(harness.render()).some((e) => e.type === AgentTab)).toBe(true);
    expect(elements(harness.render()).some((e) => e.type === Kanban)).toBe(false);

    // Clicking 'Lihat di Kanban' switches tab to kanban and opens the thread panel
    agentTab().onOpenTaskInKanban(task.id);
    await harness.settle();
    expect(header().tab).toBe("kanban");
    expect(elements(harness.render()).some((e) => e.type === Kanban)).toBe(true);
    expect(thread().task.id).toBe(task.id);
  });

  it("handles dropping a card to a new column", async () => {
    kanban().onDropCard?.(task, "test");
    await harness.settle();
    expect(api.updateTask).toHaveBeenCalledWith(task.id, { status: "test" });
    expect(changed).toHaveBeenCalled();
  });

  it("provides card context menu with delete and undo restore", async () => {
    const deleteTaskSpy = spyOn(api, "deleteTask").mockResolvedValue();
    const restoreTaskSpy = spyOn(api, "restoreTask").mockResolvedValue();
    spies.push(deleteTaskSpy, restoreTaskSpy);

    const menu = kanban().cardMenu?.(task);
    expect(menu).toBeDefined();
    const deleteEntry = menu?.find((e) => typeof e === "object" && e.label === "Hapus");
    expect(deleteEntry && typeof deleteEntry === "object" && deleteEntry.danger).toBe(true);

    if (deleteEntry && typeof deleteEntry === "object") {
      deleteEntry.onSelect();
      await harness.settle();
      expect(deleteTaskSpy).toHaveBeenCalledWith(task.id);
    }
  });

  it("provides launch with agent in task context menu for agent projects", async () => {
    const launchSpy = spyOn(api, "agentLaunchTask").mockResolvedValue();
    spies.push(launchSpy);

    const menu = kanban().cardMenu?.(task);
    const launchEntry = menu?.find((e) => typeof e === "object" && e.label === "Jalankan dengan agen");
    expect(launchEntry).toBeDefined();
    if (launchEntry && typeof launchEntry === "object") {
      launchEntry.onSelect();
      await harness.settle();
      expect(launchSpy).toHaveBeenCalledWith(agent.id, task.id);
    }
  });
});
