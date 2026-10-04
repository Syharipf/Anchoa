import { afterEach, describe, expect, it, mock } from "bun:test";
import { elements, hookHarness } from "../test/hookHarness";
import { anchorOf, useContextMenu, type ContextMenuResult } from "./ContextMenu";

const textOf = (children: unknown): string =>
  Array.isArray(children) ? children.join("").trim() : String(children ?? "").trim();

describe("ContextMenu", () => {
  let harness: ReturnType<typeof hookHarness<ContextMenuResult>> | undefined;

  afterEach(() => {
    harness?.dispose();
    harness = undefined;
  });
  it("uses the mouse position, or the element corner for keyboard events", () => {
    const el = { getBoundingClientRect: () => ({ left: 10, bottom: 40 }) } as unknown as Element;
    expect(anchorOf({ clientX: 120, clientY: 80, currentTarget: el })).toEqual({ x: 120, y: 80 });
    expect(anchorOf({ clientX: 0, clientY: 0, currentTarget: el })).toEqual({ x: 10, y: 40 });
  });

  it("renders entries as menu items, runs one and closes", () => {
    const pick = mock(() => {});
    harness = hookHarness(() => useContextMenu());
    harness.render().open({ x: 5, y: 5 }, [
      { label: "Buka", onSelect: pick },
      "separator",
      { label: "Hapus", onSelect: () => {}, danger: true },
    ]);
    const items = elements(harness.render().menu).filter((e) => e.props.role === "menuitem");
    expect(items.map((e) => textOf(e.props.children))).toContain("Buka");
    (items[0].props.onClick as () => void)();
    expect(pick).toHaveBeenCalled();
    expect(harness.render().menu).toBeNull();
  });
});
