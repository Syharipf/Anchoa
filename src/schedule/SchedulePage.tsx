import { useEffect, useMemo, useState } from "react";
import {
  api,
  errorMessage,
  type ItemKind,
  type Schedule,
  type ScheduleItem,
} from "../api";
import { msToDateInput } from "../format";
import { formatRupiah, monthOf } from "../money";
import { useToast } from "../shell/toast";
import { AgendaPanel } from "./AgendaPanel";
import { CalendarView } from "./CalendarView";
import {
  addMonths,
  monthGrid,
  monthLabel,
  navSelectedDate,
  timelineLabel,
  timelineWindow,
  visible,
} from "./layout";
import { ScheduleHeader } from "./ScheduleHeader";
import { TimelineView } from "./TimelineView";

function loadOff(): Set<ItemKind> {
  try {
    const raw = localStorage.getItem("anchoa.schedule.off");
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return new Set(
          arr.filter(
            (k): k is ItemKind =>
              k === "project" || k === "bill" || k === "personal",
          ),
        );
      }
    }
  } catch {
    // Ignore localStorage read errors
  }
  return new Set();
}

function saveOff(off: ReadonlySet<ItemKind>): void {
  try {
    localStorage.setItem("anchoa.schedule.off", JSON.stringify([...off]));
  } catch {
    // Ignore localStorage write errors
  }
}

export function SchedulePage({
  onOpenItem,
  onOpenFinance,
  onChanged,
}: Readonly<{
  onOpenItem: (id: string) => void;
  onOpenFinance: () => void;
  onChanged: () => void;
}>) {
  const toast = useToast();
  const [view, setView] = useState<"calendar" | "timeline">("calendar");
  const [month, setMonth] = useState<string>(() => monthOf(Date.now()));
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    msToDateInput(Date.now()),
  );
  const [timelineShift, setTimelineShift] = useState(0);
  const [off, setOff] = useState<Set<ItemKind>>(() => loadOff());
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [version, setVersion] = useState(0);

  const today = schedule?.today ?? msToDateInput(Date.now());
  const grid = useMemo(() => monthGrid(month), [month]);
  const window = useMemo(
    () => timelineWindow(today, timelineShift),
    [today, timelineShift],
  );

  const from = view === "calendar" ? grid[0][0].date : window.from;
  const to = view === "calendar" ? grid[grid.length - 1][6].date : window.to;

  useEffect(() => {
    let active = true;
    api.schedule(from, to).then(
      (data) => {
        if (!active) return;
        setSchedule(data);
        setSelectedDate((prev) => prev || data.today);
      },
      (e) => {
        if (active) toast(errorMessage(e), "error");
      },
    );
    return () => {
      active = false;
    };
  }, [from, to, version, toast]);

  function handleToggleKind(kind: ItemKind) {
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) {
        next.delete(kind);
      } else {
        next.add(kind);
      }
      saveOff(next);
      return next;
    });
  }

  async function handleToggleTask(item: ScheduleItem) {
    try {
      const nextStatus = item.status === "done" ? "plan" : "done";
      await api.updateTask(item.id, { status: nextStatus });
      setVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function handlePayBill(item: ScheduleItem) {
    try {
      const tx = await api.payBill(item.id);
      toast(`Tercatat ${formatRupiah(tx.amount)}`);
      setVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  function handlePrev() {
    if (view === "calendar") {
      const nextMonth = addMonths(month, -1);
      setMonth(nextMonth);
      setSelectedDate(navSelectedDate(nextMonth, today));
    } else {
      setTimelineShift((s) => s - 4);
    }
  }

  function handleNext() {
    if (view === "calendar") {
      const nextMonth = addMonths(month, 1);
      setMonth(nextMonth);
      setSelectedDate(navSelectedDate(nextMonth, today));
    } else {
      setTimelineShift((s) => s + 4);
    }
  }

  function handleToday() {
    if (view === "calendar") {
      const curMonth = today.slice(0, 7);
      setMonth(curMonth);
      setSelectedDate(navSelectedDate(curMonth, today));
    } else {
      setTimelineShift(0);
    }
  }

  const periodLabel =
    view === "calendar"
      ? monthLabel(month)
      : timelineLabel(window.from, window.to);

  const counts: Record<ItemKind, number> = {
    project: 0,
    bill: 0,
    personal: 0,
  };
  if (schedule) {
    for (const item of schedule.items) {
      counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    }
  }

  const visibleItems = schedule ? visible(schedule.items, off) : [];

  return (
    <>
      <ScheduleHeader
        view={view}
        onViewChange={setView}
        periodLabel={periodLabel}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        off={off}
        onToggleKind={handleToggleKind}
        counts={counts}
      />

      {view === "calendar" && (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] items-start gap-[18px]">
          <CalendarView
            month={month}
            today={today}
            selectedDate={selectedDate}
            items={visibleItems}
            onSelectDate={setSelectedDate}
          />
          <AgendaPanel
            selectedDate={selectedDate}
            today={today}
            items={visibleItems}
            onToggleTask={handleToggleTask}
            onPayBill={handlePayBill}
            onOpenItem={onOpenItem}
            onOpenFinance={onOpenFinance}
          />
        </div>
      )}

      {view === "timeline" && (
        <TimelineView
          window={window}
          today={today}
          items={visibleItems}
          deadlines={schedule?.deadlines ?? []}
          onOpenItem={onOpenItem}
          onOpenFinance={onOpenFinance}
        />
      )}
    </>
  );
}
