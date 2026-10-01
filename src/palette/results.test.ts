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
    expect(groups.map((g) => g.title)).toEqual(["Aksi cepat", "Buka halaman", "Terbaru"]);
    expect(groups[1].options.map((o) => o.label)).toEqual([
      "Dashboard", "Jurnal", "Catatan", "Email", "Jadwal", "Habit", "Keuangan", "Proyek", "Berkas", "Unduhan", "Profil", "Pengaturan",
    ]);
    expect(groups[2].options).toHaveLength(5);
  });

  test("whitespace alone does not offer to save a note", () => {
    expect(titles("   ")).toEqual(["Aksi cepat", "Buka halaman", "Terbaru"]);
  });

  test("filtering ignores case and ends with the save option", () => {
    const groups = paletteResults("KEU", recent);
    expect(groups.map((g) => g.title)).toEqual(["Buka halaman", "Simpan"]);
    expect(groups[0].options.map((o) => o.label)).toEqual(["Keuangan"]);
    expect(groups[1].options[0]).toMatchObject({ kind: "capture", text: "KEU", label: "Simpan ke Jurnal: “KEU”" });
    expect(groups[1].options[1]).toMatchObject({ kind: "task", text: "KEU", label: "Buat tugas: “KEU”" });
  });

  test("text that matches nothing leaves only the save option", () => {
    const groups = paletteResults("  beli susu  ", recent);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Simpan");
    expect(groups[0].options).toEqual([
      { kind: "capture", id: "capture", label: "Simpan ke Jurnal: “beli susu”", sub: "Enter", text: "beli susu" },
      { kind: "task", id: "task", label: "Buat tugas: “beli susu”", sub: "", text: "beli susu" },
    ]);
  });

  test("create task option carries trimmed text", () => {
    const groups = paletteResults("  tugas baru  ", []);
    const simpanGroup = groups.find((g) => g.title === "Simpan");
    expect(simpanGroup).toBeDefined();
    expect(simpanGroup?.options[1]).toEqual({
      kind: "task",
      id: "task",
      label: "Buat tugas: “tugas baru”",
      sub: "",
      text: "tugas baru",
    });
  });

  test("recent items match on their title", () => {
    const groups = paletteResults("catatan b", recent);
    expect(groups[0]).toMatchObject({ title: "Terbaru", options: [{ kind: "item", itemId: "b" }] });
  });

  test("the quick action matches its label", () => {
    const groups = paletteResults("catat", recent);
    expect(groups[0]).toEqual({
      title: "Aksi cepat",
      options: [{ kind: "action", id: "action-new-transaction", label: "Catat transaksi", sub: "", action: "new-transaction" }],
    });
  });

  test("no recent items means no Terbaru group", () => {
    expect(titles("", [])).toEqual(["Aksi cepat", "Buka halaman"]);
  });

  test("combines command groups and search hits with Item after commands", () => {
    const hits: SearchHit[] = [
      {
        id: "hit-1",
        type: "note",
        title: "Catatan Harian",
        snippet: "isi \u0002catatan\u0003 harian",
        dueAt: null,
        lastActivityAt: 100,
      },
      {
        id: "hit-2",
        type: "page",
        title: "Ide Fitur",
        snippet: "daftar \u0002catatan\u0003 ide",
        dueAt: null,
        lastActivityAt: 200,
      },
    ];

    // "catat" matches "Catat transaksi" (Aksi cepat) and "Catatan" (Buka halaman)
    const groups = paletteResults("catat", recent, hits);
    expect(groups.map((g) => g.title)).toEqual(["Aksi cepat", "Buka halaman", "Item", "Simpan"]);

    const itemGroup = groups.find((g) => g.title === "Item");
    expect(itemGroup).toBeDefined();
    expect(itemGroup?.options).toEqual([
      {
        kind: "item",
        id: "item-hit-1",
        label: "Catatan Harian",
        sub: "Jurnal",
        itemId: "hit-1",
        snippet: "isi \u0002catatan\u0003 harian",
      },
      {
        kind: "item",
        id: "item-hit-2",
        label: "Ide Fitur",
        sub: "Catatan",
        itemId: "hit-2",
        snippet: "daftar \u0002catatan\u0003 ide",
      },
    ]);
  });

  test("search hits without matching commands list Item group before Simpan", () => {
    const hits: SearchHit[] = [
      {
        id: "hit-3",
        type: "habit",
        title: "Olahraga",
        snippet: "cuplikan \u0002olahraga\u0003",
        dueAt: null,
        lastActivityAt: 300,
      },
    ];

    const groups = paletteResults("olahraga", recent, hits);
    expect(groups.map((g) => g.title)).toEqual(["Item", "Simpan"]);
    expect(groups[0].options[0]).toEqual({
      kind: "item",
      id: "item-hit-3",
      label: "Olahraga",
      sub: "Habit",
      itemId: "hit-3",
      snippet: "cuplikan \u0002olahraga\u0003",
    });
  });

  test("search hit with empty title falls back to Tanpa judul", () => {
    const hits: SearchHit[] = [
      {
        id: "hit-empty",
        type: "task",
        title: "",
        snippet: "\u0002tugas\u0003 tanpa judul",
        dueAt: null,
        lastActivityAt: 50,
      },
    ];
    const groups = paletteResults("tugas", [], hits);
    const itemGroup = groups.find((g) => g.title === "Item");
    expect(itemGroup?.options[0].label).toBe("Tanpa judul");
    expect(itemGroup?.options[0].sub).toBe("Tugas");
  });

  test("itemKindLabel maps known item types and falls back to Item", () => {
    expect(itemKindLabel("page")).toBe("Catatan");
    expect(itemKindLabel("note")).toBe("Jurnal");
    expect(itemKindLabel("task")).toBe("Tugas");
    expect(itemKindLabel("habit")).toBe("Habit");
    expect(itemKindLabel("project")).toBe("Proyek");
    expect(itemKindLabel("other")).toBe("Item");
    expect(itemKindLabel("")).toBe("Item");
  });

  test("searchItemOption builds option with snippet and item id", () => {
    const hit: SearchHit = {
      id: "p1",
      type: "project",
      title: "Anchoa",
      snippet: "aplikasi \u0002anchoa\u0003",
      dueAt: null,
      lastActivityAt: 1,
    };
    expect(searchItemOption(hit)).toEqual({
      kind: "item",
      id: "item-p1",
      label: "Anchoa",
      sub: "Proyek",
      itemId: "p1",
      snippet: "aplikasi \u0002anchoa\u0003",
    });
  });

  test("arrow navigation steps across group boundaries and clamps at limits", () => {
    const hits: SearchHit[] = [
      {
        id: "hit-1",
        type: "page",
        title: "Halaman A",
        snippet: "cuplikan a",
        dueAt: null,
        lastActivityAt: 1,
      },
      {
        id: "hit-2",
        type: "note",
        title: "Catatan B",
        snippet: "cuplikan b",
        dueAt: null,
        lastActivityAt: 2,
      },
    ];

    const groups = paletteResults("catat", recent, hits);
    // Groups: Aksi cepat (1 opt), Buka halaman (1 opt: "Catatan"), Item (2 opts), Simpan (2 opts)
    expect(groups.map((g) => g.title)).toEqual(["Aksi cepat", "Buka halaman", "Item", "Simpan"]);

    const flat = groups.flatMap((g) => g.options);
    expect(flat).toHaveLength(6);
    expect(flat[0].kind).toBe("action");
    expect(flat[1].kind).toBe("page");
    expect(flat[2].kind).toBe("item");
    expect(flat[3].kind).toBe("item");
    expect(flat[4].kind).toBe("capture");
    expect(flat[5].kind).toBe("task");

    // Navigating down:
    // 0: Aksi cepat
    // 1: Buka halaman
    // Crossing boundary from command to item group (1 -> 2)
    let idx = 1;
    idx = nextActiveIndex(idx, flat.length, 1);
    expect(idx).toBe(2);
    expect(flat[idx].kind).toBe("item");
    expect(flat[idx].id).toBe("item-hit-1");

    // Moving within item group (2 -> 3)
    idx = nextActiveIndex(idx, flat.length, 1);
    expect(idx).toBe(3);
    expect(flat[idx].id).toBe("item-hit-2");

    // Crossing boundary from item group to save group (3 -> 4)
    idx = nextActiveIndex(idx, flat.length, 1);
    expect(idx).toBe(4);
    expect(flat[idx].kind).toBe("capture");

    // Moving within save group (4 -> 5)
    idx = nextActiveIndex(idx, flat.length, 1);
    expect(idx).toBe(5);
    expect(flat[idx].kind).toBe("task");

    // Clamping at bottom
    idx = nextActiveIndex(idx, flat.length, 1);
    expect(idx).toBe(5);

    // Navigating up:
    // Crossing boundary from save group back to item group (4 -> 3)
    idx = 4;
    idx = nextActiveIndex(idx, flat.length, -1);
    expect(idx).toBe(3);
    expect(flat[idx].kind).toBe("item");

    // Crossing boundary from item group back to command group (2 -> 1)
    idx = 2;
    idx = nextActiveIndex(idx, flat.length, -1);
    expect(idx).toBe(1);
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
