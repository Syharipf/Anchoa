import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Dashboard as DashboardData, Entry, FinanceOverview, HabitsOverview, ProjectsOverview } from "../api";
import { Dashboard } from "../dashboard/Dashboard";
import { PreviewPanel } from "../files/PreviewPanel";
import { FinancePage } from "../finance/FinancePage";
import { HabitsPage } from "../habits/HabitsPage";
import { EntryEditor } from "../journal/EntryEditor";
import { JournalPage } from "../journal/JournalPage";
import { ProjectsPage } from "../projects/ProjectsPage";
import { ScheduleHeader } from "../schedule/ScheduleHeader";
import { SchedulePage } from "../schedule/SchedulePage";
import { elements, hookHarness } from "../test/hookHarness";
import type { OpenAssistant } from "./useAssistantRequest";

const finance: FinanceOverview = {
  month: "2026-10", currentMonth: "2026-10", balance: 0, accountCount: 0,
  income: 0, expense: 0, net: 0, budget: null, chart: [],
};
const habits: HabitsOverview = {
  today: "2026-10-02", todayDone: 0, todayTotal: 0, topStreak: null,
  consistency: { percent: 0, done: 0, scheduled: 0 }, habits: [],
};
const projects: ProjectsOverview = { projects: [], activeCount: 0, loose: { done: 0, total: 0 }, upcoming: [] };
const entry: Entry = {
  id: "entry", kind: "note", title: "Judul tersimpan", body: "Isi tersimpan", mood: null,
  tags: [], createdAt: 1, when: "Hari ini", taskId: null, pinned: false,
};

