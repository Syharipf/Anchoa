import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type Dashboard as DashboardData, type DayTask } from "../api";
import { greeting } from "../format";
import { useToast } from "../shell/toast";
import { H1 } from "../shell/ui";
import { Clock } from "./Clock";
import { CommandBar } from "./CommandBar";
import { Kpis } from "./Kpis";
import { RecentPanel } from "./RecentPanel";
import { TodayPanel } from "./TodayPanel";

export function Dashboard({
  onOpen,
  onInboxCount,
  focusCapture,
}: Readonly<{ onOpen: (id: string) => void; onInboxCount: (count: number) => void; focusCapture: number }>) {
  const toast = useToast();
  const [data, setData] = useState<DashboardData | null>(null);

  const load = useCallback(() => {
    api.getDashboard().then(
      (d) => {
        setData(d);
        onInboxCount(d.inboxCount);
      },
      (e) => toast(errorMessage(e), "error"),
    );
  }, [toast, onInboxCount]);

  useEffect(load, [load]);

  // Tick immediately, then let the server's answer settle the KPIs.
  function toggle(task: DayTask) {
    const done = task.completedAt === null;
    setData((d) =>
      d && { ...d, today: d.today.map((t) => (t.id === task.id ? { ...t, completedAt: done ? Date.now() : null } : t)) },
    );
    api.completeItem(task.id, done).then(load, (e) => {
      toast(errorMessage(e), "error");
      load();
    });
  }

  const now = new Date();
  const month = now.toLocaleDateString("id-ID", { month: "short" });

  return (
    <>
      <div className="flex items-center gap-4">
        <CommandBar onSaved={load} focusSignal={focusCapture} />
        <Clock />
      </div>
      <h1 className={H1}>{greeting(now.getHours())}</h1>
      <Kpis tasks={data?.today} inboxCount={data?.inboxCount ?? 0} month={month} />
      <div className="grid flex-1 grid-cols-2 items-start gap-3.5">
        <TodayPanel tasks={data?.today} onToggle={toggle} onOpen={onOpen} />
        <RecentPanel items={data?.recent} onOpen={onOpen} />
      </div>
    </>
  );
}
