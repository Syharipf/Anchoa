import { describe, expect, it } from "bun:test";
import {
  JOURNAL_TEMPLATES,
  KIND_META,
  MOODS,
  PROMPTS,
  moodBars,
  nextPrompt,
  parseTag,
  tagsToText,
} from "./view";

describe("journal view rules", () => {
  it("provides KIND_META with Indonesian labels and SVG icon paths", () => {
    expect(KIND_META.idea.label).toBe("Ide");
    expect(KIND_META.vent.label).toBe("Curhat");
    expect(KIND_META.note.label).toBe("Catatan");

    expect(KIND_META.idea.icon).toContain("M9 18h6");
    expect(KIND_META.vent.icon).toContain("M4 5h16");
    expect(KIND_META.note.icon).toContain("M6 3h9");
  });

  it("provides MOODS in order from 1 (Berat) to 5 (Senang)", () => {
    expect(MOODS).toHaveLength(5);
    expect(MOODS[0]).toBe("Berat");
    expect(MOODS[1]).toBe("Kurang");
    expect(MOODS[2]).toBe("Biasa");
    expect(MOODS[3]).toBe("Baik");
    expect(MOODS[4]).toBe("Senang");
  });

  it("calculates moodBars correctly", () => {
    const emptyBars = moodBars(null);
    expect(emptyBars).toHaveLength(5);
    expect(emptyBars.every((b) => !b.active)).toBe(true);
    expect(emptyBars.every((b) => b.c === "#2E3440")).toBe(true);

    const level3 = moodBars(3);
    expect(level3).toHaveLength(5);
    expect(level3[0].active).toBe(true);
    expect(level3[0].c).toBe("#C6F36B");
    expect(level3[1].active).toBe(true);
    expect(level3[2].active).toBe(true);
    expect(level3[3].active).toBe(false);
    expect(level3[3].c).toBe("#2E3440");
    expect(level3[4].active).toBe(false);

    expect(level3[0].h).toBeCloseTo(3.6);
    expect(level3[4].h).toBeCloseTo(10.0);
  });

  it("provides 8 reflective prompts and cycles through them with nextPrompt", () => {
    expect(PROMPTS).toHaveLength(8);
    expect(PROMPTS[0]).toBe("Apa satu hal kecil yang berjalan baik hari ini?");
    expect(PROMPTS[1]).toBe(
      "Apa yang paling menguras energimu minggu ini, dan apa yang bisa dikurangi?",
    );
    expect(PROMPTS[2]).toBe("Ide apa yang terus muncul tapi belum sempat dicoba?");

    expect(nextPrompt(0)).toBe(1);
    expect(nextPrompt(6)).toBe(7);
    expect(nextPrompt(7)).toBe(0);
  });

  it("parses and validates tags", () => {
    expect(parseTag("anchoa")).toBe("anchoa");
    expect(parseTag("#Anchoa")).toBe("anchoa");
    expect(parseTag("  #Kuliah-2026  ")).toBe("kuliah-2026");

    expect(parseTag("")).toBeNull();
    expect(parseTag("   ")).toBeNull();
    expect(parseTag("#")).toBeNull();
    expect(parseTag("tag dengan spasi")).toBeNull();
    expect(parseTag("a b!")).toBeNull();
    expect(parseTag("invalid_char")).toBeNull();
    expect(parseTag("#halo@dunia")).toBeNull();
  });

  it("joins tags to space-separated text for backend patch", () => {
    expect(tagsToText([])).toBe("");
    expect(tagsToText(["anchoa", "kuliah"])).toBe("anchoa kuliah");
    expect(tagsToText(["anchoa", "", "kuliah"])).toBe("anchoa kuliah");
  });

  it("provides 4 built-in journal templates with required properties", () => {
    expect(JOURNAL_TEMPLATES).toHaveLength(4);

    const ids = JOURNAL_TEMPLATES.map((t) => t.id);
    expect(ids).toEqual(["daily-reflection", "gratitude", "weekly-review", "guided-vent"]);

    for (const t of JOURNAL_TEMPLATES) {
      expect(t.id).toBeDefined();
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(["note", "vent", "idea"]).toContain(t.kind);
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(0);
    }

    const daily = JOURNAL_TEMPLATES.find((t) => t.id === "daily-reflection");
    expect(daily?.label).toBe("Refleksi harian");
    expect(daily?.kind).toBe("note");
    expect(daily?.body).toContain("Apa yang berjalan baik hari ini?");

    const vent = JOURNAL_TEMPLATES.find((t) => t.id === "guided-vent");
    expect(vent?.label).toBe("Curhat terarah");
    expect(vent?.kind).toBe("vent");
    expect(vent?.body).toContain("Apa yang sedang kurasakan?");
  });
});
