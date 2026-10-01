import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api } from "./api";
import { App } from "./App";
import { NotesPage } from "./notes/NotesPage";
import { CommandPalette } from "./palette/CommandPalette";
import { Sidebar } from "./shell/Sidebar";
import { elements, hookHarness } from "./test/hookHarness";

describe("App note navigation", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let opening: ReturnType<typeof spyOn<typeof api, "openItem">>;
  afterEach(() => { harness.dispose(); opening.mockRestore(); });

  it("gives each palette open and Catatan navigation a fresh NotesPage key", async () => {
    opening = spyOn(api, "openItem").mockResolvedValue({
      id: "A", type: "page", title: "A", body: "", parentId: null, dueAt: null,
      createdAt: 1, updatedAt: 1, openedAt: null,
    });
    // Start with a ready database and the palette open; no dashboard effects are needed.
    harness = hookHarness(App, { 0: { path: "/db", error: null }, 2: "palette" });
    const render = () => harness.render(false);
    const palette = () => elements(render()).find((element) => element.type === CommandPalette)!;
    const note = () => elements(render()).find((element) => element.type === NotesPage)!;
    (palette().props.onOpenItem as (id: string) => void)("A");
    await Promise.resolve();
    const first = note();
    // NotesPage can select B internally while its initialId remains A. Opening A again must remount it.
    (palette().props.onOpenItem as (id: string) => void)("A");
    await Promise.resolve();
    expect(note().props.initialId).toBe("A");
    expect(note().key).not.toBe(first.key);
    const sidebar = elements(render()).find((element) => element.type === Sidebar)!;
    (sidebar.props.onSelect as (name: string) => void)("catatan");
    const treeKey = note().key;
    (sidebar.props.onSelect as (name: string) => void)("catatan");
    expect(note().key).not.toBe(treeKey);
  });
});
