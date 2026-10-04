import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type Entry, type EntrySummary, type Side } from "../api";
import * as toastModule from "../shell/toast";
import { deferred, elements, hookHarness } from "../test/hookHarness";
import { JournalSide } from "./JournalSide";

type SideHarness = {
  render(runEffects?: boolean): ReactNode;
  settle(): Promise<ReactNode>;
  dispose(): void;
};
function makeSummary(id = "entry-1", title = "Entri Kenangan"): EntrySummary {
  return {
    id,
    kind: "note",
    title,
    preview: `Preview untuk ${title}`,
    mood: 4,
    createdAt: 1728000000000,
    time: "4 Sep",
  };
}

function makeSide(memories: EntrySummary[] = []): Side {
  return {
    trend: [
      { date: "2026-09-04", wrote: true, mood: 4 },
      { date: "2026-10-04", wrote: true, mood: 5 },
    ],
    writeDays: 2,
    ideas: [
      {
        id: "idea-1",
        kind: "idea",
        title: "Ide Baru",
        preview: "Detail ide",
        mood: 3,
        createdAt: 1728000000000,
        time: "10.00",
      },
    ],
    memories,
  };
}

function makeCreatedEntry(id = "recap-1"): Entry {
  return {
    id,
    kind: "note",
    title: "Ringkasan minggu 27 Sep–3 Okt",
    body: "Ringkasan suasana minggu ini baik.",
    mood: 4,
    tags: ["ringkasan"],
    createdAt: Date.now(),
    when: "Hari ini",
    taskId: null,
    pinned: false,
  };
}

function button(node: ReactNode, label: string) {
  const control = elements(node).find(
    (element) =>
      element.type === "button" &&
      (element.props["aria-label"] === label ||
        renderToStaticMarkup(element).includes(`>${label}<`) ||
        (Array.isArray(element.props.children)
          ? element.props.children.includes(label)
          : element.props.children === label)),
  );
  expect(control).toBeDefined();
  return control!;
}

function click(node: ReactNode, label: string) {
  const control = button(node, label);
  const onClick = control.props.onClick;
  if (typeof onClick === "function") {
    onClick();
  }
}

interface IdeaButtonProps {
  idea: EntrySummary;
  onClick: (id: string) => void;
  [key: string]: unknown;
}

function isIdeaButton(
  element: React.ReactElement<Record<string, unknown>>,
): element is React.ReactElement<IdeaButtonProps> {
  const props = element.props;
  return (
    typeof element.type === "function" &&
    "idea" in props &&
    props.idea !== null &&
    typeof props.idea === "object" &&
    "id" in props.idea &&
    "onClick" in props &&
    typeof props.onClick === "function"
  );
}

