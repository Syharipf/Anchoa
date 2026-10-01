import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api, type SearchHit } from "../api";
import { deferred, elements, hookHarness } from "../test/hookHarness";
import { CommandPalette } from "./CommandPalette";

describe("CommandPalette search", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let search: ReturnType<typeof spyOn<typeof api, "searchItems">>;
  afterEach(() => { harness.dispose(); search.mockRestore(); });

  it("hides previous-query hits during debounce and loading, including Enter selection", async () => {
    const hit: SearchHit = {
      id: "old", type: "page", title: "Old result", snippet: "old", dueAt: null, lastActivityAt: 1,
    };
    const newSearch = deferred<SearchHit[]>();
    search = spyOn(api, "searchItems").mockResolvedValueOnce([hit]).mockImplementationOnce(() => newSearch.promise);
    const onOpenItem = mock(() => {});
    harness = hookHarness(() => CommandPalette({
      recent: [], onClose: () => {}, onNavigate: () => {}, onOpenItem,
      onCaptured: () => {}, onNewTransaction: () => {},
    }));
    const changeQuery = (value: string) => {
      const input = elements(harness.render()).find((element) => element.props.role === "combobox")!;
      (input.props.onChange as (event: unknown) => void)({ target: { value } });
      harness.render();
    };
    const itemIds = () => elements(harness.render()).filter((element) =>
      element.props.role === "option" && String(element.props.id).startsWith("palette-item-")).map((element) => element.props.id);
    changeQuery("old query");
    harness.runTimers();
    await harness.settle();
    expect(itemIds()).toEqual(["palette-item-old"]);
    changeQuery("new query");
    expect(itemIds()).toEqual([]);
    harness.runTimers();
    await harness.settle();
    expect(itemIds()).toEqual([]);
    const dialog = elements(harness.render()).find((element) => element.props.role === "dialog")!;
    // Escape capture's backend call: this test only checks that Enter cannot open the stale hit.
    const capture = spyOn(api, "captureNote").mockRejectedValue(new Error("Capture unavailable"));
    try {
      (dialog.props.onKeyDown as (event: unknown) => void)({ key: "Enter", preventDefault: () => {}, nativeEvent: { isComposing: false } });
      await harness.settle();
      expect(onOpenItem).not.toHaveBeenCalled();
      newSearch.resolve([{ ...hit, id: "new", title: "New result" }]);
      await harness.settle();
      expect(itemIds()).toEqual(["palette-item-new"]);
      changeQuery("  new query  ");
      expect(itemIds()).toEqual(["palette-item-new"]);
    } finally { capture.mockRestore(); }
  });
});
