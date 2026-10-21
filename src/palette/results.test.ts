import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ItemSummary, SearchHit } from "../api";
import { CommandPalette } from "./CommandPalette";
import { itemKindLabel, nextActiveIndex, paletteResults, searchItemOption } from "./results";

const note = (id: string, title: string): ItemSummary => ({ id, type: "note", title, dueAt: null, lastActivityAt: 1 });
const recent = ["a", "b", "c", "d", "e", "f", "g"].map((id) => note(id, `catatan ${id}`));
const titles = (q: string, r: ItemSummary[] = recent) => paletteResults(q, r).map((g) => g.title);

describe("paletteResults", () => {
  test("an empty query lists every page and the five most recent items", () => {
    const groups = paletteResults("", recent);
    expect(groups.map((g) => g.title)).toEqual(["Quick actions", "Open page", "Recent"]);
    expect(groups[1].options.map((o) => o.label)).toEqual([
      "Dashboard", "Journal", "Notes", "Email", "Schedule", "Habits", "Health", "Finance", "Projects", "Files", "Downloads", "Library", "Profile", "Settings",
    ]);
    expect(groups[2].options).toHaveLength(5);
  });

  test("whitespace alone does not offer to save a note", () => {
    expect(titles("   ")).toEqual(["Quick actions", "Open page", "Recent"]);
  });

  test("filtering ignores case and ends with the save option", () => {
    const groups = paletteResults("FIN", recent);
    expect(groups.map((g) => g.title)).toEqual(["Open page", "Save"]);
    expect(groups[0].options.map((o) => o.label)).toEqual(["Finance"]);
    expect(groups[1].options[0]).toMatchObject({ kind: "capture", text: "FIN", label: "Save to Journal: “FIN”" });
    expect(groups[1].options[1]).toMatchObject({ kind: "task", text: "FIN", label: "Create task: “FIN”" });
  });

  test("text that matches nothing leaves only the save option", () => {
    const groups = paletteResults("  buy milk  ", recent);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Save");
    expect(groups[0].options).toEqual([
      { kind: "capture", id: "capture", label: "Save to Journal: “buy milk”", sub: "Enter", text: "buy milk" },
      { kind: "task", id: "task", label: "Create task: “buy milk”", sub: "", text: "buy milk" },
    ]);
  });

  test("create task option carries trimmed text", () => {
    const groups = paletteResults("  new task  ", []);
    const simpanGroup = groups.find((g) => g.title === "Save");
    expect(simpanGroup).toBeDefined();
    expect(simpanGroup?.options[1]).toEqual({
      kind: "task",
      id: "task",
      label: "Create task: “new task”",
      sub: "",
      text: "new task",
    });
  });

  test("recent items match on their title", () => {
    const groups = paletteResults("catatan b", recent);
    expect(groups[0]).toMatchObject({ title: "Recent", options: [{ kind: "item", itemId: "b" }] });
  });

  test("the quick action matches its label", () => {
    const groups = paletteResults("record", recent);
    expect(groups[0]).toEqual({
      title: "Quick actions",
      options: [{ kind: "action", id: "action-new-transaction", label: "Record transaction", sub: "", action: "new-transaction" }],
    });
  });

  test("no recent items means no Recent group", () => {
    expect(titles("", [])).toEqual(["Quick actions", "Open page"]);
  });

  test("combines command groups and search hits with Item after commands", () => {
    const hits: SearchHit[] = [
      {
        id: "hit-1",
        type: "note",
        title: "Daily Journal",
        snippet: "content \u0002record\u0003 daily",
        dueAt: null,
        lastActivityAt: 100,
      },
      {
        id: "hit-2",
        type: "page",
        title: "Feature Ideas",
        snippet: "list \u0002record\u0003 idea",
        dueAt: null,
        lastActivityAt: 200,
      },
    ];

    // "record" matches "Record transaction" (Quick actions)
    const groups = paletteResults("record", recent, hits);
    expect(groups.map((g) => g.title)).toEqual(["Quick actions", "Item", "Save"]);

    const itemGroup = groups.find((g) => g.title === "Item");
    expect(itemGroup).toBeDefined();
    expect(itemGroup?.options).toEqual([
      {
        kind: "item",
        id: "item-hit-1",
        label: "Daily Journal",
        sub: "Journal",
        itemId: "hit-1",
        snippet: "content \u0002record\u0003 daily",
      },
      {
        kind: "item",
        id: "item-hit-2",
        label: "Feature Ideas",
        sub: "Notes",
        itemId: "hit-2",
        snippet: "list \u0002record\u0003 idea",
      },
    ]);
  });

  test("search hits without matching commands list Item group before Save", () => {
    const hits: SearchHit[] = [
      {
        id: "hit-3",
        type: "habit",
        title: "Exercise",
        snippet: "snippet \u0002exercise\u0003",
        dueAt: null,
        lastActivityAt: 300,
      },
    ];

    const groups = paletteResults("exercise", recent, hits);
    expect(groups.map((g) => g.title)).toEqual(["Item", "Save"]);
    expect(groups[0].options[0]).toEqual({
      kind: "item",
      id: "item-hit-3",
      label: "Exercise",
      sub: "Habits",
      itemId: "hit-3",
      snippet: "snippet \u0002exercise\u0003",
    });
  });

  test("search hit with empty title falls back to Untitled", () => {
    const hits: SearchHit[] = [
      {
        id: "hit-empty",
        type: "task",
        title: "",
        snippet: "\u0002task\u0003 untitled",
        dueAt: null,
        lastActivityAt: 50,
      },
    ];
    const groups = paletteResults("task", [], hits);
    const itemGroup = groups.find((g) => g.title === "Item");
    expect(itemGroup?.options[0].label).toBe("Untitled");
    expect(itemGroup?.options[0].sub).toBe("Tasks");
  });

  test("itemKindLabel maps known item types and falls back to Item", () => {
    expect(itemKindLabel("page")).toBe("Notes");
    expect(itemKindLabel("note")).toBe("Journal");
    expect(itemKindLabel("task")).toBe("Tasks");
    expect(itemKindLabel("habit")).toBe("Habits");
    expect(itemKindLabel("project")).toBe("Projects");
    expect(itemKindLabel("media")).toBe("Library");
    expect(itemKindLabel("other")).toBe("Item");
    expect(itemKindLabel("")).toBe("Item");
  });

  test("searchItemOption builds option with snippet and item id", () => {
    const hit: SearchHit = {
      id: "p1",
      type: "project",
      title: "Anchoa",
      snippet: "app \u0002anchoa\u0003",
      dueAt: null,
      lastActivityAt: 1,
    };
    expect(searchItemOption(hit)).toEqual({
      kind: "item",
      id: "item-p1",
      label: "Anchoa",
      sub: "Projects",
      itemId: "p1",
      snippet: "app \u0002anchoa\u0003",
    });
  });

  test("arrow navigation steps across group boundaries and clamps at limits", () => {
    const hits: SearchHit[] = [
      {
        id: "hit-1",
        type: "page",
        title: "Page A",
        snippet: "snippet a",
        dueAt: null,
        lastActivityAt: 1,
      },
      {
        id: "hit-2",
        type: "note",
        title: "Note B",
        snippet: "snippet b",
        dueAt: null,
        lastActivityAt: 2,
      },
    ];

    const groups = paletteResults("note", recent, hits);
    // Groups: Open page (1 opt: "Notes"), Item (2 opts), Save (2 opts)
    expect(groups.map((g) => g.title)).toEqual(["Open page", "Item", "Save"]);

    const flat = groups.flatMap((g) => g.options);
    expect(flat).toHaveLength(5);
    expect(flat[0].kind).toBe("page");
    expect(flat[1].kind).toBe("item");
    expect(flat[2].kind).toBe("item");
    expect(flat[3].kind).toBe("capture");
    expect(flat[4].kind).toBe("task");

    // Navigating down:
    // 0: Open page
    // Crossing boundary from command to item group (0 -> 1)
    let idx = 0;
    idx = nextActiveIndex(idx, flat.length, 1);
    expect(idx).toBe(1);
    expect(flat[idx].kind).toBe("item");
    expect(flat[idx].id).toBe("item-hit-1");

    // Moving within item group (1 -> 2)
    idx = nextActiveIndex(idx, flat.length, 1);
    expect(idx).toBe(2);
    expect(flat[idx].id).toBe("item-hit-2");

    // Crossing boundary from item group to save group (2 -> 3)
    idx = nextActiveIndex(idx, flat.length, 1);
    expect(idx).toBe(3);
    expect(flat[idx].kind).toBe("capture");

    // Moving within save group (3 -> 4)
    idx = nextActiveIndex(idx, flat.length, 1);
    expect(idx).toBe(4);
    expect(flat[idx].kind).toBe("task");

    // Clamping at bottom
    idx = nextActiveIndex(idx, flat.length, 1);
    expect(idx).toBe(4);

    // Navigating up:
    // Crossing boundary from save group back to item group (3 -> 2)
    idx = 3;
    idx = nextActiveIndex(idx, flat.length, -1);
    expect(idx).toBe(2);
    expect(flat[idx].kind).toBe("item");

    // Crossing boundary from item group back to command group (1 -> 0)
    idx = 1;
    idx = nextActiveIndex(idx, flat.length, -1);
    expect(idx).toBe(0);
    expect(flat[idx].kind).toBe("page");

    // Clamping at top
    idx = nextActiveIndex(0, flat.length, -1);
    expect(idx).toBe(0);

    // Total 0 edge case
    expect(nextActiveIndex(0, 0, 1)).toBe(0);
  });

  test("renders CommandPalette in static markup", () => {
    const html = renderToStaticMarkup(
      createElement(CommandPalette, {
        recent: recent.slice(0, 2),
        onClose: () => {},
        onNavigate: () => {},
        onOpenItem: () => {},
        onCaptured: () => {},
        onNewTransaction: () => {},
      }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("catatan a");
    expect(html).toContain("catatan b");
  });
});
