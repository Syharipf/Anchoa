import type { MediaKind, MediaRow, MediaStatus } from "../api";

export const KIND_LABEL: Record<MediaKind, string> = {
  film: "Film",
  series: "Series",
  anime: "Anime",
  book: "Book",
  manga: "Manga",
};

export const UNITS: Record<MediaKind, string> = {
  film: "",
  series: "eps",
  anime: "eps",
  book: "pages",
  manga: "chapters",
};

export function statusLabel(kind: MediaKind, status: MediaStatus): string {
  if (status === "active") {
    return kind === "book" || kind === "manga" ? "Reading" : "Watching";
  }
  switch (status) {
    case "want":
      return "Want";
    case "finished":
      return "Finished";
    case "dropped":
      return "Dropped";
  }
}

export function hasProgress(row: Pick<MediaRow, "kind" | "progress" | "progressTotal">): boolean {
  return row.kind !== "film" && row.progress !== null && row.progressTotal !== null;
}

export function progressPercent(row: Pick<MediaRow, "kind" | "progress" | "progressTotal">): number {
  if (!hasProgress(row) || !row.progressTotal || row.progressTotal <= 0) return 0;
  const pct = Math.round(((row.progress ?? 0) / row.progressTotal) * 100);
  return Math.min(100, Math.max(0, pct));
}

export function progressText(row: Pick<MediaRow, "kind" | "progress" | "progressTotal">): string {
  if (!hasProgress(row)) return "";
  const unit = UNITS[row.kind];
  if (unit === "pages") {
    return `p. ${row.progress} / ${row.progressTotal}`;
  }
  return unit ? `${row.progress} / ${row.progressTotal} ${unit}` : `${row.progress} / ${row.progressTotal}`;
}
