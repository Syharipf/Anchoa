import type { DayTask } from "../api";
import { LABEL, PANEL } from "../shell/ui";

function segmentColor(t: DayTask): string {
  if (t.completedAt !== null) return "bg-accent";
  return t.overdue ? "bg-danger" : "bg-line";
}

/** Saldo, pengeluaran (both wait for Fase 2) and today's task progress. */
export function Kpis({ tasks, inboxCount, month }: Readonly<{ tasks?: DayTask[]; inboxCount: number; month: string }>) {
  const list = tasks ?? [];
  const done = list.filter((t) => t.completedAt !== null).length;
  const late = list.filter((t) => t.overdue && t.completedAt === null).length;
  const open = list.length - done;

  return (
    <div className="grid grid-cols-3 gap-3.5">
      <section className={`${PANEL} flex flex-col gap-1.5`}>
        <span className={LABEL}>Saldo total</span>
        <span className="font-mono text-[26px] font-medium text-disabled">—</span>
        <span className="text-xs text-muted">Keuangan belum aktif</span>
      </section>
      <section className={`${PANEL} flex flex-col gap-1.5`}>
        <span className={LABEL}>Pengeluaran {month}</span>
        <span className="font-mono text-[26px] font-medium text-disabled">—</span>
        <span className="text-xs text-muted">Keuangan belum aktif</span>
      </section>
      <section className={`${PANEL} flex flex-col gap-1.5`}>
        <span className={LABEL}>Tugas hari ini</span>
        <span className="font-mono text-[26px] font-medium">
          {open} <span className="text-sm text-muted">tersisa</span>
          {late > 0 && <span className="text-sm text-danger"> · {late} terlambat</span>}
        </span>
        <div aria-hidden="true" className="flex gap-1 py-0.5">
          {list.map((t) => (
            <span key={t.id} className={`h-1 flex-1 rounded-sm transition-colors ${segmentColor(t)}`} />
          ))}
        </div>
        <span className="text-xs text-muted">
          {list.length === 0 ? "Tidak ada tugas hari ini" : `${done} dari ${list.length} selesai`} · Inbox {inboxCount} catatan
        </span>
      </section>
    </div>
  );
}
