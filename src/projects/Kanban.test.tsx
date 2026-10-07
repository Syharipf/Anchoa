import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api, type Activity, type Columns, type TaskCard } from "../api";
import { elements, hookHarness } from "../test/hookHarness";
import { Kanban } from "./Kanban";


const CARD: TaskCard = {
  id: "t1",
  title: "Rilis fitur baru",
  status: "plan",
  tag: "fitur",
  dueAt: null,
  overdue: false,
  subDone: 0,
  subTotal: 0,
  projectId: "p1",
  projectName: "Proyek",
  priority: 1,
};

const EMPTY_COLUMNS: Columns = { plan: [], doing: [], test: [], review: [], done: [] };
const COLUMNS: Columns = { plan: [CARD], doing: [], test: [], review: [], done: [] };

describe("Kanban", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>> | undefined;

  const spies: { mockRestore: () => void }[] = [];

  afterEach(() => {
    harness?.dispose();
    harness = undefined;
    spies.forEach((spy) => spy.mockRestore());
    spies.length = 0;
  });

  it("renders priority chip and responds to drag and drop", () => {
    const onDrop = mock(() => {});
    harness = hookHarness(() =>
      Kanban({
        columns: COLUMNS,
        onOpenItem: () => {},
        onMoveCard: () => {},
        onDropCard: onDrop,
        onCreateTask: async () => {},
      }),
    );

    const rendered = harness.render();
    const articles = elements(rendered).filter((e) => e.type === "article");
    expect(articles.length).toBe(1);

    const spans = elements(articles[0]).filter((e) => e.type === "span");
    expect(spans.some((s) => s.props.children === "Tinggi")).toBe(true);

    const sections = elements(rendered).filter((e) => e.type === "section");
    const doingSection = sections.find((s) => s.props["aria-label"] === "Dikerjakan");
    expect(doingSection).toBeDefined();

    const dataTransfer = {
      data: { "text/plain": "t1" } as Record<string, string>,
      setData(k: string, v: string) {
        this.data[k] = v;
      },
      getData(k: string) {
        return this.data[k];
      },
    };

    (doingSection?.props.onDragOver as (e: unknown) => void)({ preventDefault: () => {} });
    (doingSection?.props.onDrop as (e: unknown) => void)({
      preventDefault: () => {},
      dataTransfer,
    });

    expect(onDrop).toHaveBeenCalledWith(CARD, "doing");
  });

  it("shows filtered empty message and provides context menu", () => {
    const cardMenu = mock(() => [{ label: "Hapus tugas", onSelect: () => {}, danger: true }]);
    harness = hookHarness(() =>
      Kanban({
        columns: EMPTY_COLUMNS,
        filtered: true,
        onOpenItem: () => {},
        onMoveCard: () => {},
        cardMenu,
        onCreateTask: async () => {},
      }),
    );

    const divs = elements(harness.render()).filter((e) => e.type === "div");
    expect(divs.some((d) => d.props.children === "Tidak ada yang cocok")).toBe(true);
  });
  it("shows the latest merged commit for a linked repo and a placeholder while loading", async () => {
    const merged: Activity = {
      id: "a1",
      taskId: null,
      projectId: "p1",
      actor: "Claude",
      role: "merge",
      kind: "link",
      title: "https://github.com/Syharipf/Anchoa/pull/168",
      body: "https://github.com/Syharipf/Anchoa/pull/168",
      createdAt: Date.now() - 3_600_000,
    };
    spies.push(spyOn(api, "projectActivities").mockResolvedValue([merged]));
    harness = hookHarness(() =>
      Kanban({
        columns: COLUMNS,
        repoUrl: "https://github.com/Syharipf/Anchoa",
        onOpenItem: () => {},
        onMoveCard: () => {},
        onCreateTask: async () => {},
      }),
    );

    // The card keeps its commit prop while the activity fetch is still in flight.
    const commit = () => elements(harness!.render()).find((el) => "commit" in el.props)?.props.commit;
    expect(commit()).toBe("loading");

    await harness.settle();
    expect(api.projectActivities).toHaveBeenCalledWith("p1");
    expect(commit()).toEqual({ label: "#168", createdAt: merged.createdAt });
  });

  it("leaves cards untouched when no repo is linked", async () => {
    spies.push(spyOn(api, "projectActivities").mockResolvedValue([]));
    harness = hookHarness(() =>
      Kanban({
        columns: COLUMNS,
        onOpenItem: () => {},
        onMoveCard: () => {},
        onCreateTask: async () => {},
      }),
    );
    await harness.settle();
    expect(api.projectActivities).not.toHaveBeenCalled();
    expect(elements(harness.render()).find((el) => "commit" in el.props)?.props.commit).toBeNull();
  });

  it("drops the commit line silently when the fetch fails", async () => {
    spies.push(spyOn(api, "projectActivities").mockRejectedValue(new Error("Gagal membaca database")));
    harness = hookHarness(() =>
      Kanban({
        columns: COLUMNS,
        repoUrl: "https://github.com/Syharipf/Anchoa",
        onOpenItem: () => {},
        onMoveCard: () => {},
        onCreateTask: async () => {},
      }),
    );
    await harness.settle();
    });

  it("ignores status rows that carry no commit ref", async () => {
    spies.push(
      spyOn(api, "projectActivities").mockResolvedValue([
        { id: "a1", taskId: null, projectId: "p1", actor: "Kamu", role: "merge", kind: "status",
          title: "Kamu memindahkan ke Selesai", body: "", createdAt: Date.now() - 600_000 },
      ]),
    );
    harness = hookHarness(() =>
      Kanban({
        columns: COLUMNS,
        repoUrl: "https://github.com/Syharipf/Anchoa",
        onOpenItem: () => {},
        onMoveCard: () => {},
        onCreateTask: async () => {},
      }),
    );
    await harness.settle();
    expect(elements(harness.render()).find((el) => "commit" in el.props)?.props.commit).toBeNull();
  });
});
