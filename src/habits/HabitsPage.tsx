import { useEffect, useState } from "react";
import type { OpenAssistant } from "../assistant/useAssistantRequest";
import {
  api,
  errorMessage,
  type HabitInput,
  type HabitRow,
  type HabitsOverview,
} from "../api";
import { fullDate } from "../format";
import { useToast } from "../shell/toast";
import { H1, HEADER_PRIMARY, HEADER_SECONDARY } from "../shell/ui";
import { HabitDetail } from "./HabitDetail";
import { HabitForm } from "./HabitForm";
import { SummaryCards } from "./SummaryCards";
import { TodayList } from "./TodayList";

function MicIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      className="text-accent"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function HabitsPage({
  onChanged,
  onOpenAssistant,
}: Readonly<{
  onChanged?: () => void;
  onOpenAssistant: OpenAssistant;
}>) {
  const toast = useToast();
  const [overview, setOverview] = useState<HabitsOverview | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState<{ edit?: HabitRow | null } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.habitsOverview().then(
      (data) => {
        if (cancelled) return;
        setOverview(data);
        setSelectedId((prev) => {
          if (prev !== null && data.habits.some((h) => h.id === prev)) {
            return prev;
          }
          return data.habits.length > 0 ? data.habits[0].id : null;
        });
      },
      (e) => {
        if (!cancelled) {
          toast(errorMessage(e), "error");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [version, toast]);

  if (!overview) {
    return <h1 className={H1}>Habit</h1>;
  }

  const [y, m, d] = overview.today.split("-").map(Number);
  const todayMs = new Date(y, m - 1, d).getTime();
  const subtitle = `Kebiasaan harian · ${fullDate(todayMs)}`;
  const selectedHabit = overview.habits.find((h) => h.id === selectedId) ?? null;

  async function handleToggleCheck(id: string, done: boolean) {
    try {
      await api.checkHabit(id, done);
      setVersion((v) => v + 1);
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function handleUpdateHabit(input: HabitInput) {
    try {
      await api.saveHabit(input);
      setVersion((v) => v + 1);
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function handleDeleteHabit(id: string) {
    try {
      await api.deleteHabit(id);
      setSelectedId(null);
      setVersion((v) => v + 1);
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  function handleSaved(id?: string) {
    setFormOpen(null);
    if (id) {
      setSelectedId(id);
    }
    setVersion((v) => v + 1);
    onChanged?.();
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <h1 className={H1}>Habit</h1>
        <span className="text-[13px] text-muted">{subtitle}</span>
        <div className="ml-auto flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onOpenAssistant({ kind: "voice" })}
            className={HEADER_SECONDARY}
          >
            <MicIcon />
            <span>Catat lewat suara</span>
          </button>
          <button
            type="button"
            onClick={() => setFormOpen({})}
            className={HEADER_PRIMARY}
          >
            <PlusIcon />
            <span>Habit</span>
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_392px] gap-4">
        <div className="flex min-h-0 flex-col gap-3.5">
          <SummaryCards
            todayDone={overview.todayDone}
            todayTotal={overview.todayTotal}
            topStreak={overview.topStreak}
            consistency={overview.consistency}
            habits={overview.habits}
          />
          <TodayList
            today={overview.today}
            habits={overview.habits}
            todayDone={overview.todayDone}
            todayTotal={overview.todayTotal}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
            onToggleCheck={handleToggleCheck}
            onNewHabit={() => setFormOpen({})}
          />
        </div>

        <HabitDetail
          habit={selectedHabit}
          today={overview.today}
          onEdit={(h) => setFormOpen({ edit: h })}
          onDelete={handleDeleteHabit}
          onUpdate={handleUpdateHabit}
        />
      </div>

      {formOpen && (
        <HabitForm
          edit={formOpen.edit}
          onClose={() => setFormOpen(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
