import { describe, expect, it } from "bun:test";
import { KIND_LABEL, UNITS, hasProgress, progressPercent, progressText, statusLabel } from "./view";

describe("library view helpers", () => {
  it("maps kind labels and units", () => {
    expect(KIND_LABEL.film).toBe("Film");
    expect(KIND_LABEL.series).toBe("Series");
    expect(KIND_LABEL.anime).toBe("Anime");
    expect(KIND_LABEL.book).toBe("Book");
    expect(KIND_LABEL.manga).toBe("Manga");

    expect(UNITS.film).toBe("");
    expect(UNITS.series).toBe("eps");
    expect(UNITS.anime).toBe("eps");
    expect(UNITS.book).toBe("pages");
    expect(UNITS.manga).toBe("chapters");
  });

  it("computes statusLabel according to kind and status", () => {
    expect(statusLabel("film", "active")).toBe("Watching");
    expect(statusLabel("series", "active")).toBe("Watching");
    expect(statusLabel("anime", "active")).toBe("Watching");
    expect(statusLabel("book", "active")).toBe("Reading");
    expect(statusLabel("manga", "active")).toBe("Reading");

    expect(statusLabel("film", "want")).toBe("Want");
    expect(statusLabel("book", "finished")).toBe("Finished");
    expect(statusLabel("series", "dropped")).toBe("Dropped");
  });

  it("checks progress existence", () => {
    expect(hasProgress({ kind: "film", progress: 1, progressTotal: 2 })).toBe(false);
    expect(hasProgress({ kind: "series", progress: null, progressTotal: 10 })).toBe(false);
    expect(hasProgress({ kind: "series", progress: 5, progressTotal: null })).toBe(false);
    expect(hasProgress({ kind: "series", progress: 6, progressTotal: 10 })).toBe(true);
  });

  it("computes progressPercent safely", () => {
    expect(progressPercent({ kind: "film", progress: 5, progressTotal: 10 })).toBe(0);
    expect(progressPercent({ kind: "series", progress: 6, progressTotal: 10 })).toBe(60);
    expect(progressPercent({ kind: "series", progress: 12, progressTotal: 10 })).toBe(100);
    expect(progressPercent({ kind: "series", progress: -2, progressTotal: 10 })).toBe(0);
  });

  it("formats progressText with page prefix and unit suffixes", () => {
    expect(progressText({ kind: "film", progress: null, progressTotal: null })).toBe("");
    expect(progressText({ kind: "series", progress: 6, progressTotal: 10 })).toBe("6 / 10 eps");
    expect(progressText({ kind: "book", progress: 120, progressTotal: 550 })).toBe("p. 120 / 550");
    expect(progressText({ kind: "manga", progress: 45, progressTotal: 100 })).toBe("45 / 100 chapters");
  });
});
