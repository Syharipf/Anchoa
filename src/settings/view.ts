import type { AiStatus, VoiceStatus } from "../api";

// Settings navigation definitions, section status calculation, and static metadata.

export type SettingsSection =
  | "ai"
  | "avatar"
  | "suara"
  | "data"
  | "integrations"
  | "about";

export interface SectionItem {
  readonly id: SettingsSection;
  readonly label: string;
  readonly icon: string;
}

export const SETTINGS_SECTIONS: readonly SectionItem[] = [
  {
    id: "ai",
    label: "Asisten & AI",
    icon: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
  },
  {
    id: "avatar",
    label: "Avatar Live2D",
    icon: "M12 3a4 4 0 1 0 0 8a4 4 0 1 0 0-8zM4 21a8 8 0 0 1 16 0",
  },
  {
    id: "suara",
    label: "Suara",
    icon: "M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0zM5 11a7 7 0 0 0 14 0M12 18v3",
  },
  {
    id: "data",
    label: "Sinkron & data",
    icon: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  },
  {
    id: "integrations",
    label: "Integrasi",
    icon: "M4 5h16v11H4zM2 19h20",
  },
  {
    id: "about",
    label: "Tentang",
    icon: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 11v6M12 7.5h.01",
  },
] as const;

export interface StatusContext {
  readonly githubConnected?: boolean;
  readonly version?: string;
  readonly aiStatus?: AiStatus | null;
  readonly aiChatModel?: string;
  readonly voiceStatus?: VoiceStatus | null;
  readonly avatarStatus?: string;
}

/** Check if all essential voice components are installed on the device. */
export function isVoiceInstalled(status: VoiceStatus | null | undefined): boolean {
  if (!status) return false;
  const activeVoiceInstalled = status.voices.some(
    (v) => v.id === status.settings.id && v.installed,
  );
  return Boolean(
    status.pwRecord &&
    status.whisper &&
    status.whisperModel &&
    status.piper &&
    activeVoiceInstalled,
  );
}

/** Computes the small status line below each section's title. */
export function sectionStatus(
  id: SettingsSection,
  context?: StatusContext,
): string {
  switch (id) {
    case "ai": {
      if (!context?.aiStatus || !context.aiStatus.available) {
        return "Ollama mati";
      }
      const model =
        context.aiChatModel ?? context.aiStatus.models[0] ?? "qwen2.5:3b";
      return `Ollama · ${model}`;
    }
    case "avatar":
      return context?.avatarStatus ?? "Statis";
    case "suara": {
      if (!context?.voiceStatus || !isVoiceInstalled(context.voiceStatus)) {
        return "Belum dipasang";
      }
      const active = context.voiceStatus.voices.find(
        (v) => v.id === context.voiceStatus!.settings.id,
      );
      return active?.label ?? "Di perangkat";
    }
    case "data":
      return "Lokal";
    case "integrations":
      return context?.githubConnected ? "Terhubung" : "Belum terhubung";
    case "about": {
      const v = context?.version?.trim();
      if (!v) return "…";
      return v.startsWith("v") ? v : `v${v}`;
    }
  }
}

/** Maps a string (or URL query / intent) to a valid SettingsSection. */
export function normalizeSection(section?: string | null): SettingsSection {
  if (!section) return "data";
  switch (section.toLowerCase()) {
    case "ai":
    case "asisten":
      return "ai";
    case "avatar":
      return "avatar";
    case "suara":
    case "voice":
      return "suara";
    case "data":
    case "sinkron":
      return "data";
    case "integrations":
    case "integrasi":
    case "github":
      return "integrations";
    case "about":
    case "tentang":
      return "about";
    default:
      return "data";
  }
}

/** Sensible default settings section when opened from a placeholder page. */
export function sensibleSection(pageId: string): SettingsSection | undefined {
  if (pageId === "email") return "ai";
  if (pageId === "profil") return "data";
  return undefined;
}

export interface ThirdPartyLicense {
  readonly name: string;
  readonly license: string;
  readonly url: string;
}

export const THIRD_PARTY_LICENSES: readonly ThirdPartyLicense[] = [
  { name: "Tauri", license: "MIT / Apache-2.0", url: "https://tauri.app/" },
  { name: "React", license: "MIT", url: "https://react.dev/" },
  { name: "SQLite", license: "Public Domain", url: "https://www.sqlite.org/copyright.html" },
  { name: "rusqlite", license: "MIT", url: "https://github.com/rusqlite/rusqlite" },
  { name: "jiff", license: "MIT / Unlicense", url: "https://github.com/BurntSushi/jiff" },
  { name: "ureq", license: "MIT / Apache-2.0", url: "https://github.com/algesten/ureq" },
  { name: "yt-dlp", license: "Unlicense", url: "https://github.com/yt-dlp/yt-dlp" },
  { name: "FFmpeg", license: "LGPL-2.1+", url: "https://ffmpeg.org/legal.html" },
  { name: "IBM Plex", license: "OFL-1.1", url: "https://github.com/IBM/plex" },
  { name: "Space Grotesk", license: "OFL-1.1", url: "https://github.com/floriankarsten/space-grotesk" },
  { name: "JetBrains Mono", license: "OFL-1.1", url: "https://www.jetbrains.com/lp/mono/" },
] as const;

export const ITEM_KIND_LABELS: Record<string, string> = {
  task: "Tugas",
  note: "Catatan",
  page: "Halaman",
  entry: "Jurnal",
  transaction: "Transaksi",
  account: "Akun",
  bill: "Tagihan",
  project: "Proyek",
  habit: "Habit",
  download: "Unduhan",
};

export function formatKind(kind: string): string {
  return ITEM_KIND_LABELS[kind] ?? (kind.charAt(0).toUpperCase() + kind.slice(1));
}
