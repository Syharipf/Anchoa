import { describe, expect, test } from "bun:test";
import type { ItemSummary } from "../api";
import { paletteResults } from "./results";

const note = (id: string, title: string): ItemSummary => ({ id, type: "note", title, dueAt: null, lastActivityAt: 1 });
const recent = ["a", "b", "c", "d", "e", "f", "g"].map((id) => note(id, `catatan ${id}`));
const titles = (q: string, r: ItemSummary[] = recent) => paletteResults(q, r).map((g) => g.title);

describe("paletteResults", () => {
  test("an empty query lists every page and the five most recent items", () => {
    const groups = paletteResults("", recent);
    expect(groups.map((g) => g.title)).toEqual(["Buka halaman", "Terbaru"]);
    expect(groups[0].options.map((o) => o.label)).toEqual([
      "Dashboard", "Inbox", "Email", "Jadwal", "Keuangan", "Proyek", "Berkas", "Unduhan", "Profil", "Pengaturan",
    ]);
    expect(groups[1].options).toHaveLength(5);
  });

  test("whitespace alone does not offer to save a note", () => {
    expect(titles("   ")).toEqual(["Buka halaman", "Terbaru"]);
  });

  test("filtering ignores case and ends with the save option", () => {
    const groups = paletteResults("KEU", recent);
    expect(groups.map((g) => g.title)).toEqual(["Buka halaman", "Inbox"]);
    expect(groups[0].options.map((o) => o.label)).toEqual(["Keuangan"]);
    expect(groups[1].options[0]).toMatchObject({ kind: "capture", text: "KEU", label: "Simpan ke Inbox: “KEU”" });
  });

  test("text that matches nothing leaves only the save option", () => {
    const groups = paletteResults("  beli susu  ", recent);
    expect(groups).toHaveLength(1);
    expect(groups[0].options).toEqual([
      { kind: "capture", id: "capture", label: "Simpan ke Inbox: “beli susu”", sub: "Enter", text: "beli susu" },
    ]);
  });

  test("recent items match on their title", () => {
    const groups = paletteResults("catatan b", recent);
    expect(groups[0]).toMatchObject({ title: "Terbaru", options: [{ kind: "item", itemId: "b" }] });
  });

  test("no recent items means no Terbaru group", () => {
    expect(titles("", [])).toEqual(["Buka halaman"]);
  });
});
