import type { Consistency, HabitRow, TopStreak } from "../api";
import { FlameIcon } from "./icons";

const CARD = "flex flex-col gap-2 rounded-[14px] border border-line bg-surface p-3.5";

export function SummaryCards({
  todayDone,
  todayTotal,
  topStreak,
  consistency,
  habits,
}: Readonly<{
  todayDone: number;
  todayTotal: number;
  topStreak: TopStreak | null;
  consistency: Consistency;
  habits: readonly HabitRow[];
}>) {
  const scheduledHabits = habits.filter((h) => h.scheduledToday);
  const topStreakDays = topStreak?.days ?? 0;
  const topStreakName = topStreak?.name ?? "Belum ada streak";

  return (
    <div className="grid grid-cols-3 gap-3">
      <section aria-label="Progres hari ini" className={CARD}>
        <span className="text-xs text-muted">Hari ini</span>
        <span className="flex items-baseline gap-1.5">
          <span className="font-mono text-[26px] leading-tight text-ink">{todayDone}</span>
          <span className="font-mono text-sm text-muted">/ {todayTotal} selesai</span>
        </span>
        <div aria-hidden="true" className="flex gap-1">
          {scheduledHabits.length === 0 ? (
            <span className="h-1.5 flex-1 rounded bg-line" />
          ) : (
            scheduledHabits.map((h) => (
              <span
                key={h.id}
                className={`h-1.5 flex-1 rounded ${h.doneToday ? "bg-accent" : "bg-line"}`}
              />
            ))
          )}
        </div>
      </section>

      <section aria-label="Streak aktif terpanjang" className={CARD}>
        <span className="text-xs text-muted">Streak aktif terpanjang</span>
        <span className="flex items-baseline gap-1.5 text-accent">
          <FlameIcon />
          <span className="font-mono text-[26px] leading-tight text-ink">{topStreakDays}</span>
          <span className="text-sm text-muted">hari</span>
        </span>
        <span className="truncate text-xs text-muted">{topStreakName}</span>
      </section>

      <section aria-label="Konsistensi 30 hari: rasio hari terjadwal yang dicentang" className={CARD}>
        <span className="text-xs text-muted">Konsistensi 30 hari</span>
        <span className="flex items-baseline gap-1.5">
          <span className="font-mono text-[26px] leading-tight text-ink">{consistency.percent}</span>
          <span className="font-mono text-sm text-muted">%</span>
        </span>
        <span className="text-xs text-muted">
          {consistency.done} dari {consistency.scheduled} hari terjadwal selesai
        </span>
        <span className="text-[11px] leading-snug text-muted">
          Dihitung per hari, bukan per checklist: satu hari terjadwal dihitung selesai bila dicentang
          sekali. Hari di luar jadwal mingguan tidak masuk hitungan, dan hari ini baru masuk setelah
          dicentang.
        </span>
      </section>
    </div>
  );
}
