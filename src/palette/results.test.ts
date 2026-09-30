import { describe, expect, test } from "bun:test";
import type { ItemSummary } from "../api";
import { paletteResults } from "./results";

const note = (id: string, title: string): ItemSummary => ({ id, type: "note", title, dueAt: null, lastActivityAt: 1 });
const recent = ["a", "b", "c", "d", "e", "f", "g"].map((id) => note(id, `catatan ${id}`));
const titles = (q: string, r: ItemSummary[] = recent) => paletteResults(q, r).map((g) => g.title);

describe("paletteResults", () => {
  test("an empty query lists every page and the five most recent items", () => {
    const groups = paletteResults("", recent);
    expect(groups.map((g) => g.title)).toEqual(["Aksi cepat", "Buka halaman", "Terbaru"]);
    expect(groups[1].options.map((o) => o.label)).toEqual([
      "Dashboard", "Inbox", "Email", "Jadwal", "Habit", "Keuangan", "Proyek", "Berkas", "Unduhan", "Profil", "Pengaturan",
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
    expect(groups[1].options[0]).toMatchObject({ kind: "capture", text: "KEU", label: "Simpan ke Inbox: “KEU”" });
    expect(groups[1].options[1]).toMatchObject({ kind: "task", text: "KEU", label: "Buat tugas: “KEU”" });
  });

  test("text that matches nothing leaves only the save option", () => {
    const groups = paletteResults("  beli susu  ", recent);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("Simpan");
    expect(groups[0].options).toEqual([
      { kind: "capture", id: "capture", label: "Simpan ke Inbox: “beli susu”", sub: "Enter", text: "beli susu" },
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
});
