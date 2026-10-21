import { describe, expect, it } from "bun:test";
import {
  formatKind,
  normalizeSection,
  sectionStatus,
  SETTINGS_SECTIONS,
  THIRD_PARTY_LICENSES,
} from "./view";

describe("settings sections metadata", () => {
  it("defines the exact six sections in expected order", () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(ids).toEqual(["ai", "avatar", "suara", "data", "integrations", "about"]);

    const labels = SETTINGS_SECTIONS.map((s) => s.label);
    expect(labels).toEqual([
      "Assistant & AI",
      "Live2D Avatar",
      "Voice",
      "Sync & data",
      "Integrations",
      "About",
    ]);
  });

  it("provides valid SVG path icons for every section", () => {
    for (const section of SETTINGS_SECTIONS) {
      expect(section.icon.length).toBeGreaterThan(10);
    }
  });
});

describe("sectionStatus", () => {
  it("returns 'Ollama · <model>' or 'Ollama offline' for ai", () => {
    expect(sectionStatus("ai")).toBe("Ollama offline");
    expect(
      sectionStatus("ai", {
        aiStatus: { available: false, models: [], error: "Connection refused" },
      }),
    ).toBe("Ollama offline");
    expect(
      sectionStatus("ai", {
        aiStatus: { available: true, models: ["llama3.1:8b"], error: null },
      }),
    ).toBe("Ollama · llama3.1:8b");
    expect(
      sectionStatus("ai", {
        aiStatus: { available: true, models: ["llama3.1:8b"], error: null },
        aiChatModel: "qwen2.5:3b",
      }),
    ).toBe("Ollama · qwen2.5:3b");
  });
  it("labels custom chat availability and selected model without Ollama", () => {
    expect(sectionStatus("ai", { aiStatus: { provider: "custom", name: "9router", available: false, models: [], error: "offline" } })).toBe("9router unavailable");
    expect(sectionStatus("ai", { aiStatus: { provider: "custom", name: "9router", available: true, models: ["remote"], error: null }, aiChatModel: "manual" })).toBe("9router · manual");
  });

  it("returns 'Static' for avatar and 'Not installed' / active voice for suara", () => {
    expect(sectionStatus("avatar")).toBe("Static");
    expect(sectionStatus("avatar", { avatarStatus: "Live2D" })).toBe("Live2D");
    expect(sectionStatus("suara")).toBe("Not installed");
    expect(sectionStatus("suara", { voiceStatus: null })).toBe("Not installed");

    const installedVoiceStatus = {
      pwRecord: true,
      pwPlay: true,
      whisper: "/usr/bin/whisper-cli",
      whisperModel: true,
      piper: true,
      voices: [
        {
          id: "id_ID-news_tts-medium",
          label: "Indonesia · News",
          language: "id_ID",
          quality: "medium",
          installed: true,
          imported: false,
          params: { lengthScale: 1.0, noiseScale: 0.667, noiseW: 0.8 },
        },
      ],
      settings: {
        id: "id_ID-news_tts-medium",
        params: { lengthScale: 1.0, noiseScale: 0.667, noiseW: 0.8 },
      },
      recording: false,
      speaking: false,
    };
    expect(sectionStatus("suara", { voiceStatus: installedVoiceStatus })).toBe("Indonesia · News");

    const missingModelVoiceStatus = {
      ...installedVoiceStatus,
      whisperModel: false,
    };
    expect(sectionStatus("suara", { voiceStatus: missingModelVoiceStatus })).toBe("Not installed");
    expect(sectionStatus("suara", { voiceStatus: { ...installedVoiceStatus, pwPlay: false } })).toBe("Not installed");
  });

  it("returns 'Local' for data when sync is not connected", () => {
    expect(sectionStatus("data")).toBe("Local");
    expect(sectionStatus("data", { syncStatus: null })).toBe("Local");
    expect(
      sectionStatus("data", {
        syncStatus: {
          configured: true,
          signedIn: false,
          email: null,
          lastSyncAt: null,
          lastError: null,
          bytesUsed: 0,
          quotaBytes: 400 * 1024 * 1024,
          needsUnlockKey: false,
          vaultExists: null,
        },
      }),
    ).toBe("Local");
  });

  it("reflects connected or locked sync state for data", () => {
    expect(
      sectionStatus("data", {
        syncStatus: {
          configured: true,
          signedIn: true,
          email: "user@test.org",
          lastSyncAt: null,
          lastError: null,
          bytesUsed: 100,
          quotaBytes: 400 * 1024 * 1024,
          needsUnlockKey: false,
          vaultExists: true,
        },
      }),
    ).toBe("Connected");
    expect(
      sectionStatus("data", {
        syncStatus: {
          configured: true,
          signedIn: true,
          email: "user@test.org",
          lastSyncAt: null,
          lastError: null,
          bytesUsed: 0,
          quotaBytes: 400 * 1024 * 1024,
          needsUnlockKey: true,
          vaultExists: true,
        },
      }),
    ).toBe("Key required");
  });

  it("reflects GitHub connection state for integrasi", () => {
    expect(sectionStatus("integrations", { githubConnected: true })).toBe("Connected");
    expect(sectionStatus("integrations", { githubConnected: false })).toBe("Not connected");
    expect(sectionStatus("integrations", {})).toBe("Not connected");
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

describe("formatKind", () => {
  it("maps known kind keys to English labels", () => {
    expect(formatKind("task")).toBe("Task");
    expect(formatKind("note")).toBe("Note");
    expect(formatKind("page")).toBe("Page");
    expect(formatKind("entry")).toBe("Journal");
    expect(formatKind("transaction")).toBe("Transaction");
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