describe("JournalSide memories and weekly summary", () => {
  let harness: SideHarness | undefined;
  let spies: { mockRestore: () => void }[];
  let toastCalls: { text: string; kind?: string; action?: toastModule.ToastAction }[];

  beforeEach(() => {
    toastCalls = [];
    spies = [
      spyOn(api, "journalCalendar").mockResolvedValue({
        month: "2026-10",
        days: [],
        currentStreak: 2,
        bestStreak: 5,
      }),
      spyOn(toastModule, "useToast").mockReturnValue((text, kind, action) => {
        toastCalls.push({ text, kind, action });
      }),
    ];
  });

  afterEach(() => {
    harness?.dispose();
    spies.forEach((spy) => spy.mockRestore());
  });

  it("renders memories card when memories exist and triggers onSelectEntry", async () => {
    const onSelectEntry = mock(() => {});
    const memories = [makeSummary("mem-1", "Setahun lalu")];
    const side = makeSide(memories);

    harness = hookHarness(() =>
      JournalSide({
        side,
        onSelectEntry,
        onIdeaSelect: () => {},
        onPromptSelect: () => {},
      }),
    );
    await harness.settle();

    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("Hari ini di masa lalu");
    expect(html).toContain("Setahun lalu");
    expect(html).toContain("Preview untuk Setahun lalu");
    expect(html).toContain("4 Sep");

    click(harness.render(), "Setahun lalu");
    expect(onSelectEntry).toHaveBeenCalledWith("mem-1");
  });

  it("does not render memories card when memories array is empty or null", async () => {
    const side = makeSide([]);
    harness = hookHarness(() =>
      JournalSide({
        side,
        onIdeaSelect: () => {},
        onPromptSelect: () => {},
      }),
    );
    await harness.settle();

    const html = renderToStaticMarkup(harness.render());
    expect(html).not.toContain("Hari ini di masa lalu");
    expect(html).not.toContain("j-memories-heading");
  });

  it("calls api.journalWeeklySummary and onSummaryCreated when Ringkas minggu ini is clicked", async () => {
    const created = makeCreatedEntry();
    spies.push(spyOn(api, "journalWeeklySummary").mockResolvedValue(created));
    const onSummaryCreated = mock(() => {});

    harness = hookHarness(() =>
      JournalSide({
        side: makeSide(),
        onSummaryCreated,
        onIdeaSelect: () => {},
        onPromptSelect: () => {},
      }),
    );
    await harness.settle();

    click(harness.render(), "Ringkas minggu ini");
    await harness.settle();

    expect(api.journalWeeklySummary).toHaveBeenCalledTimes(1);
    expect(onSummaryCreated).toHaveBeenCalledWith(created);
    expect(toastCalls.some((t) => t.text === "Ringkasan mingguan dibuat" && t.kind === "info")).toBe(true);
  });

  it("disables button and displays loading state while summarizing", async () => {
    const pending = deferred<Entry>();
    spies.push(spyOn(api, "journalWeeklySummary").mockReturnValue(pending.promise));

    harness = hookHarness(() =>
      JournalSide({
        side: makeSide(),
        onIdeaSelect: () => {},
        onPromptSelect: () => {},
      }),
    );
    await harness.settle();

    click(harness.render(), "Ringkas minggu ini");
    const loadingBtn = button(harness.render(), "Meringkas…");
    expect(loadingBtn.props.disabled).toBe(true);

    pending.resolve(makeCreatedEntry());
    await harness.settle();

    const normalBtn = button(harness.render(), "Ringkas minggu ini");
    expect(normalBtn.props.disabled).toBe(false);
  });

  it("shows toast error and does not call onSummaryCreated when weekly summary fails", async () => {
    spies.push(spyOn(api, "journalWeeklySummary").mockRejectedValue(new Error("Ollama tidak jalan")));
    const onSummaryCreated = mock(() => {});

    harness = hookHarness(() =>
      JournalSide({
        side: makeSide(),
        onSummaryCreated,
        onIdeaSelect: () => {},
        onPromptSelect: () => {},
      }),
    );
    await harness.settle();

    click(harness.render(), "Ringkas minggu ini");
    await harness.settle();

    expect(onSummaryCreated).not.toHaveBeenCalled();
    expect(toastCalls.some((t) => t.text === "Ollama tidak jalan" && t.kind === "error")).toBe(true);
  });

  it("renders updated privacy footnote text", async () => {
    harness = hookHarness(() =>
      JournalSide({
        side: makeSide(),
        onIdeaSelect: () => {},
        onPromptSelect: () => {},
      }),
    );
    await harness.settle();

    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain(
      "Asisten hanya membaca entri 7 hari terakhir saat kamu meminta ringkasan, atau entri yang kamu minta tanggapannya.",
    );
  });

  it("invokes prompt selection and idea selection handlers", async () => {
    const onPromptSelect = mock(() => {});
    const onIdeaSelect = mock(() => {});

    harness = hookHarness(() =>
      JournalSide({
        side: makeSide(),
        onPromptSelect,
        onIdeaSelect,
      }),
    );
    await harness.settle();

    click(harness.render(), "Tulis dari sini");
    expect(onPromptSelect).toHaveBeenCalledTimes(1);

    const ideaEl = elements(harness.render()).find(isIdeaButton);
    expect(ideaEl).toBeDefined();
    ideaEl?.props.onClick("idea-1");
    expect(onIdeaSelect).toHaveBeenCalledWith("idea-1");
  });
});
