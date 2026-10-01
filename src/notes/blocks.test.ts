import { beforeEach, describe, expect, it } from "bun:test";
import {
  blockKind,
  createBlock,
  enterAt,
  filterSlashOptions,
  insertLink,
  joinBlocks,
  linkQuery,
  mergeBlockWithPrevious,
  resetBlockIdCounterForTests,
  setKind,
  slashQuery,
  splitBlockAt,
  splitBlocks,
  toggleTodo,
  type BlockKind,
} from "./blocks";

describe("blocks model", () => {
  beforeEach(() => {
    resetBlockIdCounterForTests(1);
  });

  describe("splitBlocks and joinBlocks", () => {
    it("returns empty array for empty or whitespace-only bodies", () => {
      expect(splitBlocks("")).toEqual([]);
      expect(splitBlocks("   ")).toEqual([]);
      expect(splitBlocks("\n\n\t  \n")).toEqual([]);
    });

    it("splits paragraphs separated by blank lines", () => {
      const body = "Paragraf pertama\n\nParagraf kedua\n\nParagraf ketiga";
      const blocks = splitBlocks(body);
      expect(blocks).toHaveLength(3);
      expect(blocks[0]).toEqual({ id: 1, text: "Paragraf pertama" });
      expect(blocks[1]).toEqual({ id: 2, text: "Paragraf kedua" });
      expect(blocks[2]).toEqual({ id: 3, text: "Paragraf ketiga" });
    });

    it("normalizes multiple blank lines between blocks", () => {
      const body = "Blok 1\n\n\n\nBlok 2";
      const blocks = splitBlocks(body);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].text).toBe("Blok 1");
      expect(blocks[1].text).toBe("Blok 2");
    });

    it("ignores leading and trailing blank lines", () => {
      const body = "\n\n# Judul\n\nIsi paragraf\n\n\n";
      const blocks = splitBlocks(body);
      expect(blocks).toHaveLength(2);
      expect(blocks[0].text).toBe("# Judul");
      expect(blocks[1].text).toBe("Isi paragraf");
    });

    it("keeps code fences with internal blank lines intact as a single block", () => {
      const body = [
        "# Catatan Kode",
        "",
        "```typescript",
        "function greet(name: string): string {",
        "  const greeting = 'Halo ' + name;",
        "",
        "  return greeting;",
        "}",
        "```",
        "",
        "Paragraf penutup",
      ].join("\n");

      const blocks = splitBlocks(body);
      expect(blocks).toHaveLength(3);
      expect(blocks[0].text).toBe("# Catatan Kode");
      expect(blocks[1].text).toBe(
        [
          "```typescript",
          "function greet(name: string): string {",
          "  const greeting = 'Halo ' + name;",
          "",
          "  return greeting;",
          "}",
          "```",
        ].join("\n"),
      );
      expect(blocks[2].text).toBe("Paragraf penutup");
    });

    it("keeps list items without blank lines in a single block", () => {
      const body = "- Item 1\n- Item 2\n- Item 3";
      const blocks = splitBlocks(body);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].text).toBe("- Item 1\n- Item 2\n- Item 3");
    });

    it("round-trips mixed content with joinBlocks and splitBlocks", () => {
      const mixed = [
        "# Rencana Proyek",
        "",
        "Berikut adalah langkah kerja:",
        "",
        "- [x] Riset awal",
        "- [ ] Implementasi blok",
        "",
        "```rust",
        "fn main() {",
        "",
        "    println!(\"Anchoa\");",
        "}",
        "```",
        "",
        "> Catatan penting jangan diabaikan.",
      ].join("\n");

      const blocks = splitBlocks(mixed);
      const joined = joinBlocks(blocks);
      expect(joined).toBe(mixed);

      const reSplit = splitBlocks(joined);
      expect(reSplit.map((b) => b.text)).toEqual(blocks.map((b) => b.text));
    });

    it("omits empty blocks at the end when joining blocks", () => {
      const blocks = [
        { id: 1, text: "Blok pertama" },
        { id: 2, text: "Blok kedua" },
        { id: 3, text: "" },
        { id: 4, text: "   " },
      ];
      expect(joinBlocks(blocks)).toBe("Blok pertama\n\nBlok kedua");
      expect(joinBlocks([])).toBe("");
      expect(joinBlocks([{ id: 1, text: "" }])).toBe("");
    });
  });

  describe("blockKind", () => {
    it("detects paragraph", () => {
      expect(blockKind("Teks biasa")).toBe("paragraph");
      expect(blockKind("")).toBe("paragraph");
      expect(blockKind("Baris pertama\nBaris kedua")).toBe("paragraph");
    });

    it("detects headings 1, 2, and 3", () => {
      expect(blockKind("# Judul 1")).toBe("heading1");
      expect(blockKind("# ")).toBe("heading1");
      expect(blockKind("## Judul 2")).toBe("heading2");
      expect(blockKind("### Judul 3")).toBe("heading3");
      expect(blockKind("#tagbukanjudul")).toBe("paragraph");
    });

    it("detects bullets", () => {
      expect(blockKind("- Poin A")).toBe("bullet");
      expect(blockKind("* Poin B")).toBe("bullet");
      expect(blockKind("+ Poin C")).toBe("bullet");
      expect(blockKind("- ")).toBe("bullet");
    });

    it("detects numbered lists", () => {
      expect(blockKind("1. Langkah satu")).toBe("numbered");
      expect(blockKind("2. Langkah dua")).toBe("numbered");
      expect(blockKind("10. Langkah sepuluh")).toBe("numbered");
      expect(blockKind("1. ")).toBe("numbered");
    });

    it("detects todo items", () => {
      expect(blockKind("- [ ] Belum selesai")).toBe("todo");
      expect(blockKind("- [x] Sudah selesai")).toBe("todo");
      expect(blockKind("- [X] Selesai kapital")).toBe("todo");
      expect(blockKind("* [ ] Bintang todo")).toBe("todo");
      expect(blockKind("[ ] Tanpa dash")).toBe("todo");
      expect(blockKind("- [ ] ")).toBe("todo");
    });

    it("detects quotes", () => {
      expect(blockKind("> Kutipan penting")).toBe("quote");
      expect(blockKind("> ")).toBe("quote");
    });

    it("detects code blocks", () => {
      expect(blockKind("```\ncode\n```")).toBe("code");
      expect(blockKind("```python\nprint(1)\n```")).toBe("code");
      expect(blockKind("```")).toBe("code");
    });
  });

  describe("enterAt", () => {
    it("splits paragraph at caret into before and after", () => {
      const res = enterAt("Halo Dunia", 4);
      expect(res).toEqual({
        before: "Halo",
        after: " Dunia",
        caret: 0,
      });
    });

    it("splits heading at caret without carrying heading marker to after", () => {
      const resAtEnd = enterAt("# Judul Besar", 13);
      expect(resAtEnd).toEqual({
        before: "# Judul Besar",
        after: "",
        caret: 0,
      });

      const resInMiddle = enterAt("## Judul Dua", 8);
      expect(resInMiddle).toEqual({
        before: "## Judul",
        after: " Dua",
        caret: 0,
      });
    });

    it("splits quote at caret", () => {
      const res = enterAt("> Kutipan", 9);
      expect(res).toEqual({
        before: "> Kutipan",
        after: "",
        caret: 0,
      });
    });

    it("adds next bullet marker on non-empty bullet line", () => {
      const text = "- Item pertama";
      const res = enterAt(text, text.length);
      expect(res).toEqual({
        before: "- Item pertama\n- ",
        after: null,
        caret: "- Item pertama\n- ".length,
      });
    });

    it("clears empty bullet line and creates empty block after it", () => {
      const text = "- Item pertama\n- ";
      const res = enterAt(text, text.length);
      expect(res).toEqual({
        before: "- Item pertama",
        after: "",
        caret: 0,
      });
    });

    it("increments numbered list marker on enter", () => {
      const text = "2. Langkah dua";
      const res = enterAt(text, text.length);
      expect(res).toEqual({
        before: "2. Langkah dua\n3. ",
        after: null,
        caret: "2. Langkah dua\n3. ".length,
      });
    });

    it("clears empty numbered list line and creates empty block after it", () => {
      const text = "1. Langkah satu\n2. ";
      const res = enterAt(text, text.length);
      expect(res).toEqual({
        before: "1. Langkah satu",
        after: "",
        caret: 0,
      });
    });

    it("adds unchecked todo marker on enter, even when current item is checked", () => {
      const text = "- [x] Tugas selesai";
      const res = enterAt(text, text.length);
      expect(res).toEqual({
        before: "- [x] Tugas selesai\n- [ ] ",
        after: null,
        caret: "- [x] Tugas selesai\n- [ ] ".length,
      });
    });

    it("clears empty todo line and creates empty block after it", () => {
      const text = "- [ ] Selesai\n- [ ] ";
      const res = enterAt(text, text.length);
      expect(res).toEqual({
        before: "- [ ] Selesai",
        after: "",
        caret: 0,
      });
    });

    it("inserts newline inside code block without splitting", () => {
      const text = "```\nconst x = 1;\n```";
      const caret = 16; // right after "1;"
      const res = enterAt(text, caret);
      expect(res).toEqual({
        before: "```\nconst x = 1;\n\n```",
        after: null,
        caret: 17,
      });
    });
  });

  describe("setKind", () => {
    const kinds: readonly BlockKind[] = [
      "paragraph",
      "heading1",
      "heading2",
      "heading3",
      "bullet",
      "numbered",
      "todo",
      "quote",
      "code",
    ];

    it("converts from paragraph to every other kind", () => {
      const base = "Konten blok";
      expect(setKind(base, "paragraph")).toBe("Konten blok");
      expect(setKind(base, "heading1")).toBe("# Konten blok");
      expect(setKind(base, "heading2")).toBe("## Konten blok");
      expect(setKind(base, "heading3")).toBe("### Konten blok");
      expect(setKind(base, "bullet")).toBe("- Konten blok");
      expect(setKind(base, "numbered")).toBe("1. Konten blok");
      expect(setKind(base, "todo")).toBe("- [ ] Konten blok");
      expect(setKind(base, "quote")).toBe("> Konten blok");
      expect(setKind(base, "code")).toBe("```\nKonten blok\n```");
    });

    it("converts between every pair of kinds preserving content", () => {
      for (const fromKind of kinds) {
        const initial = setKind("Uji konversi", fromKind);
        for (const toKind of kinds) {
          const converted = setKind(initial, toKind);
          expect(blockKind(converted)).toBe(toKind);
        }
      }
    });

    it("sets proper prefix on empty string or slash menu trigger", () => {
      expect(setKind("", "heading1")).toBe("# ");
      expect(setKind("", "heading2")).toBe("## ");
      expect(setKind("", "heading3")).toBe("### ");
      expect(setKind("", "bullet")).toBe("- ");
      expect(setKind("", "numbered")).toBe("1. ");
      expect(setKind("", "todo")).toBe("- [ ] ");
      expect(setKind("", "quote")).toBe("> ");
      expect(setKind("", "paragraph")).toBe("");
      expect(setKind("", "code")).toBe("```\n\n```");

      expect(setKind("/", "heading1")).toBe("# ");
      expect(setKind("/h1", "heading1")).toBe("# ");
    });
  });

  describe("toggleTodo", () => {
    it("toggles unchecked to checked and checked to unchecked", () => {
      const text = "- [ ] Belanja susu\n- [x] Cuci piring";
      const toggled0 = toggleTodo(text, 0);
      expect(toggled0).toBe("- [x] Belanja susu\n- [x] Cuci piring");

      const toggled1 = toggleTodo(toggled0, 1);
      expect(toggled1).toBe("- [x] Belanja susu\n- [ ] Cuci piring");
    });

    it("toggles uppercase [X] to [ ]", () => {
      const text = "- [X] Tugas lama";
      expect(toggleTodo(text, 0)).toBe("- [ ] Tugas lama");
    });

    it("ignores non-todo lines and out of bounds line numbers", () => {
      const text = "Paragraf biasa\n- Item daftar";
      expect(toggleTodo(text, 0)).toBe(text);
      expect(toggleTodo(text, 5)).toBe(text);
      expect(toggleTodo(text, -1)).toBe(text);
    });
  });

  describe("linkQuery", () => {
    it("returns null when no [[ exists before caret", () => {
      expect(linkQuery("Teks biasa tanpa tautan", 10)).toBeNull();
    });

    it("returns query text after open [[ before caret", () => {
      const text = "Baca dokumen [[Rencana untuk detail";
      expect(linkQuery(text, 22)).toBe("Rencana");
      expect(linkQuery("Mulai [[", 8)).toBe("");
    });

    it("returns null when [[ is already closed before caret", () => {
      const text = "Lihat [[Rencana]] sekarang";
      expect(linkQuery(text, 20)).toBeNull();
    });

    it("returns active query when previous links were closed but latest is open", () => {
      const text = "Lihat [[Doc A]] dan [[Doc B";
      expect(linkQuery(text, text.length)).toBe("Doc B");
    });

    it("returns null when link spans across newline", () => {
      const text = "Baris 1 [[\nBaris 2";
      expect(linkQuery(text, text.length)).toBeNull();
    });
  });

  describe("insertLink", () => {
    it("replaces open query with closed wikilink and puts caret after closing brackets", () => {
      const text = "Buka [[Ren dan baca";
      const caret = 10; // after "Ren"
      const res = insertLink(text, caret, "Rencana Proyek");
      expect(res).toEqual({
        text: "Buka [[Rencana Proyek]] dan baca",
        caret: "Buka [[Rencana Proyek]]".length,
      });
    });

    it("does not duplicate closing brackets if already present right after caret", () => {
      const text = "Buka [[Ren]] selesai";
      const caret = 10; // after "Ren" before "]]"
      const res = insertLink(text, caret, "Rencana Proyek");
      expect(res).toEqual({
        text: "Buka [[Rencana Proyek]] selesai",
        caret: "Buka [[Rencana Proyek]]".length,
      });
    });

    it("inserts link at caret when no open brackets precede", () => {
      const text = "Tautan: ";
      const caret = text.length;
      const res = insertLink(text, caret, "Halaman Baru");
      expect(res).toEqual({
        text: "Tautan: [[Halaman Baru]]",
        caret: "Tautan: [[Halaman Baru]]".length,
      });
    });
  });

  describe("createBlock", () => {
    it("creates blocks with incrementing ids from module counter", () => {
      const b1 = createBlock("Satu");
      const b2 = createBlock("Dua");
      expect(b1).toEqual({ id: 1, text: "Satu" });
      expect(b2).toEqual({ id: 2, text: "Dua" });
    });
  });

  describe("slashQuery and filterSlashOptions", () => {
    it("extracts query from text starting with slash on single line", () => {
      expect(slashQuery("/")).toBe("");
      expect(slashQuery("/jud")).toBe("jud");
      expect(slashQuery("/judul 1")).toBe("judul 1");
      expect(slashQuery("bukan/slash")).toBeNull();
      expect(slashQuery("/baris1\nbaris2")).toBeNull();
      expect(slashQuery("")).toBeNull();
    });

    it("filters slash options by query case-insensitively", () => {
      expect(filterSlashOptions("")).toHaveLength(9);
      const judul = filterSlashOptions("jud");
      expect(judul.map((o) => o.label)).toEqual(["Judul 1", "Judul 2", "Judul 3"]);
      const tugas = filterSlashOptions("tug");
      expect(tugas.map((o) => o.label)).toEqual(["Tugas"]);
      expect(filterSlashOptions("tidak-ada")).toEqual([]);
    });
  });

  describe("splitBlockAt", () => {
    it("splits paragraph into two blocks on enter", () => {
      const blocks = [createBlock("Halo Dunia")];
      const res = splitBlockAt(blocks, 0, 4); // "Halo" and " Dunia"
      expect(res.blocks).toHaveLength(2);
      expect(res.blocks[0].text).toBe("Halo");
      expect(res.blocks[1].text).toBe(" Dunia");
      expect(res.activeId).toBe(res.blocks[1].id);
      expect(res.caret).toBe(0);
    });

    it("continues list item in same block", () => {
      const blocks = [createBlock("- Item 1")];
      const res = splitBlockAt(blocks, 0, 8);
      expect(res.blocks).toHaveLength(1);
      expect(res.blocks[0].text).toBe("- Item 1\n- ");
      expect(res.activeId).toBe(blocks[0].id);
      expect(res.caret).toBe("- Item 1\n- ".length);
    });

    it("splits empty list item into empty block after it", () => {
      const blocks = [createBlock("- Item 1\n- ")];
      const res = splitBlockAt(blocks, 0, "- Item 1\n- ".length);
      expect(res.blocks).toHaveLength(2);
      expect(res.blocks[0].text).toBe("- Item 1");
      expect(res.blocks[1].text).toBe("");
      expect(res.activeId).toBe(res.blocks[1].id);
      expect(res.caret).toBe(0);
    });
  });

  describe("mergeBlockWithPrevious", () => {
    it("returns null when at index 0 or out of bounds", () => {
      const blocks = [createBlock("Blok 1")];
      expect(mergeBlockWithPrevious(blocks, 0)).toBeNull();
      expect(mergeBlockWithPrevious(blocks, 5)).toBeNull();
      expect(mergeBlockWithPrevious(blocks, -1)).toBeNull();
    });

    it("deletes empty block and moves caret to end of previous block", () => {
      const blocks = [createBlock("Paragraf pertama"), createBlock("")];
      const res = mergeBlockWithPrevious(blocks, 1);
      expect(res).not.toBeNull();
      expect(res?.blocks).toHaveLength(1);
      expect(res?.blocks[0].text).toBe("Paragraf pertama");
      expect(res?.activeId).toBe(blocks[0].id);
      expect(res?.caret).toBe("Paragraf pertama".length);
    });

    it("merges non-empty block into previous block at join point", () => {
      const blocks = [createBlock("Halo "), createBlock("Dunia")];
      const res = mergeBlockWithPrevious(blocks, 1);
      expect(res).not.toBeNull();
      expect(res?.blocks).toHaveLength(1);
      expect(res?.blocks[0].text).toBe("Halo Dunia");
      expect(res?.activeId).toBe(blocks[0].id);
      expect(res?.caret).toBe("Halo ".length);
    });
  });
});

