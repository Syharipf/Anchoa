import type { Dashboard as DashboardData, DayTask } from "../api";
import { greeting } from "../format";
import { H1 } from "../shell/ui";
import { Kpis } from "./Kpis";
import { RecentPanel } from "./RecentPanel";
import { TodayPanel } from "./TodayPanel";

export function Dashboard({
  data,
  onToggle,
  onOpen,
}: Readonly<{ data: DashboardData | null; onToggle: (task: DayTask) => void; onOpen: (id: string) => void }>) {
  const now = new Date();
  const month = now.toLocaleDateString("id-ID", { month: "short" });

  return (
    <>
      <h1 className={H1}>{greeting(now.getHours())}</h1>
      <Kpis tasks={data?.today} inboxCount={data?.inboxCount ?? 0} month={month} />
      <div className="grid flex-1 grid-cols-2 items-start gap-3.5">
        <TodayPanel tasks={data?.today} onToggle={onToggle} onOpen={onOpen} />
        <RecentPanel items={data?.recent} onOpen={onOpen} />
      </div>
    </>
  );
}
