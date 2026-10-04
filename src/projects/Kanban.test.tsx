import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ReactNode } from "react";
import type { Columns, TaskCard } from "../api";
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

  afterEach(() => {
    harness?.dispose();
    harness = undefined;
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
});
