import { useEffect, useState } from "react";
import { api, errorMessage, type Activity, type Board, type LastActor } from "../api";
import { useToast } from "../shell/toast";

type BoardState = Readonly<{
  selectedId: string | null;
  board: Board;
  lastActors: Readonly<Record<string, LastActor>>;
  running: boolean;
}>;

type ThreadState = Readonly<{
  selectedId: string;
  taskId: string;
  activities: readonly Activity[];
}>;

/** Poll compact card attribution; only the open thread loads full activity bodies. */
export function useProjectBoard(
  selectedId: string | null | undefined,
  version: number,
  openTaskId: string | null = null,
) {
  const toast = useToast();
  const [state, setState] = useState<BoardState | null>(null);
  const [thread, setThread] = useState<ThreadState | null>(null);

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
          lastActors: agent && previous && previous.selectedId === selectedId ? previous.lastActors : {},
          running: agent && previous && previous.selectedId === selectedId ? previous.running : false,
        }));
        if (!board.project?.agent) {
          clearInterval(timer);
          timer = undefined;
          return;
        }
        timer ??= setInterval(() => void refresh(), 3000);

        const [actors, running] = await Promise.allSettled([
          api.agentLastActors(board.project.id),
          api.agentRunning(),
        ]);
        if (!current(request)) return;
        setState((previous) => {
          if (!previous || previous.selectedId !== selectedId) return previous;
          return {
            ...previous,
            lastActors: actors.status === "fulfilled" ? actors.value : previous.lastActors,
            running: running.status === "fulfilled"
              ? running.value.includes(selectedId ?? "") : previous.running,
          };
        });
        const failure = [actors, running].find((result) => result.status === "rejected");
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
  const taskId = visible?.board.project?.agent && openTaskId &&
    Object.values(visible.board.columns).flat().some((card) => card.id === openTaskId)
    ? openTaskId : null;

  useEffect(() => {
    if (!taskId || !selectedId) {
      setThread(null);
      return;
    }
    let active = true;
    let requests = 0;
    const refresh = async () => {
      const request = ++requests;
      try {
        const activities = await api.taskActivities(taskId);
        if (active && request === requests) setThread({ selectedId, taskId, activities });
      } catch (error) {
        if (active && request === requests) toast(errorMessage(error), "error");
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      active = false;
      requests++;
      clearInterval(timer);
    };
  }, [selectedId, taskId, version, toast]);

  return {
    board: visible?.board ?? null,
    lastActors: visible?.lastActors ?? {},
    activities: taskId && thread && thread.selectedId === selectedId && thread.taskId === taskId ? thread.activities : undefined,
    running: visible?.running ?? false,
  };
}
