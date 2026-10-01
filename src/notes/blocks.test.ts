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

  describe("review fixes", () => {
    it("keeps a four-backtick fence whole when it contains three backticks", () => {
      const body = "````\n```\n\ncode\n````\n\nafter";
      const blocks = splitBlocks(body);
      expect(blocks.map((b) => b.text)).toEqual(["````\n```\n\ncode\n````", "after"]);
      expect(joinBlocks(blocks)).toBe(body);
    });

    it("toggles only the checkbox, not brackets inside the task", () => {
      expect(toggleTodo("- [x] explain [ ] syntax", 0)).toBe("- [ ] explain [ ] syntax");
      expect(toggleTodo("- [ ] explain [x] syntax", 0)).toBe("- [x] explain [x] syntax");
      expect(toggleTodo("plain [ ] text", 0)).toBe("plain [ ] text");
    });
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
    it.each([
      ["Teks biasa", "paragraph"],
      ["", "paragraph"],
      ["Baris pertama\nBaris kedua", "paragraph"],
      ["#tagbukanjudul", "paragraph"],
      ["# Judul 1", "heading1"],
      ["# ", "heading1"],
      ["## Judul 2", "heading2"],
      ["### Judul 3", "heading3"],
      ["- Poin A", "bullet"],
      ["* Poin B", "bullet"],
      ["+ Poin C", "bullet"],
      ["- ", "bullet"],
      ["1. Langkah satu", "numbered"],
      ["2. Langkah dua", "numbered"],
      ["10. Langkah sepuluh", "numbered"],
      ["1. ", "numbered"],
      ["- [ ] Belum selesai", "todo"],
      ["- [x] Sudah selesai", "todo"],
      ["- [X] Selesai kapital", "todo"],
      ["* [ ] Bintang todo", "todo"],
      ["[ ] Tanpa dash", "todo"],
      ["- [ ] ", "todo"],
      ["> Kutipan penting", "quote"],
      ["> ", "quote"],
      ["```\ncode\n```", "code"],
      ["```python\nprint(1)\n```", "code"],
      ["```", "code"],
    ])("detects kind for '%s'", (input, expected) => {
      expect(blockKind(input)).toBe(expected as BlockKind);
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

    it.each([
      ["bullet", "- Item pertama", "- Item pertama\n- "],
      ["numbered", "2. Langkah dua", "2. Langkah dua\n3. "],
      ["todo", "- [x] Tugas selesai", "- [x] Tugas selesai\n- [ ] "],
    ])("adds next marker on non-empty %s line", (_kind, input, expectedBefore) => {
      const res = enterAt(input, input.length);
      expect(res).toEqual({
        before: expectedBefore,
        after: null,
        caret: expectedBefore.length,
      });
    });

    it.each([
      ["bullet", "- Item pertama\n- ", "- Item pertama"],
      ["numbered", "1. Langkah satu\n2. ", "1. Langkah satu"],
      ["todo", "- [ ] Selesai\n- [ ] ", "- [ ] Selesai"],
    ])("clears empty %s line and creates empty block after it", (_kind, input, expectedBefore) => {
      const res = enterAt(input, input.length);
      expect(res).toEqual({
        before: expectedBefore,
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

    it.each([
      ["paragraph", "Konten blok"],
      ["heading1", "# Konten blok"],
      ["heading2", "## Konten blok"],
      ["heading3", "### Konten blok"],
      ["bullet", "- Konten blok"],
      ["numbered", "1. Konten blok"],
      ["todo", "- [ ] Konten blok"],
      ["quote", "> Konten blok"],
      ["code", "```\nKonten blok\n```"],
    ])("converts paragraph to %s", (targetKind, expected) => {
      expect(setKind("Konten blok", targetKind as BlockKind)).toBe(expected);
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

    it.each([
      ["heading1", "# "],
      ["heading2", "## "],
      ["heading3", "### "],
      ["bullet", "- "],
      ["numbered", "1. "],
      ["todo", "- [ ] "],
      ["quote", "> "],
      ["paragraph", ""],
      ["code", "```\n\n```"],
    ])("sets proper prefix on empty string for %s", (targetKind, expected) => {
      expect(setKind("", targetKind as BlockKind)).toBe(expected);
    });

    it.each([
      ["/", "heading1", "# "],
      ["/h1", "heading1", "# "],
    ])("sets proper prefix on slash menu trigger '%s' for %s", (trigger, targetKind, expected) => {
      expect(setKind(trigger, targetKind as BlockKind)).toBe(expected);
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

    it.each([
      ["Paragraf biasa\n- Item daftar", 0],
      ["Paragraf biasa\n- Item daftar", 5],
      ["Paragraf biasa\n- Item daftar", -1],
    ])("ignores non-todo lines or out of bounds line numbers (%s, line %i)", (text, line) => {
      expect(toggleTodo(text, line)).toBe(text);
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
    it.each([
      ["/", ""],
      ["/jud", "jud"],
      ["/judul 1", "judul 1"],
      ["bukan/slash", null],
      ["/baris1\nbaris2", null],
      ["", null],
    ])("extracts slashQuery for '%s'", (input, expected) => {
      expect(slashQuery(input)).toBe(expected);
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
    it.each([0, 5, -1])("returns null when index is out of merge range (%i)", (index) => {
      const blocks = [createBlock("Blok 1")];
      expect(mergeBlockWithPrevious(blocks, index)).toBeNull();
    });

    it.each([
      [
        "deletes empty block and moves caret to end of previous block",
        "Paragraf pertama",
        "",
        "Paragraf pertama",
        "Paragraf pertama".length,
      ],
      [
        "merges non-empty block into previous block at join point",
        "Halo ",
        "Dunia",
        "Halo Dunia",
        "Halo ".length,
      ],
    ])("%s", (_title, first, second, expectedText, expectedCaret) => {
      const blocks = [createBlock(first), createBlock(second)];
      const res = mergeBlockWithPrevious(blocks, 1);
      expect(res).not.toBeNull();
      expect(res?.blocks).toHaveLength(1);
      expect(res?.blocks[0].text).toBe(expectedText);
      expect(res?.activeId).toBe(blocks[0].id);
      expect(res?.caret).toBe(expectedCaret);
    });
  });
});
