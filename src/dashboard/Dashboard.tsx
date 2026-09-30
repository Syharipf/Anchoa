import type { Dashboard as DashboardData, DayTask } from "../api";
import { greeting } from "../format";
import { pageInfo, type PageId } from "../shell/nav";
import { H1, SECONDARY } from "../shell/ui";
import { FinanceCard } from "./FinanceCard";
import { ModuleCard } from "./ModuleCard";
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
}: Readonly<{
  data: DashboardData | null;
  onToggle: (task: DayTask) => void;
  onOpen: (id: string) => void;
  onSelect: (page: PageId) => void;
}>) {
  const now = new Date();
  const moduleCard = (id: PageId) => <ModuleCard page={pageInfo(id)} onSelect={onSelect} />;

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className={H1}>{greeting(now.getHours())}</h1>
          <p className="m-0 truncate text-sm text-muted">
            {data
              ? summaryLine(data.today, data.inboxCount, data.finance.dueBills.filter((b) => b.status === "overdue").length)
              : " "}
          </p>
        </div>
        <button disabled title="Hadir di Fase 5" className={`${SECONDARY} shrink-0 disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent`}>
          Dengarkan rekap
        </button>
      </div>
      <div className="grid grid-cols-3 items-start gap-3.5">
        <TodayPanel tasks={data?.today} onToggle={onToggle} onOpen={onOpen} />
        <FinanceCard finance={data?.finance} onSelect={onSelect} />
        <UpcomingCard days={data?.upcoming} onOpen={onOpen} />
        {moduleCard("email")}
        <ProjectsCard projects={data?.projects} onSelect={onSelect} />
        {moduleCard("unduhan")}
        <RecentPanel items={data?.recent} onOpen={onOpen} />
      </div>
    </>
  );
}
