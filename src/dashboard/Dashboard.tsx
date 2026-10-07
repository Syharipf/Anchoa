import type { Dashboard as DashboardData, DayTask } from "../api";
import type { OpenAssistant } from "../assistant/useAssistantRequest";
import { greeting } from "../format";
import type { PageId } from "../shell/nav";
import { HEADER_SECONDARY } from "../shell/ui";
import { FinanceCard } from "./FinanceCard";
import { DownloadsCard } from "./DownloadsCard";
import { ProjectsCard } from "./ProjectsCard";
import { RecentPanel } from "./RecentPanel";
import { summaryLine } from "./summary";
import { TodayPanel } from "./TodayPanel";
import { UpcomingCard } from "./UpcomingCard";
const QUICK_PILL =
  "flex min-h-[34px] items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[13px] text-ink transition-colors hover:bg-surface-2";

/** Bento recap from docs/design/artboards/Main.dc.html (spec UI lanjutan U9). */
export function Dashboard({
  data,
  onToggle,
  onOpen,
  onSelect,
  onOpenAssistant,
}: Readonly<{
  data: DashboardData | null;
  onToggle: (task: DayTask) => void;
  onOpen: (id: string) => void;
  onSelect: (page: PageId) => void;
  onOpenAssistant: OpenAssistant;
}>) {
  const now = new Date();
  const recap = data
    ? summaryLine(data.today, data.inboxCount, data.finance.dueBills.filter((bill) => bill.status === "overdue").length)
    : "";

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="m-0 font-display text-[26px] font-semibold tracking-[-0.01em]">{greeting(now.getHours())}</h1>
          <p className="m-0 truncate text-[13px] text-muted">
            {recap || " "}
          </p>
        </div>
        <button
          type="button"
          disabled={!data}
          onClick={() => onOpenAssistant({ kind: "speak", text: `${recap}. ${data?.today.filter((task) => task.completedAt === null).map((task) => task.title || "Tanpa judul").join(". ") ?? ""}` })}
          className={`${HEADER_SECONDARY} shrink-0 disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-surface`}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-accent"
            aria-hidden="true"
          >
            <path d="M4 9v6h4l5 4V5L8 9z" />
            <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
          </svg>
          Dengarkan rekap
        </button>
      </div>

      <div role="group" aria-label="Pintasan" className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => onSelect("jadwal")} className={QUICK_PILL}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="text-accent" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        Tugas
        </button>
        <button type="button" onClick={() => onSelect("keuangan")} className={QUICK_PILL}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="text-accent" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        Transaksi
        </button>
        <button type="button" onClick={() => onOpenAssistant({ kind: "voice" })} className={QUICK_PILL}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden="true">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0" />
            <path d="M12 18v3" />
          </svg>
          Catatan suara
        </button>
        <button type="button" onClick={() => onSelect("unduhan")} className={QUICK_PILL}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden="true">
            <path d="M12 4v11M7 10l5 5 5-5" />
            <path d="M5 20h14" />
          </svg>
          Unduh dari clipboard
        </button>
        <button type="button" onClick={() => onSelect("email")} className={QUICK_PILL}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden="true">
            <path d="M4 20h4L19 9l-4-4L4 16z" />
          </svg>
          Tulis email
        </button>
      </div>

      <div className="grid grid-cols-3 items-start gap-2">
        <TodayPanel tasks={data?.today} onToggle={onToggle} onOpen={onOpen} onSelect={onSelect} />
        <FinanceCard finance={data?.finance} onSelect={onSelect} />
        <UpcomingCard days={data?.upcoming} onOpen={onOpen} onSelect={onSelect} />
        <button
          type="button"
          onClick={() => onSelect("email")}
          className="flex flex-col items-start gap-2 overflow-hidden rounded-[14px] border border-line bg-surface p-3 px-3.5 text-left text-ink transition-colors hover:bg-surface-2"
        >
          <div className="flex w-full items-center gap-2">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-muted"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M3 7l9 6 9-6" />
            </svg>
            <span id="c-email" className="font-display text-sm font-semibold text-ink">Email</span>
            {data && data.inboxCount > 0 ? (
              <span className="rounded-full bg-accent px-1.5 font-mono text-[11px] font-medium text-canvas">
                {data.inboxCount} baru
              </span>
            ) : null}
            <span className="ml-auto text-xs text-accent">›</span>
          </div>
          <span className="text-xs leading-relaxed text-muted">Buka kotak masuk</span>
        </button>
        <ProjectsCard projects={data?.projects} onSelect={onSelect} />
        <DownloadsCard downloads={data?.downloads} onSelect={onSelect} />
        <RecentPanel items={data?.recent} onOpen={onOpen} onSelect={onSelect} />
      </div>
    </>
  );
}
