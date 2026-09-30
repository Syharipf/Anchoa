// Display rules and helpers for the Jurnal page (spec Fase 4 §5).
import type { EntryKind } from "../api";

export interface KindMeta {
  readonly label: string;
  readonly icon: string;
}

export const KIND_META: Record<EntryKind, KindMeta> = {
  idea: {
    label: "Ide",
    icon: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  },
  vent: {
    label: "Curhat",
    icon: "M4 5h16v11H9l-5 4z",
  },
  note: {
    label: "Catatan",
    icon: "M6 3h9l3 3v15H6zM9 11h6M9 15h6",
  },
};

export const MOODS = ["Berat", "Kurang", "Biasa", "Baik", "Senang"] as const;

export interface MoodBar {
  readonly h: number;
  readonly c: string;
  readonly active: boolean;
}

/** 5-bar indicator for list items: height scales with level, filled up to mood. */
export function moodBars(mood: number | null | undefined): MoodBar[] {
  const m = mood ?? 0;
  return [1, 2, 3, 4, 5].map((i) => ({
    h: 2 + i * 1.6,
    c: i <= m ? "#C6F36B" : "#2E3440",
    active: i <= m,
  }));
}

export const PROMPTS = [
  "Apa satu hal kecil yang berjalan baik hari ini?",
  "Apa yang paling menguras energimu minggu ini, dan apa yang bisa dikurangi?",
  "Ide apa yang terus muncul tapi belum sempat dicoba?",
  "Siapa atau apa yang membuatmu bersyukur hari ini?",
  "Apa tantangan yang sedang kamu hadapi dan bagaimana caramu melewatinya?",
  "Kalau hari ini bisa diulang, apa yang ingin kamu lakukan secara berbeda?",
  "Hal menarik apa yang kamu pelajari atau temukan baru-baru ini?",
  "Apa yang sedang kamu nantikan atau ingin kamu capai besok?",
] as const;

/** Cycles to the next prompt index. */
export function nextPrompt(currentIndex: number, total: number = PROMPTS.length): number {
  if (total <= 0) {
    return 0;
  }
  return ((currentIndex + 1) % total + total) % total;
}

const TAG_REGEX = /^[a-zA-Z0-9-]+$/;

/**
 * Parses and validates an input tag: strips leading '#', trims, validates
 * [a-zA-Z0-9-], and returns lowercased tag string or null if invalid.
 */
export function parseTag(text: string): string | null {
  const trimmed = text.trim();
  const withoutHash = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (!withoutHash || !TAG_REGEX.test(withoutHash)) {
    return null;
  }
  return withoutHash.toLowerCase();
}

/** Joins array of tags to a single space-separated string for the backend patch. */
export function tagsToText(tags: readonly string[]): string {
  return tags
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .join(" ");
}
