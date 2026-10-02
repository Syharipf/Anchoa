import type { Dashboard as DashboardData, DayTask } from "../api";
import type { OpenAssistant } from "../assistant/useAssistantRequest";
import { greeting } from "../format";
import type { PageId } from "../shell/nav";
import { H1, H2, PANEL, SECONDARY } from "../shell/ui";
import { FinanceCard } from "./FinanceCard";
import { DownloadsCard } from "./DownloadsCard";
import { ProjectsCard } from "./ProjectsCard";
import { RecentPanel } from "./RecentPanel";
import { summaryLine } from "./summary";
import { TodayPanel } from "./TodayPanel";
import { UpcomingCard } from "./UpcomingCard";

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
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className={H1}>{greeting(now.getHours())}</h1>
          <p className="m-0 truncate text-sm text-muted">
            {recap || " "}
          </p>
        </div>
        <button type="button" disabled={!data}
          onClick={() => onOpenAssistant({ kind: "speak", text: `${recap}. ${data?.today.filter((task) => task.completedAt === null).map((task) => task.title || "Tanpa judul").join(". ") ?? ""}` })}
          className={`${SECONDARY} shrink-0 disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent`}>
          Dengarkan rekap
        </button>
      </div>
      <div className="grid grid-cols-3 items-start gap-3.5">
        <TodayPanel tasks={data?.today} onToggle={onToggle} onOpen={onOpen} />
        <FinanceCard finance={data?.finance} onSelect={onSelect} />
        <UpcomingCard days={data?.upcoming} onOpen={onOpen} />
        <button type="button" onClick={() => onSelect("email")}
          className={`${PANEL} flex flex-col items-start gap-1.5 text-left transition-colors hover:bg-surface-2`}>
          <span className={`${H2} block`}>Email</span>
          <span className="text-xs leading-relaxed text-muted">Buka kotak masuk</span>
        </button>
        <ProjectsCard projects={data?.projects} onSelect={onSelect} />
        <DownloadsCard downloads={data?.downloads} onSelect={onSelect} />
        <RecentPanel items={data?.recent} onOpen={onOpen} />
      </div>
    </>
  );
}
