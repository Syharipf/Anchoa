import { describe, expect, it } from "bun:test";
import {
  formatDailyRecap,
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
  it("provides KIND_META with English labels and SVG icon paths", () => {
    expect(KIND_META.idea.label).toBe("Idea");
    expect(KIND_META.vent.label).toBe("Vent");
    expect(KIND_META.note.label).toBe("Note");

    expect(KIND_META.idea.icon).toContain("M9 18h6");
    expect(KIND_META.vent.icon).toContain("M4 5h16");
    expect(KIND_META.note.icon).toContain("M6 3h9");
  });

  it("provides MOODS in order from 1 (Heavy) to 5 (Great)", () => {
    expect(MOODS).toHaveLength(5);
    expect(MOODS[0]).toBe("Heavy");
    expect(MOODS[1]).toBe("Down");
    expect(MOODS[2]).toBe("Neutral");
    expect(MOODS[3]).toBe("Good");
    expect(MOODS[4]).toBe("Great");
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
    expect(PROMPTS[0]).toBe("What is one small thing that went well today?");
    expect(PROMPTS[1]).toBe(
      "What drained your energy most this week, and what can be reduced?",
    );
    expect(PROMPTS[2]).toBe("What idea keeps coming to mind that you haven't tried yet?");

    expect(nextPrompt(0)).toBe(1);
    expect(nextPrompt(6)).toBe(7);
    expect(nextPrompt(7)).toBe(0);
  });

  it("formats daily recap into structured markdown", () => {
    const text = formatDailyRecap({
      tasks: [
        { title: "Beli kopi", done: true },
        { title: "Kirim email", done: false },
      ],
      habits: [{ name: "Olahraga", doneToday: true }],
      income: 50000,
      expense: 20000,
    });
    expect(text).toContain("- [x] Beli kopi");
    expect(text).toContain("- [ ] Kirim email");
    expect(text).toContain("- [x] Olahraga");
    expect(text).toContain("Income: Rp 50.000");
    expect(text).toContain("Expenses: Rp 20.000");
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
    expect(daily?.label).toBe("Daily reflection");
    expect(daily?.kind).toBe("note");
    expect(daily?.body).toContain("What went well today?");

    const vent = JOURNAL_TEMPLATES.find((t) => t.id === "guided-vent");
    expect(vent?.label).toBe("Guided vent");
    expect(vent?.kind).toBe("vent");
    expect(vent?.body).toContain("What am I feeling right now?");
  });
});
