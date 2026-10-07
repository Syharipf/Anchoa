import { describe, expect, it } from "bun:test";
import {
  activeTab,
  initialTabs,
  loadTabs,
  makeTabs,
  saveTabs,
  tabBack,
  tabForward,
  tabGo,
  tabsActivate,
  tabsClose,
  tabsOpen,
  type FileTab,
  type TabsState,
} from "./useFileTabs";

function tab(path: string, history?: readonly string[], index?: number): FileTab {
  const entries = history ?? [path];
  return { id: path, path, entries, index: index ?? entries.length - 1 };
}

describe("useFileTabs rules", () => {
  describe("tabGo", () => {
    it("appends the new path and moves the index to the end", () => {
      const next = tabGo(tab("/a"), "/a/b");
      expect(next.path).toBe("/a/b");
      expect(next.entries).toEqual(["/a", "/a/b"]);
      expect(next.index).toBe(1);
    });

    it("drops forward history when navigating after going back", () => {
      const state = tab("/a/b", ["/a", "/a/b", "/a/c"], 1);
      const next = tabGo(state, "/a/d");
      expect(next.entries).toEqual(["/a", "/a/b", "/a/d"]);
      expect(next.index).toBe(2);
    });

    it("returns the same tab for an empty path or the current path", () => {
      const state = tab("/a");
      expect(tabGo(state, "")).toBe(state);
      expect(tabGo(state, "/a")).toBe(state);
    });
  });

  describe("tabBack and tabForward", () => {
    it("walks the history without mutating entries", () => {
      const state = tab("/a/b", ["/a", "/a/b"], 1);
      const back = tabBack(state);
      expect(back.path).toBe("/a");
      expect(back.entries).toEqual(["/a", "/a/b"]);
      expect(tabForward(back).path).toBe("/a/b");
    });

    it("stops at the ends", () => {
      const state = tab("/a");
      expect(tabBack(state)).toBe(state);
      expect(tabForward(state)).toBe(state);
    });
  });

  describe("tabsClose", () => {
    const state: TabsState = {
      tabs: [tab("/a"), tab("/b"), tab("/c")],
      activeId: "/b",
    };

    it("closes the tab and activates the neighbour to the left", () => {
      const next = tabsClose(state, "/b");
      expect(next.tabs.map((t) => t.id)).toEqual(["/a", "/c"]);
      expect(next.activeId).toBe("/a");
    });

    it("activates the first tab when the last one closes", () => {
      const next = tabsClose(state, "/c");
      expect(next.activeId).toBe("/b");
    });

    it("keeps the active tab when closing another tab", () => {
      const next = tabsClose(state, "/a");
      expect(next.activeId).toBe("/b");
    });

    it("refuses to close the last remaining tab", () => {
      const single: TabsState = { tabs: [tab("/a")], activeId: "/a" };
      expect(tabsClose(single, "/a")).toBe(single);
    });

    it("ignores unknown ids", () => {
      expect(tabsClose(state, "/nope")).toBe(state);
    });
  });

  describe("tabsOpen", () => {
    it("adds a new tab and activates it", () => {
      const state = makeTabs("/a");
      const next = tabsOpen(state, "/b");
      expect(next.tabs.map((t) => t.path)).toEqual(["/a", "/b"]);
      expect(next.activeId).toBe("/b");
    });

    it("reuses an existing tab for the same path", () => {
      const state: TabsState = { tabs: [tab("/a"), tab("/b")], activeId: "/a" };
      const next = tabsOpen(state, "/b");
      expect(next.tabs).toHaveLength(2);
      expect(next.activeId).toBe("/b");
    });

    it("gives a new tab a free id when a moved tab still owns its path as id", () => {
      const moved: FileTab = { id: "/a", path: "/a/b", entries: ["/a", "/a/b"], index: 1 };
      const next = tabsOpen({ tabs: [moved], activeId: "/a" }, "/a");
      expect(next.tabs.map((t) => t.id)).toEqual(["/a", "/a#1"]);
      expect(next.activeId).toBe("/a#1");
    });
  });

  describe("tabsActivate", () => {
    it("activates a known tab and ignores unknown ones", () => {
      const state: TabsState = { tabs: [tab("/a"), tab("/b")], activeId: "/a" };
      expect(tabsActivate(state, "/b").activeId).toBe("/b");
      expect(tabsActivate(state, "/nope")).toBe(state);
    });
  });

  describe("activeTab", () => {
    it("falls back to the first tab when the active id is unknown", () => {
      const state: TabsState = { tabs: [tab("/a")], activeId: "/gone" };
      expect(activeTab(state).id).toBe("/a");
    });
  });

  describe("persistence", () => {
    it("round-trips through saveTabs and loadTabs", () => {
      const store = new Map<string, string>();
      const fake = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      };
      const state: TabsState = {
        tabs: [tab("/a/b", ["/a", "/a/b"], 1), tab("/c")],
        activeId: "/c",
      };
      saveTabs(state, fake);
      expect(loadTabs(fake)).toEqual(state);
    });

    it("returns null for missing or corrupt storage", () => {
      expect(loadTabs({ getItem: () => null })).toBeNull();
      expect(loadTabs({ getItem: () => "{not json" })).toBeNull();
      expect(loadTabs({ getItem: () => JSON.stringify({ tabs: [] }) })).toBeNull();
      expect(loadTabs({ getItem: () => JSON.stringify({ tabs: "nope" }) })).toBeNull();
    });

    it("drops malformed tabs and clamps their index", () => {
      const raw = JSON.stringify({
        tabs: [
          { path: "/a", entries: ["/a", "/a/b"], index: 9 },
          { path: 42 },
          null,
          { path: "/c" },
        ],
        activeId: "/missing",
      });
      const state = loadTabs({ getItem: () => raw });
      expect(state?.tabs.map((t) => t.path)).toEqual(["/a", "/c"]);
      expect(state?.tabs[0].index).toBe(1);
      expect(state?.tabs[1].entries).toEqual(["/c"]);
      expect(state?.activeId).toBe("/a");
    });

    it("gives duplicate paths distinct ids and keeps the requested active tab", () => {
      const raw = JSON.stringify({
        tabs: [{ path: "/a" }, { path: "/a" }],
        activeId: "/a#1",
      });
      const state = loadTabs({ getItem: () => raw });
      expect(state?.tabs.map((t) => t.id)).toEqual(["/a", "/a#1"]);
      expect(state?.activeId).toBe("/a#1");
    });

    it("keeps stored ids so the active tab survives a reload", () => {
      const store = new Map<string, string>();
      const fake = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      };
      const moved: FileTab = { id: "/a", path: "/a/b", entries: ["/a", "/a/b"], index: 1 };
      saveTabs({ tabs: [tab("/c"), moved], activeId: "/a" }, fake);
      const state = loadTabs(fake);
      expect(state?.tabs.map((t) => t.id)).toEqual(["/c", "/a"]);
      expect(state?.activeId).toBe("/a");
    });

    it("does not persist a tab that has no folder yet", () => {
      const store = new Map<string, string>();
      saveTabs(makeTabs(""), { setItem: (k, v) => void store.set(k, v) });
      expect(store.size).toBe(0);
    });
  });

  describe("makeTabs", () => {
    it("creates an empty-history tab when no initial path is given", () => {
      const state = makeTabs("");
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0].entries).toEqual([]);
      expect(state.tabs[0].index).toBe(-1);
    });

    it("seeds history with the initial path", () => {
      const state = makeTabs("/home/user");
      expect(state.tabs[0].entries).toEqual(["/home/user"]);
      expect(state.activeId).toBe("/home/user");
    });
  });

  describe("initialTabs", () => {
    it("starts fresh without stored tabs", () => {
      expect(initialTabs(null, "/home/u").tabs.map((t) => t.path)).toEqual(["/home/u"]);
    });

    it("keeps restored tabs and opens the requested folder alongside", () => {
      const restored: TabsState = { tabs: [tab("/a")], activeId: "/a" };
      expect(initialTabs(restored, "")).toBe(restored);
      const next = initialTabs(restored, "/b");
      expect(next.tabs.map((t) => t.path)).toEqual(["/a", "/b"]);
      expect(next.activeId).toBe("/b");
    });
  });
});