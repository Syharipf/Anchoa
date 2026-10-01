import { useEffect, useState } from "react";
import { api, errorMessage, type Activity, type Board } from "../api";
import { useToast } from "../shell/toast";

type BoardState = Readonly<{
  selectedId: string | null;
  board: Board;
  activities: Readonly<Record<string, readonly Activity[]>>;
  running: boolean;
}>;

/** The board and its threads share one polling cycle, including card attribution. */
export function useProjectBoard(selectedId: string | null | undefined, version: number) {
  const toast = useToast();
  const [state, setState] = useState<BoardState | null>(null);

  useEffect(() => {
    if (selectedId === undefined) return;
    let active = true;
    let requests = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const current = (request: number) => active && request === requests;

    async function refresh() {
      const request = ++requests;
      try {
        const board = await api.projectBoard(selectedId ?? null);
        if (!current(request)) return;
        const agent = board.project?.agent === true;
        setState((previous) => ({
          selectedId: selectedId ?? null,
          board,
          activities: agent && previous && previous.selectedId === selectedId ? previous.activities : {},
          running: agent && previous && previous.selectedId === selectedId ? previous.running : false,
        }));
        if (!agent) {
          clearInterval(timer);
          timer = undefined;
          return;
        }
        timer ??= setInterval(() => void refresh(), 3000);

        // Existing task activity queries also supply the newest actor on each card.
        const cards = Object.values(board.columns).flat();
        const [[running], threads] = await Promise.all([
          Promise.allSettled([api.agentRunning()]),
          Promise.allSettled(cards.map((card) => api.taskActivities(card.id))),
        ]);
        if (!current(request)) return;
        setState((previous) => {
          if (!previous || previous.selectedId !== selectedId) return previous;
          const activities: Record<string, readonly Activity[]> = {};
          threads.forEach((result, index) => {
            const id = cards[index].id;
            activities[id] = result.status === "fulfilled"
              ? result.value
              : previous.activities[id] ?? [];
          });
          return {
            ...previous, activities,
            running: running.status === "fulfilled"
              ? running.value.includes(selectedId ?? "") : previous.running,
          };
        });
        const failure = [running, ...threads].find((result) => result.status === "rejected");
        if (failure?.status === "rejected") toast(errorMessage(failure.reason), "error");
      } catch (error) {
        if (current(request)) toast(errorMessage(error), "error");
      }
    }

    void refresh();
    return () => {
      active = false;
      requests++;
      clearInterval(timer);
    };
  }, [selectedId, version, toast]);

  const visible = state?.selectedId === selectedId ? state : null;
  return {
    board: visible?.board ?? null,
    activities: visible?.activities ?? {},
    running: visible?.running ?? false,
  };
}