describe("module assistant actions", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  afterEach(() => harness?.dispose());

  function button(label: string) {
    const control = elements(harness.render(false)).find((element) =>
      element.type === "button" && renderToStaticMarkup(element).includes(label));
    expect(control).toBeDefined();
    return control!;
  }

  it.each([
    { name: "finance", label: "Catat lewat suara", states: { 1: finance, 2: [], 3: [] },
      render: (onOpenAssistant: OpenAssistant) => FinancePage({ newTransaction: false, onChanged: () => {}, onOpenAssistant }) },
    { name: "projects", label: "Tambah tugas lewat suara", states: { 0: projects },
      render: (onOpenAssistant: OpenAssistant) => ProjectsPage({ onOpenItem: () => {}, onChanged: () => {}, onOpenAssistant }) },
    { name: "habits", label: "Catat lewat suara", states: { 0: habits },
      render: (onOpenAssistant: OpenAssistant) => HabitsPage({ onOpenAssistant }) },
    { name: "journal", label: "Catat lewat suara", states: {},
      render: (onOpenAssistant: OpenAssistant) => JournalPage({ onOpenItem: () => {}, onOpenAssistant }) },
  ])("opens the existing voice assistant from $name", ({ label, states, render }) => {
    const onOpenAssistant = mock<OpenAssistant>(() => {});
    harness = hookHarness(() => render(onOpenAssistant), states);
    const control = button(label);
    expect(control.props.disabled).not.toBe(true);
    (control.props.onClick as () => void)();
    expect(onOpenAssistant).toHaveBeenCalledWith({ kind: "voice" });
  });

  it("passes schedule voice actions through the header", () => {
    const onOpenAssistant = mock<OpenAssistant>(() => {});
    harness = hookHarness(() => SchedulePage({ onOpenItem: () => {}, onOpenFinance: () => {}, onChanged: () => {}, onOpenAssistant }));
    const header = elements(harness.render(false)).find((element) => element.type === ScheduleHeader)!;
    const control = elements(ScheduleHeader(header.props as Parameters<typeof ScheduleHeader>[0]))
      .find((element) => element.type === "button" && element.props.children instanceof Array &&
        renderToStaticMarkup(element).includes("Tambah tugas lewat suara"))!;
    expect(control.props.disabled).not.toBe(true);
    (control.props.onClick as () => void)();
    expect(onOpenAssistant).toHaveBeenCalledWith({ kind: "voice" });
  });

  it("reads and requests feedback using the current journal draft", () => {
    const onOpenAssistant = mock<OpenAssistant>(() => {});
    harness = hookHarness(() => EntryEditor({ entry, onEntryChanged: () => {}, onOpenTask: () => {}, onOpenAssistant,
      onDelete: async () => {}, onTagClick: () => {} }));
    const input = (label: string) => elements(harness.render(false)).find((element) => element.props["aria-label"] === label)!;
    (input("Judul entri").props.onChange as (event: unknown) => void)({ target: { value: "Judul baru" } });
    (input("Isi entri").props.onChange as (event: unknown) => void)({ target: { value: "Isi belum tersimpan" } });
    (button("Bacakan").props.onClick as () => void)();
    expect(onOpenAssistant).toHaveBeenLastCalledWith({ kind: "speak", text: "Judul baru. Isi belum tersimpan" });
    (button("Minta tanggapan").props.onClick as () => void)();
    expect(onOpenAssistant).toHaveBeenLastCalledWith({
      kind: "compose", text: "Berikan tanggapan yang suportif untuk entri jurnal ini:\n\nJudul baru\nIsi belum tersimpan",
    });
  });

  it("keeps read-aloud disabled for an empty journal draft", () => {
    harness = hookHarness(() => EntryEditor({ entry: { ...entry, title: "", body: " " }, onEntryChanged: () => {},
      onOpenTask: () => {}, onOpenAssistant: () => {}, onDelete: async () => {}, onTagClick: () => {} }));
    expect(button("Bacakan").props.disabled).toBe(true);
  });

  it("opens file questions with the selected file's metadata", () => {
    const onOpenAssistant = mock<OpenAssistant>(() => {});
    harness = hookHarness(() => PreviewPanel({
      entry: { name: "pantai.jpg", path: "/foto/pantai.jpg", kind: "image", size: 1024, modified: 0, hidden: false },
      onOpen: () => {}, onClose: () => {}, onOpenAssistant,
    }));
    const control = button("Tanya asisten");
    expect(control.props.disabled).not.toBe(true);
    (control.props.onClick as () => void)();
    expect(onOpenAssistant).toHaveBeenCalledWith({ kind: "compose", text: expect.stringContaining("Lokasi: /foto/pantai.jpg") });
    expect(onOpenAssistant.mock.calls[0][0]).toEqual({ kind: "compose", text: expect.stringContaining("berdasarkan metadata") });
  });

  it("opens the real email page and reads the loaded recap without completed task names", () => {
    const onOpenAssistant = mock<OpenAssistant>(() => {});
    const onSelect = mock(() => {});
    let data: DashboardData | null = null;
    harness = hookHarness(() => Dashboard({ data, onOpen: () => {}, onToggle: () => {}, onSelect, onOpenAssistant }));
    expect(button("Dengarkan rekap").props.disabled).toBe(true);
    data = {
      today: [
        { id: "open", title: "Beli teri", dueAt: 1, completedAt: null, overdue: false },
        { id: "done", title: "Sudah selesai", dueAt: 1, completedAt: 1, overdue: false },
      ],
      upcoming: [], recent: [], inboxCount: 0, projects: [], habitReminders: [],
      finance: { hasAccounts: false, balance: 0, expense: 0, budget: null, dueBills: [] },
      downloads: { items: [], speed: 0 },
    };
    expect(button("Dengarkan rekap").props.disabled).toBe(false);
    (button("Dengarkan rekap").props.onClick as () => void)();
    expect(onOpenAssistant).toHaveBeenCalledWith({ kind: "speak", text: "1 tugas hari ini · Jurnal kosong. Beli teri" });
    (button("Buka kotak masuk").props.onClick as () => void)();
    expect(onSelect).toHaveBeenCalledWith("email");
  });
});
