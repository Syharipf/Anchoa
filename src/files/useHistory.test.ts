import { describe, expect, it } from "bun:test";
import {
  historyBack,
  historyForward,
  historyGo,
  type HistoryState,
} from "./useHistory";

describe("useHistory state transitions", () => {
  it("initializes with empty entries and index -1 when empty", () => {
    const state: HistoryState = { entries: [], index: -1 };
    expect(state.entries).toHaveLength(0);
    expect(state.index).toBe(-1);
  });

  it("navigates forward with go and prunes future history", () => {
    let state: HistoryState = { entries: ["/home"], index: 0 };

    state = historyGo(state, "/home/docs");
    expect(state.entries).toEqual(["/home", "/home/docs"]);
    expect(state.index).toBe(1);

    state = historyGo(state, "/home/docs/work");
    expect(state.entries).toEqual(["/home", "/home/docs", "/home/docs/work"]);
    expect(state.index).toBe(2);

    state = historyBack(state);
    expect(state.index).toBe(1);

    // Navigating from index 1 should prune /home/docs/work
    state = historyGo(state, "/home/downloads");
    expect(state.entries).toEqual(["/home", "/home/docs", "/home/downloads"]);
    expect(state.index).toBe(2);
  });

  it("ignores go with identical path or empty string", () => {
    const state: HistoryState = { entries: ["/home"], index: 0 };
    expect(historyGo(state, "/home")).toBe(state);
    expect(historyGo(state, "")).toBe(state);
  });

  it("supports functional path updater", () => {
    const initial: HistoryState = { entries: [], index: -1 };
    const next = historyGo(initial, (prev) => prev || "/home");
    expect(next.entries).toEqual(["/home"]);
    expect(next.index).toBe(0);

    // If prev is already set, functional updater returning prev should not change state
    const same = historyGo(next, (prev) => prev || "/other");
    expect(same).toBe(next);
  });

  it("steps backward and forward within history bounds", () => {
    let state: HistoryState = {
      entries: ["/a", "/b", "/c"],
      index: 2,
    };

    state = historyBack(state);
    expect(state.index).toBe(1);

    state = historyBack(state);
    expect(state.index).toBe(0);

    // Cannot go back past 0
    state = historyBack(state);
    expect(state.index).toBe(0);

    state = historyForward(state);
    expect(state.index).toBe(1);

    state = historyForward(state);
    expect(state.index).toBe(2);

    // Cannot go forward past length - 1
    state = historyForward(state);
    expect(state.index).toBe(2);
  });
});
