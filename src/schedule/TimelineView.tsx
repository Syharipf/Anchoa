import { useMemo } from "react";
import type { ProjectDeadline, ScheduleItem } from "../api";
import {
  barFor,
  diffDays,
  KIND_COLORS,
  shortDateStr,
  timelineGroups,
  timelineLabel,
} from "./layout";

const STATUS_LABELS: Record<ScheduleItem["status"], string> = { plan: "Rencana", doing: "Dikerjakan", done: "Selesai" };

export function TimelineView({
  window,
  today,
  items,
  deadlines,
  onOpenItem,
  onOpenFinance,
}: Readonly<{
  window: { from: string; to: string; days: string[] };
  today: string;
  items: readonly ScheduleItem[];
  deadlines: readonly ProjectDeadline[];
  onOpenItem: (id: string) => void;
  onOpenFinance: () => void;
}>) {
  const groups = useMemo(
    () => timelineGroups(items, deadlines),
    [items, deadlines],
  );

  const weeks = useMemo(() => {
    const list: { x: number; label: string }[] = [];
    for (let k = 0; k < 8; k++) {
      list.push({
        x: k * 7 * 16,
        label: shortDateStr(window.days[k * 7]),
      });
    }
    return list;
  }, [window.days]);

  const weekends = useMemo(() => {
    const list: { x: number; w: number }[] = [];
    for (let k = 0; k < 8; k++) {
      list.push({
        x: (k * 7 + 5) * 16,
        w: 2 * 16,
      });
    }
    return list;
  }, []);

  const todayIdx = window.days.indexOf(today);
  const todayVisible = todayIdx !== -1;
  const todayX = todayIdx * 16;

  return (
    <section
      aria-label={`Timeline ${timelineLabel(window.from, window.to)}`}
      className="flex min-h-0 flex-1 flex-col rounded-[14px] border border-line bg-stage overflow-hidden"
    >
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex min-w-[1136px] flex-col">
          {/* Header */}
          <div className="sticky top-0 z-20 flex h-[34px] shrink-0 border-b border-line bg-[#0B0D10]">
            <div className="flex w-[240px] shrink-0 items-center border-r border-line px-4 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
              Tugas
            </div>
            <div className="relative w-[896px] shrink-0">
              {weeks.map((w) => (
                <span
                  key={w.x}
                  style={{ left: `${w.x}px` }}
                  className="absolute inset-y-0 flex items-center border-l border-line pl-2 font-mono text-[11px] text-muted"
                >
                  {w.label}
                </span>
              ))}
              {todayVisible && (
                <span
                  style={{ left: `${todayX}px` }}
                  className="absolute top-1.5 -translate-x-1/2 rounded bg-accent px-1.5 py-0.5 font-mono text-[10px] font-bold text-stage"
                >
                  HARI INI
                </span>
              )}
            </div>
          </div>

          {/* Rows */}
          <div className="relative flex-1">
            {/* Background grid */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-[240px] w-[896px]"
            >
              {weekends.map((w) => (
                <span
                  key={w.x}
                  style={{ left: `${w.x}px`, width: `${w.w}px` }}
                  className="absolute inset-y-0 bg-[#151920]"
                />
              ))}
              {weeks.map((w) => (
                <span
                  key={w.x}
                  style={{ left: `${w.x}px` }}
                  className="absolute inset-y-0 w-px bg-[#1F242D]"
                />
              ))}
              {todayVisible && (
                <span
                  style={{ left: `${todayX}px` }}
                  className="absolute inset-y-0 z-10 w-0.5 bg-accent"
                />
              )}
            </div>

            {groups.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-[13px] text-muted">
                Tidak ada tugas atau tagihan dalam rentang ini.
              </div>
            ) : (
              groups.map((group) => {
                const dlIdx = group.deadline ? window.days.indexOf(group.deadline) : -1;
                const dlVisible = dlIdx !== -1;
                const dlDiff = group.deadline ? diffDays(today, group.deadline) : 999;
                const metaText = group.deadline
                  ? `tenggat ${shortDateStr(group.deadline)}`
                  : `${group.items.length} item`;
                const metaColor =
                  group.deadline && dlDiff <= 3 ? "text-danger" : "text-muted";

                // Project span between earliest task start and deadline
                let span: { left: number; width: number } | null = null;
                if (group.deadline && group.items.length > 0) {
                  const minTaskStart = group.items.reduce((acc, it) => {
                    const s = it.startDate ?? it.dueDate;
                    return s < acc ? s : acc;
                  }, group.items[0].startDate ?? group.items[0].dueDate);
                  const rawSpanStart = minTaskStart <= group.deadline ? minTaskStart : group.deadline;
                  const rawSpanEnd = group.deadline;
                  if (!(rawSpanEnd < window.from || rawSpanStart > window.to)) {
                    const clipStart = rawSpanStart < window.from ? window.from : rawSpanStart;
                    const clipEnd = rawSpanEnd > window.to ? window.to : rawSpanEnd;
                    const sIdx = diffDays(window.from, clipStart);
                    const eIdx = diffDays(window.from, clipEnd);
                    span = {
                      left: sIdx * 16,
                      width: (eIdx - sIdx + 1) * 16,
                    };
                  }
                }

                return (
                  <div key={group.id} className="flex flex-col">
                    {/* Group Header Row */}
                    <div className="relative flex h-7 items-center border-t border-line bg-surface">
                      <div className="flex w-[240px] shrink-0 items-center gap-2 border-r border-line px-3">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                          style={{ backgroundColor: KIND_COLORS[group.kind] }}
                        />
                        <span
                          title={group.name}
                          className="truncate text-[13px] font-semibold text-ink flex-1"
                        >
                          {group.name}
                        </span>
                        <span className={`shrink-0 font-mono text-[11px] ${metaColor}`}>
                          {metaText}
                        </span>
                      </div>
                      <div className="relative h-full w-[896px] shrink-0">
                        {span && (
                          <span
                            aria-hidden="true"
                            style={{
                              left: `${span.left}px`,
                              width: `${span.width}px`,
                              backgroundColor: KIND_COLORS[group.kind],
                            }}
                            className="pointer-events-none absolute top-1/2 -mt-[3px] h-1.5 rounded-full opacity-25"
                          />
                        )}
                        {dlVisible && group.deadline && (
                          <button
                            type="button"
                            onClick={() => onOpenItem(group.id)}
                            title={`Tenggat ${group.name} · ${shortDateStr(group.deadline)}`}
                            aria-label={`Tenggat ${group.name} · ${shortDateStr(group.deadline)}`}
                            style={{ left: `${dlIdx * 16 + 3}px` }}
                            className="absolute top-1/2 -mt-[5px] h-2.5 w-2.5 rotate-45 cursor-pointer bg-[#3987e5] shadow-[0_0_0_2px_#171a21] transition-transform hover:scale-125 focus-visible:outline-2 focus-visible:outline-accent"
                          />
                        )}
                      </div>
                    </div>

                    {/* Group Items */}
                    {group.items.map((item) => {
                      const bar = barFor(item, window);
                      const statusText = STATUS_LABELS[item.status];
                      const dateText =
                        item.startDate && item.startDate !== item.dueDate
                          ? `${shortDateStr(item.startDate)} – ${shortDateStr(item.dueDate)}`
                          : shortDateStr(item.dueDate);
                      const overdueText = item.overdue ? " · Terlambat" : "";
                      const barTitle = `${item.title} · ${dateText} · ${statusText}${overdueText}`;

                      return (
                        <div
                          key={item.key}
                          className="flex h-[26px] items-center border-t border-line/40 hover:bg-surface-2/40"
                        >
                          <div className="flex w-[240px] shrink-0 items-center gap-2 border-r border-line pl-7 pr-3">
                            <button
                              type="button"
                              onClick={() => {
                                if (item.source === "bill") {
                                  onOpenFinance();
                                } else {
                                  onOpenItem(item.id);
                                }
                              }}
                              className="flex min-w-0 flex-1 cursor-pointer items-center text-left hover:underline focus-visible:outline-1 focus-visible:outline-accent"
                            >
                              <span
                                className={`truncate text-[12.5px] ${
                                  item.overdue ? "font-medium text-danger" : "text-ink/80"
                                }`}
                              >
                                {item.title}
                              </span>
                            </button>
                            <span
                              className={`shrink-0 font-mono text-[11px] ${
                                item.overdue ? "text-danger" : "text-muted"
                              }`}
                            >
                              {item.overdue ? "terlambat" : shortDateStr(item.dueDate)}
                            </span>
                          </div>
                          <div className="relative h-full w-[896px] shrink-0">
                            {bar && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (item.source === "bill") {
                                    onOpenFinance();
                                  } else {
                                    onOpenItem(item.id);
                                  }
                                }}
                                title={barTitle}
                                aria-label={barTitle}
                                style={{
                                  left: `${bar.left + 1}px`,
                                  width: `${Math.max(bar.width - 2, 8)}px`,
                                  backgroundColor:
                                    item.status === "doing"
                                      ? KIND_COLORS[item.kind]
                                      : "transparent",
                                  borderColor: KIND_COLORS[item.kind],
                                }}
                                className={`box-border absolute top-1/2 -mt-1.5 h-3 cursor-pointer rounded-[4px] border-[1.5px] transition-transform hover:scale-y-125 focus-visible:outline-2 focus-visible:outline-accent ${
                                  item.overdue ? "ring-2 ring-danger" : ""
                                }`}
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
