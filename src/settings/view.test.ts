import { describe, expect, it } from "bun:test";
import {
  formatKind,
  normalizeSection,
  sectionStatus,
  sensibleSection,
  SETTINGS_SECTIONS,
  THIRD_PARTY_LICENSES,
} from "./view";

describe("settings sections metadata", () => {
  it("defines the exact six sections in expected order", () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(ids).toEqual(["ai", "avatar", "suara", "data", "integrations", "about"]);

    const labels = SETTINGS_SECTIONS.map((s) => s.label);
    expect(labels).toEqual([
      "Asisten & AI",
      "Avatar Live2D",
      "Suara",
      "Sinkron & data",
      "Integrasi",
      "Tentang",
    ]);
  });

  it("provides valid SVG path icons for every section", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(section.icon.length).toBeGreaterThan(10);
    }
  });
});

describe("sectionStatus", () => {
  it("returns 'Menyusul' for ai, avatar, and suara", () => {
    expect(sectionStatus("ai")).toBe("Menyusul");
    expect(sectionStatus("avatar")).toBe("Menyusul");
    expect(sectionStatus("suara")).toBe("Menyusul");
  });

  it("returns 'Lokal' for data", () => {
    expect(sectionStatus("data")).toBe("Lokal");
  });

  it("reflects GitHub connection state for integrasi", () => {
    expect(sectionStatus("integrations", { githubConnected: true })).toBe("Terhubung");
    expect(sectionStatus("integrations", { githubConnected: false })).toBe("Belum terhubung");
    expect(sectionStatus("integrations", {})).toBe("Belum terhubung");
  });

  it("formats version with 'v' prefix for tentang", () => {
    expect(sectionStatus("about", { version: "0.10.0" })).toBe("v0.10.0");
    expect(sectionStatus("about", { version: "v0.11.0" })).toBe("v0.11.0");
  });

  it("shows a placeholder until a real version is available", () => {
    expect(sectionStatus("about", { version: "" })).toBe("…");
    expect(sectionStatus("about", { version: "  " })).toBe("…");
    expect(sectionStatus("about", {})).toBe("…");
    expect(sectionStatus("about")).toBe("…");
  });
});

describe("normalizeSection", () => {
  it("normalizes known section IDs and aliases", () => {
    expect(normalizeSection("ai")).toBe("ai");
    expect(normalizeSection("asisten")).toBe("ai");
    expect(normalizeSection("avatar")).toBe("avatar");
    expect(normalizeSection("suara")).toBe("suara");
    expect(normalizeSection("voice")).toBe("suara");
    expect(normalizeSection("data")).toBe("data");
    expect(normalizeSection("sinkron")).toBe("data");
    expect(normalizeSection("integrations")).toBe("integrations");
    expect(normalizeSection("integrasi")).toBe("integrations");
    expect(normalizeSection("github")).toBe("integrations");
    expect(normalizeSection("about")).toBe("about");
    expect(normalizeSection("tentang")).toBe("about");
  });

  it("falls back to 'data' for unknown or empty input", () => {
    expect(normalizeSection(null)).toBe("data");
    expect(normalizeSection(undefined)).toBe("data");
    expect(normalizeSection("unknown")).toBe("data");
  });
});

describe("sensibleSection", () => {
  it("maps placeholder pages to sensible settings sections", () => {
    expect(sensibleSection("email")).toBe("ai");
    expect(sensibleSection("profil")).toBe("data");
    expect(sensibleSection("other")).toBeUndefined();
  });
});

describe("formatKind", () => {
  it("maps known kind keys to Indonesian labels", () => {
    expect(formatKind("task")).toBe("Tugas");
    expect(formatKind("note")).toBe("Catatan");
    expect(formatKind("page")).toBe("Halaman");
    expect(formatKind("entry")).toBe("Jurnal");
    expect(formatKind("transaction")).toBe("Transaksi");
    expect(formatKind("custom")).toBe("Custom");
  });
});

describe("third-party licenses", () => {
  it("contains all required licenses from the spec", () => {
    const names = THIRD_PARTY_LICENSES.map((l) => l.name);
    expect(names).toContain("Tauri");
    expect(names).toContain("React");
    expect(names).toContain("SQLite");
    expect(names).toContain("rusqlite");
    expect(names).toContain("jiff");
    expect(names).toContain("ureq");
    expect(names).toContain("yt-dlp");
    expect(names).toContain("FFmpeg");
    expect(names).toContain("IBM Plex");
    expect(names).toContain("Space Grotesk");
    expect(names).toContain("JetBrains Mono");
  });
});
