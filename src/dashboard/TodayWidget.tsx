import type { Dashboard } from "../api";
import { fullDate, greeting, shortDate } from "../format";
import { Card } from "../shell/Card";
import { ItemRow } from "../shell/ItemRow";

export function TodayWidget({ today, onOpen }: Readonly<{ today?: Dashboard["today"]; onOpen: (id: string) => void }>) {
  const now = new Date();
  const empty = today?.overdue.length === 0 && today.dueToday.length === 0;

  return (
    <Card title="Hari ini">
      <p className="font-mono text-xs text-muted">
        {fullDate(now.getTime())} · {greeting(now.getHours())}
      </p>
      {today && today.overdue.length > 0 && (
        <>
          <h3 className="mt-3 text-xs font-semibold uppercase tracking-[0.08em] text-danger">Terlambat</h3>
          {today.overdue.map((i) => (
            <ItemRow key={i.id} item={i} detail={shortDate(i.dueAt ?? 0)} onOpen={onOpen} />
          ))}
        </>
      )}
      {today && today.dueToday.length > 0 && (
        <>
          <h3 className="mt-3 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Jatuh tempo hari ini</h3>
          {today.dueToday.map((i) => (
            <ItemRow key={i.id} item={i} detail="hari ini" onOpen={onOpen} />
          ))}
        </>
      )}
      {empty && <p className="mt-3 text-sm text-muted">Tidak ada jatuh tempo hari ini</p>}
    </Card>
  );
}
