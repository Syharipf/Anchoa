import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import { api, type Activity, type Board, type ProjectDetail, type TaskCard } from "../api";
import { elements, hookHarness } from "../test/hookHarness";
import { AgentRequest } from "./AgentRequest";
import { AgentThread } from "./AgentThread";
import { Kanban } from "./Kanban";
import { ProjectList } from "./ProjectList";
import { ProjectsPage } from "./ProjectsPage";

const agent: ProjectDetail = { id: "agent", name: "Agen", kind: "app", description: "", deadlineAt: null,
  deadlineDays: null, repoUrl: null, agent: true, agentDir: null, agentCommand: null, status: "active", done: 0, total: 2 };
const ordinary = { ...agent, id: "ordinary", name: "Biasa", agent: false };
const task: TaskCard = { id: "task", title: "Tugas", status: "doing", tag: null, dueAt: null,
  overdue: false, subDone: 0, subTotal: 0, projectId: agent.id, projectName: agent.name };
const request: Activity = { id: "request", taskId: task.id, projectId: agent.id, actor: "Kamu",
  role: "request", kind: "message", title: "Tugas", body: "Tugas", createdAt: 1 };

describe("project page agent routing", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let spies: { mockRestore: () => void }[];
  const openItem = mock(() => {});
  const changed = mock(() => {});
  function props<T>(type: unknown): T {
    const element = elements(harness.render()).find((element) => element.type === type);
    expect(element).toBeDefined();
    return element!.props as T;
  }
  const kanban = () => props<ComponentProps<typeof Kanban>>(Kanban);
  const thread = () => props<ComponentProps<typeof AgentThread>>(AgentThread);
  const requestBox = () => props<ComponentProps<typeof AgentRequest>>(AgentRequest);
  const list = () => props<ComponentProps<typeof ProjectList>>(ProjectList);

  beforeEach(async () => {
    openItem.mockClear();
    changed.mockClear();
    spies = [
      spyOn(api, "projectsOverview").mockResolvedValue({ projects: [agent, ordinary], activeCount: 2, loose: { done: 0, total: 0 }, upcoming: [] }),
      spyOn(api, "projectBoard").mockImplementation(async (id): Promise<Board> => ({
        project: id === agent.id ? agent : ordinary,
        columns: { plan: [], doing: [task], test: [], review: [], done: [] },
      })),
      spyOn(api, "taskActivities").mockResolvedValue([request]),
      spyOn(api, "agentRunning").mockResolvedValue([]),
      spyOn(api, "updateTask").mockResolvedValue({ ...task, parentId: null, parentTitle: null, startAt: null, subtasks: [] }),
      spyOn(globalThis, "setInterval").mockImplementation((() => 1) as unknown as typeof setInterval),
      spyOn(globalThis, "clearInterval").mockImplementation(() => {}),
    ];
    harness = hookHarness(() => ProjectsPage({ onOpenItem: openItem, onChanged: changed }));
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
    kanban().onOpenItem(task.id);
    expect(thread().task.id).toBe(task.id);
    expect(openItem).not.toHaveBeenCalled();
    list().onSelect(ordinary.id);
    await harness.settle();
    expect(kanban().agent).toBe(false);
    kanban().onOpenItem(task.id);
    expect(openItem).toHaveBeenCalledWith(task.id);
    expect(elements(harness.render()).some((element) => element.type === AgentThread || element.type === AgentRequest)).toBe(false);
  });

  it("chooses the latest request's log even if a different card is open", async () => {
    const second = { ...task, id: "second" };
    spyOn(api, "projectBoard").mockResolvedValue({ project: agent, columns: { plan: [second], doing: [task], test: [], review: [], done: [] } });
    spyOn(api, "taskActivities").mockImplementation(async (id) => [{ ...request, taskId: id, createdAt: id === second.id ? 2 : 1 }]);
    requestBox().onRefresh();
    await harness.settle();
    kanban().onOpenItem(task.id);
    requestBox().onShowLog();
    expect(thread().showLog).toBe(true);
    expect(thread().task.id).toBe(second.id);
    kanban().onOpenItem(task.id);
    expect(thread().showLog).toBe(false);
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
    const oldRequestBox = requestBox();
    list().onSelect(ordinary.id);
    await harness.settle();
    oldRequestBox.onRequested(task);
    list().onSelect(agent.id);
    await harness.settle();
    expect(elements(harness.render()).some((element) => element.type === AgentThread)).toBe(false);
  });
});
