import { useCallback, useEffect, useState } from "react";

export interface FileTab {
  /** Stable identity; the path the tab was opened at, suffixed when taken. */
  readonly id: string;
  readonly path: string;
  /** Per-tab back/forward history. */
  readonly entries: readonly string[];
  readonly index: number;
}

export interface TabsState {
  readonly tabs: readonly FileTab[];
  readonly activeId: string;
}

export function activeTab(state: TabsState): FileTab {
  return state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0];
}

/** Pure navigation inside one tab. */
export function tabGo(tab: FileTab, path: string): FileTab {
  if (!path || path === tab.path) return tab;
  const entries = tab.entries.slice(0, tab.index + 1).concat(path);
  return { ...tab, path, entries, index: entries.length - 1 };
}

export function tabBack(tab: FileTab): FileTab {
  if (tab.index <= 0) return tab;
  const index = tab.index - 1;
  return { ...tab, index, path: tab.entries[index] };
}

export function tabForward(tab: FileTab): FileTab {
  if (tab.index >= tab.entries.length - 1) return tab;
  const index = tab.index + 1;
  return { ...tab, index, path: tab.entries[index] };
}

/** Closes a tab; the neighbour to the left (or first tab) becomes active. */
export function tabsClose(state: TabsState, id: string): TabsState {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx === -1 || state.tabs.length <= 1) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  const nextIdx = idx > 0 ? idx - 1 : 0;
  const activeId = state.activeId === id ? tabs[nextIdx].id : state.activeId;
  return { tabs, activeId };
}

/** A tab that navigated away keeps its id, so a new tab at that path needs a suffix. */
function freeId(tabs: readonly FileTab[], path: string): string {
  const taken = new Set(tabs.map((t) => t.id));
  if (!taken.has(path)) return path;
  let n = 1;
  while (taken.has(`${path}#${n}`)) n += 1;
  return `${path}#${n}`;
}

export function tabsOpen(state: TabsState, path: string): TabsState {
  const existing = state.tabs.find((t) => t.path === path);
  if (existing) return { ...state, activeId: existing.id };
  const tab: FileTab = { id: freeId(state.tabs, path), path, entries: [path], index: 0 };
  return { tabs: [...state.tabs, tab], activeId: tab.id };
}

export function tabsActivate(state: TabsState, id: string): TabsState {
  return state.tabs.some((t) => t.id === id) ? { ...state, activeId: id } : state;
}

const KEY = "anchoa:files:tabs";

function parseTab(value: unknown, index: number, seen: Set<string>): FileTab | null {
  if (typeof value !== "object" || value === null) return null;
  const { id: rawId, path, entries: rawEntries, index: rawIndex } = value as {
    id?: unknown;
    path?: unknown;
    entries?: unknown;
    index?: unknown;
  };
  if (typeof path !== "string" || !path) return null;
  const list = Array.isArray(rawEntries) ? rawEntries : [];
  const entries = list.filter((e): e is string => typeof e === "string" && e.length > 0);
  const history = entries.length > 0 ? entries : [path];
  const maxIndex = history.length - 1;
  const index0 = typeof rawIndex === "number" ? rawIndex : 0;
  const clamped = Math.min(Math.max(Math.trunc(index0), 0), maxIndex);
  const wanted = typeof rawId === "string" && rawId ? rawId : path;
  const id = seen.has(wanted) ? `${wanted}#${index}` : wanted;
  seen.add(id);
  return { id, path, entries: history, index: clamped };
}

function sanitizeTabs(raw: string): TabsState | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("tabs" in parsed)) return null;
    const { tabs: rawTabs, activeId } = parsed as { tabs: unknown; activeId?: unknown };
    if (!Array.isArray(rawTabs)) return null;
    const seen = new Set<string>();
    const tabs: FileTab[] = [];
    for (const value of rawTabs) {
      const tab = parseTab(value, tabs.length, seen);
      if (tab) tabs.push(tab);
    }
    if (tabs.length === 0) return null;
    const active = typeof activeId === "string" && tabs.some((t) => t.id === activeId)
      ? activeId
      : tabs[0].id;
    return { tabs, activeId: active };
  } catch {
    return null;
  }
}

export function loadTabs(store: Pick<Storage, "getItem"> = localStorage): TabsState | null {
  try {
    const raw = store.getItem(KEY);
    return raw ? sanitizeTabs(raw) : null;
  } catch {
    return null;
  }
}

export function saveTabs(state: TabsState, store: Pick<Storage, "setItem"> = localStorage): void {
  // A tab still waiting for its first folder has nothing worth restoring.
  const tabs = state.tabs.filter((t) => t.path);
  if (tabs.length === 0) return;
  try {
    store.setItem(KEY, JSON.stringify({ tabs, activeId: state.activeId }));
  } catch {
    // Ignore storage failure
  }
}

export function makeTabs(initialPath: string): TabsState {
  const tab: FileTab = {
    id: initialPath || "home",
    path: initialPath,
    entries: initialPath ? [initialPath] : [],
    index: initialPath ? 0 : -1,
  };
  return { tabs: [tab], activeId: tab.id };
}

/** Restored tabs win; an explicit `initialPath` still gets (or reuses) a tab. */
export function initialTabs(restored: TabsState | null, initialPath: string): TabsState {
  if (!restored) return makeTabs(initialPath);
  return initialPath ? tabsOpen(restored, initialPath) : restored;
}

/**
 * Multi-tab folder state: open/close/switch, per-tab back/forward history,
 * persisted in localStorage under an `anchoa:` key.
 */
export function useFileTabs(initialPath: string) {
  const [state, setState] = useState<TabsState>(() => initialTabs(loadTabs(), initialPath));

  useEffect(() => {
    saveTabs(state);
  }, [state]);

  const update = useCallback((fn: (tab: FileTab) => FileTab) => {
    setState((s) => {
      const current = activeTab(s);
      const next = fn(current);
      return next === current ? s : { ...s, tabs: s.tabs.map((t) => (t.id === current.id ? next : t)) };
    });
  }, []);

  const go = useCallback(
    (target: string | ((current: string) => string)) =>
      update((t) => tabGo(t, typeof target === "function" ? target(t.path) : target)),
    [update],
  );
  const back = useCallback(() => update(tabBack), [update]);
  const forward = useCallback(() => update(tabForward), [update]);
  const openTab = useCallback((path: string) => setState((s) => tabsOpen(s, path)), []);
  const closeTab = useCallback((id: string) => setState((s) => tabsClose(s, id)), []);
  const activate = useCallback((id: string) => setState((s) => tabsActivate(s, id)), []);

  const active = activeTab(state);
  return {
    state,
    active,
    canBack: active.index > 0,
    canForward: active.index >= 0 && active.index < active.entries.length - 1,
    go,
    back,
    forward,
    openTab,
    closeTab,
    activate,
  };
}
