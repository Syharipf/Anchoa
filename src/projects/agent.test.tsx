import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FormEvent, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type Activity, type ProjectDetail, type TaskCard } from "../api";
import { deferred, elements, hookHarness } from "../test/hookHarness";
import { AgentRequest } from "./AgentRequest";
import { AgentLog, AgentThread } from "./AgentThread";
import { Kanban } from "./Kanban";
import { ProjectForm } from "./ProjectForm";

const project: ProjectDetail = {
  id: "project", name: "Anchoa", kind: "app", description: "", deadlineAt: null,
  deadlineDays: null, repoUrl: null, agent: true, agentDir: "/home/kamu/repo",
  agentCommand: 'claude -p "$ANCHOA_REQUEST"', status: "active", done: 0, total: 1,
};
const task: TaskCard = { id: "task", title: "Buat fitur", status: "plan", tag: null,
  dueAt: null, overdue: false, subDone: 0, subTotal: 0, projectId: project.id, projectName: project.name };
const activity: Activity = { id: "activity", taskId: task.id, projectId: project.id,
  actor: "Claude Code", role: "implement", kind: "message", title: "", body: "**Selesai**\n\n```ts\nlet a = 1;\n\nlet b = 2;\n```", createdAt: Date.now() };
const event = { preventDefault() {} } as FormEvent;

