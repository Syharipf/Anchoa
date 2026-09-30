import { useCallback, useState } from "react";
import { api, errorMessage, type Dashboard, type DayTask } from "../api";
import { useToast } from "../shell/toast";

/** Dashboard data shared by the dashboard, the palette and (UI-7) the notification bell. */
export function useDashboard() {
  const toast = useToast();
  const [data, setData] = useState<Dashboard | null>(null);

  const reload = useCallback(() => {
    api.getDashboard().then(setData, (e) => toast(errorMessage(e), "error"));
  }, [toast]);

  // Tick immediately, then let the server's answer settle the counts.
  const toggle = useCallback(
    (task: DayTask) => {
      const done = task.completedAt === null;
      setData(
        (d) => d && { ...d, today: d.today.map((t) => (t.id === task.id ? { ...t, completedAt: done ? Date.now() : null } : t)) },
      );
      api.updateTask(task.id, { status: done ? "done" : "plan" }).then(reload, (e) => {
        toast(errorMessage(e), "error");
        reload();
      });
    },
    [reload, toast],
  );

  return { data, reload, toggle };
}
