import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DayTask, FinanceSummary } from "../api";
import { elements } from "../test/hookHarness";
import { Dashboard } from "./Dashboard";
import { FinanceCard } from "./FinanceCard";
import { TodayPanel } from "./TodayPanel";
import { UpcomingCard } from "./UpcomingCard";

const task = (over: Partial<DayTask> = {}): DayTask => ({
  id: "task", title: "Beli teri", dueAt: Date.parse("2026-09-29T00:00:00+07:00"), completedAt: null, overdue: false, ...over,
});
const finance: FinanceSummary = { hasAccounts: true, balance: -1, expense: 1, budget: null, dueBills: [] };

describe("dashboard branches", () => {
  it("distinguishes loading from an empty task day", () => {
    const callbacks = { onToggle: () => {}, onOpen: () => {} };
    expect(renderToStaticMarkup(<TodayPanel {...callbacks} />)).not.toContain("Tidak ada tugas hari ini");
    expect(renderToStaticMarkup(<TodayPanel tasks={[]} {...callbacks} />)).toContain("Tidak ada tugas hari ini");
  });

  it("renders open overdue, completed overdue and untitled tasks and preserves action IDs", () => {
    const tasks = [task({ id: "late", overdue: true }), task({ id: "done", overdue: true, completedAt: 1 }), task({ id: "blank", title: "" })];
    const onToggle = mock((_task: DayTask) => {});
    const onOpen = mock((_id: string) => {});
    const node = TodayPanel({ tasks, onToggle, onOpen });
    const html = renderToStaticMarkup(node);
    expect(html).toContain("1/3 selesai");
    expect(html.match(/· terlambat/g)).toHaveLength(1);
    expect(html).toContain("Tanpa judul");
    expect(html).toContain("line-through");
    const controls = elements(node);
    (controls.find((element) => element.type === "input")!.props.onChange as () => void)();
    (controls.find((element) => element.type === "button")!.props.onClick as () => void)();
    expect(onToggle).toHaveBeenCalledWith(tasks[0]);
    expect(onOpen).toHaveBeenCalledWith("late");
  });

  it("renders loading, no-account and debt states and opens finance", () => {
    const onSelect = mock((_page: string) => {});
    expect(renderToStaticMarkup(<FinanceCard onSelect={onSelect} />)).not.toContain("Belum ada akun");
    expect(renderToStaticMarkup(<FinanceCard finance={{ ...finance, hasAccounts: false }} onSelect={onSelect} />)).toContain("Belum ada akun");
    const node = FinanceCard({ finance, onSelect });
    const html = renderToStaticMarkup(node);
    expect(html).toContain("−Rp 1");
    expect(html).toMatch(/Keluar bulan ini Rp 1(?![\d.])/);
    expect(html).toContain("Tagihan aman");
    (elements(node)[0].props.onClick as () => void)();
    expect(onSelect).toHaveBeenCalledWith("keuangan");
  });

  it.each([["ok", "text-muted"], ["warn", "text-warn"], ["over", "text-danger"]] as const)("renders the %s budget warning without rescaling money", (level, style) => {
    const html = renderToStaticMarkup(<FinanceCard finance={{ ...finance, balance: 1, budget: { amount: 2, level } }} onSelect={() => {}} />);
    expect(html).toContain(`text-xs ${style}`);
    expect(html).toMatch(/dari Rp 2(?![\d.])/);
  });

  it("handles empty upcoming days and caps dots while keeping the first task's ID", () => {
    const onOpen = mock((_id: string) => {});
    const tasks = Array.from({ length: 5 }, (_, index) => task({ id: `t${index}`, title: index === 0 ? "" : "Tugas" }));
    const node = UpcomingCard({ days: [{ date: "2026-10-01", tasks: [] }, { date: "2026-10-02", tasks }], onOpen });
    const html = renderToStaticMarkup(node);
    expect(html).toContain("—");
    expect(html).toContain("Tanpa judul");
    expect(html).toContain("+4 lagi");
    expect(html.match(/w-1.5 rounded-full/g)).toHaveLength(4);
    (elements(node).find((element) => element.type === "button")!.props.onClick as () => void)();
    expect(onOpen).toHaveBeenCalledWith("t0");
  });
  it("collapses the upcoming card when no day has tasks", () => {
    const node = UpcomingCard({ days: [{ date: "2026-10-01", tasks: [] }], onOpen: () => {} });
    const html = renderToStaticMarkup(node);
    expect(html).toContain("Tidak ada jadwal 7 hari ke depan");
    expect(html).not.toContain("grid-cols-7");
  });

  it("renders exactly one plus glyph in each of the two create pills", () => {
    const onSelect = mock((_page: string) => {});
    const html = renderToStaticMarkup(
      <Dashboard
        data={null}
        onToggle={() => {}}
        onOpen={() => {}}
        onSelect={onSelect}
        onOpenAssistant={() => {}}
      />,
    );
    const withPlus = ["Tugas", "Transaksi"];
    for (const label of withPlus) {
      const marker = `</svg>${label}`;
      const open = html.lastIndexOf("<button", html.indexOf(marker));
      const close = html.indexOf("</button>", html.indexOf(marker));
      const pill = html.slice(open, close);
      expect(pill.match(/M12 5v14M5 12h14/g) ?? []).toHaveLength(1);
      expect(pill).toContain(label);
      expect(pill).not.toContain("+");
    }
    expect(html).toContain("Catatan suara");
    expect(html).toContain("Unduh dari clipboard");
    expect(html).toContain("Tulis email");
  });
});