describe("agent project components", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>> | undefined;
  const spies: { mockRestore: () => void }[] = [];
  afterEach(() => {
    harness?.dispose();
    harness = undefined;
    spies.splice(0).forEach((spy) => spy.mockRestore());
  });
  function control(type: string, match: (props: Record<string, unknown>) => boolean = () => true) {
    return elements(harness!.render()).find((element) => element.type === type && match(element.props))!.props;
  }
  function change(type: string, value: string, match?: (props: Record<string, unknown>) => boolean) {
    (control(type, match).onChange as (event: unknown) => void)({ target: { value } });
  }

  it("keeps ordinary kanban markup to three columns and omits activity attribution", () => {
    const html = renderToStaticMarkup(<Kanban columns={{ plan: [task], doing: [], test: [], review: [], done: [] }}
      activities={{ [task.id]: [activity] }} onOpenItem={() => {}} onMoveCard={() => {}} onCreateTask={async () => {}} />);
    expect(html.match(/<section/g)?.length).toBe(3);
    expect(html).not.toContain("Claude Code");
  });

  it("shows attribution on unfinished and completed agent cards", () => {
    const done = { ...task, id: "done", status: "done" as const };
    const html = renderToStaticMarkup(<Kanban agent columns={{ plan: [task], doing: [], test: [], review: [], done: [done] }}
      activities={{ [task.id]: [activity], [done.id]: [activity] }} onOpenItem={() => {}} onMoveCard={() => {}} onCreateTask={async () => {}} />);
    expect(html.match(/<section/g)?.length).toBe(5);
    expect(html.match(/Claude Code · implement<\/span>/g)?.length).toBe(2);
  });

  it("renders chronological activity metadata and Markdown including fenced blank lines", () => {
    const older = { ...activity, id: "old", actor: "Kamu", role: "request" as const, body: "Permintaan awal", createdAt: 1 };
    const html = renderToStaticMarkup(<AgentThread task={task} activities={[activity, older]}
      onChanged={() => {}} onClose={() => {}} onOpenItem={() => {}} />);
    expect(html.indexOf("Permintaan awal")).toBeLessThan(html.indexOf("<strong"));
    expect(html).toContain("Implementasi");
    expect(html).toContain(">CC</span>");
    expect(html).toContain("baru saja");
    expect(html).toContain("<strong");
    expect(html).toContain("let a = 1;\n\nlet b = 2;");
  });

  it("writes a reply as Kamu with the note role and preserves it on failure", async () => {
    spies.push(spyOn(api, "addActivity").mockRejectedValueOnce(new Error("Failed")).mockResolvedValue(activity));
    const changed = mock(() => {});
    harness = hookHarness(() => AgentThread({ task, activities: [], onChanged: changed, onClose: () => {}, onOpenItem: () => {} }));
    change("textarea", "  Balasan **tebal**  ");
    await (control("form").onSubmit as (event: FormEvent) => Promise<void>)(event);
    await harness.settle();
    expect(control("textarea").value).toBe("  Balasan **tebal**  ");
    await (control("form").onSubmit as (event: FormEvent) => Promise<void>)(event);
    await harness.settle();
    expect(api.addActivity).toHaveBeenLastCalledWith({ taskId: "task", projectId: "project", actor: "Kamu",
      role: "note", kind: "message", title: "Balasan **tebal**", body: "Balasan **tebal**" });
    expect(control("textarea").value).toBe("");
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("uses updateTask for thread status changes", async () => {
    spies.push(spyOn(api, "updateTask").mockResolvedValue({ ...task, startAt: null, parentId: null, parentTitle: null, subtasks: [] }));
    const changed = mock(() => {});
    harness = hookHarness(() => AgentThread({ task, activities: [], onChanged: changed, onClose: () => {}, onOpenItem: () => {} }));
    await (control("button", (props) => props.children === "Tes").onClick as () => Promise<void>)();
    await harness.settle();
    expect(api.updateTask).toHaveBeenCalledWith(task.id, { status: "test" });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("starts an agent only when Kirim is submitted and stops it on Hentikan", async () => {
    spies.push(spyOn(api, "agentRequest").mockResolvedValue(task), spyOn(api, "agentStop").mockResolvedValue());
    const requested = mock(() => {});
    const refreshed = mock(() => {});
    let running = false;
    harness = hookHarness(() => AgentRequest({ project, running, logAvailable: true,
      onRequested: requested, onRefresh: refreshed, onShowLog: () => {} }));
    harness.render();
    expect(api.agentRequest).not.toHaveBeenCalled();
    change("textarea", "  Buat fitur  ");
    await (control("form").onSubmit as (event: FormEvent) => Promise<void>)(event);
    await harness.settle();
    expect(api.agentRequest).toHaveBeenCalledWith(project.id, "Buat fitur");
    expect(requested).toHaveBeenCalledWith(task);
    running = true;
    harness.render();
    expect(control("button", (props) => props.children === "Kirim").disabled).toBe(true);
    await (control("button", (props) => props.children === "Hentikan").onClick as () => Promise<void>)();
    await harness.settle();
    expect(api.agentStop).toHaveBeenCalledWith(project.id);
    expect(refreshed).toHaveBeenCalledTimes(2);
  });

  it("keeps a failed request editable and prevents a second submission while sending", async () => {
    const pending = deferred<TaskCard>();
    spies.push(spyOn(api, "agentRequest").mockReturnValueOnce(pending.promise));
    harness = hookHarness(() => AgentRequest({ project, running: false, logAvailable: false,
      onRequested: () => {}, onRefresh: () => {}, onShowLog: () => {} }));
    change("textarea", "Ne izgubi");
    const submit = control("form").onSubmit as (event: FormEvent) => Promise<void>;
    const sending = submit(event);
    await harness.settle();
    await (control("form").onSubmit as typeof submit)(event);
    expect(api.agentRequest).toHaveBeenCalledTimes(1);
    pending.reject(new Error("Failed"));
    await sending;
    await harness.settle();
    expect(control("textarea").value).toBe("Ne izgubi");
  });

  it("edits and saves the agent switch, repository path, and optional command", async () => {
    spies.push(spyOn(api, "saveProject").mockResolvedValue(project));
    const saved = mock(() => {});
    harness = hookHarness(() => ProjectForm({ edit: project, onClose: () => {}, onSaved: saved }));
    expect(control("button", (props) => props.role === "switch")["aria-checked"]).toBe(true);
    change("input", " /home/kamu/new-repo ", (props) => props["aria-describedby"] === "agent-dir-help");
    change("input", " ", (props) => props.placeholder === 'claude -p "$ANCHOA_REQUEST"');
    (control("form").onSubmit as (event: FormEvent) => void)(event);
    await harness.settle();
    expect(api.saveProject).toHaveBeenCalledWith(expect.objectContaining({ agent: true, agentDir: "/home/kamu/new-repo", agentCommand: null }));
    expect(saved).toHaveBeenCalledWith(project.id);
    (control("button", (props) => props.role === "switch").onClick as () => void)();
    (control("form").onSubmit as (event: FormEvent) => void)(event);
    await harness.settle();
    expect(api.saveProject).toHaveBeenLastCalledWith(expect.objectContaining({ agent: false }));
  });

  it("keeps the newest log when an older polling request finishes later", async () => {
    const old = deferred<string>();
    let poll = () => {};
    spies.push(
      spyOn(api, "agentLog").mockResolvedValue("Initial log"),
      spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, delay: number) => {
        expect(delay).toBe(3000);
        poll = callback;
        return 1;
      }) as unknown as typeof setInterval),
      spyOn(globalThis, "clearInterval").mockImplementation(() => {}),
    );
    harness = hookHarness(() => AgentLog({ taskId: task.id }));
    harness.render();
    await harness.settle();
    spyOn(api, "agentLog").mockReturnValueOnce(old.promise).mockResolvedValue("Newest log");
    poll();
    poll();
    await harness.settle();
    old.resolve("Old log");
    await harness.settle();
    expect(control("pre").children).toBe("Newest log");
  });

  it("clears the log on task changes and ignores late results from the old task", async () => {
    const old = deferred<string>();
    let taskId = task.id;
    spies.push(
      spyOn(api, "agentLog").mockReturnValueOnce(old.promise).mockResolvedValue("Second task's log"),
      spyOn(globalThis, "setInterval").mockImplementation((() => 1) as unknown as typeof setInterval),
      spyOn(globalThis, "clearInterval").mockImplementation(() => {}),
    );
    harness = hookHarness(() => AgentLog({ taskId }));
    harness.render();
    taskId = "second";
    harness.render();
    await harness.settle();
    old.resolve("First task's log");
    await harness.settle();
    expect(control("pre").children).toBe("Second task's log");
    expect(api.agentLog).toHaveBeenLastCalledWith("second");
  });
});
