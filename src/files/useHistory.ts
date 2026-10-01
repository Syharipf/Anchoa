import { useCallback, useState } from "react";

export interface HistoryHook {
  current: string;
  canBack: boolean;
  canForward: boolean;
  go: (path: string | ((prev: string) => string)) => void;
  back: () => void;
  forward: () => void;
}

export interface HistoryState {
  readonly entries: readonly string[];
  readonly index: number;
}

export function historyGo(
  state: HistoryState,
  target: string | ((prev: string) => string),
): HistoryState {
  const cur = state.entries[state.index] ?? "";
  const next = typeof target === "function" ? target(cur) : target;
  if (!next || next === cur) {
    return state;
  }
  const nextEntries = state.entries.slice(0, state.index + 1).concat(next);
  return {
    entries: nextEntries,
    index: nextEntries.length - 1,
  };
}

export function historyBack(state: HistoryState): HistoryState {
  if (state.index > 0) {
    return {
      entries: state.entries,
      index: state.index - 1,
    };
  }
  return state;
}

export function historyForward(state: HistoryState): HistoryState {
  if (state.index < state.entries.length - 1) {
    return {
      entries: state.entries,
      index: state.index + 1,
    };
  }
  return state;
}

export function useHistory(initialPath = ""): HistoryHook {
  const [state, setState] = useState<HistoryState>(() => ({
    entries: initialPath ? [initialPath] : [],
    index: initialPath ? 0 : -1,
  }));

  const go = useCallback((path: string | ((prev: string) => string)) => {
    setState((prev) => historyGo(prev, path));
  }, []);

  const back = useCallback(() => {
    setState(historyBack);
  }, []);

  const forward = useCallback(() => {
    setState(historyForward);
  }, []);

  return {
    current: state.entries[state.index] ?? "",
    canBack: state.index > 0,
    canForward: state.index >= 0 && state.index < state.entries.length - 1,
    go,
    back,
    forward,
  };
}
