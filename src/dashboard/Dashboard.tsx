import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type Dashboard as DashboardData } from "../api";
import { useToast } from "../shell/toast";
import { FinanceWidget } from "./FinanceWidget";
import { QuickCapture } from "./QuickCapture";
import { RecentWidget } from "./RecentWidget";
import { TodayWidget } from "./TodayWidget";

export function Dashboard({ onOpen, focusCapture }: Readonly<{ onOpen: (id: string) => void; focusCapture: number }>) {
  const toast = useToast();
  const [data, setData] = useState<DashboardData | null>(null);

  const load = useCallback(() => {
    api.getDashboard().then(setData, (e) => toast(errorMessage(e), "error"));
  }, [toast]);

  useEffect(load, [load]);

  return (
    <div className="flex flex-col gap-[18px]">
      <QuickCapture onSaved={load} focusSignal={focusCapture} />
      <div className="grid grid-cols-2 gap-3.5">
        <TodayWidget today={data?.today} onOpen={onOpen} />
        <FinanceWidget />
        <div className="col-span-2">
          <RecentWidget items={data?.recent} onOpen={onOpen} />
        </div>
      </div>
    </div>
  );
}
