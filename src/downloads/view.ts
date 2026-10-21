// Display rules and helpers for the Unduhan page (spec Fase 7 §5, U4).
import type { DownloadStatus, DownloadView, MediaOptions } from "../api";
import { formatSize } from "../files/view";

export type DetectedKind = "none" | "media" | "file" | "torrent" | "invalid";

const MEDIA_HOSTS = [
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "soundcloud.com",
  "twitch.tv",
  "bandcamp.com",
  "dailymotion.com",
  "bilibili.com",
  "x.com",
  "twitter.com",
  "threads.net",
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "fb.watch",
  "fb.com",
  "reddit.com",
  "pinterest.com",
  "pin.it",
  "linkedin.com",
];

export function isPublicTelegramMedia(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host !== "t.me" && host !== "telegram.me") {
      return false;
    }
    const path = parsed.pathname;
    if (path.startsWith("/c/") || path.startsWith("/joinchat/") || path.startsWith("/+")) {
      return false;
    }
    return /^\/[a-zA-Z0-9_]{4,}\/\d+$/.test(path);
  } catch {
    return false;
  }
}

/**
 * Detects download category from URL based on spec U4 and the Unduhan artboard:
 * - magnet: or .torrent -> torrent
 * - video/audio hosts -> media
 * - http(s) URLs -> file
 * - empty -> none
 * - everything else -> invalid
 */
export function detect(url: string): DetectedKind {
  const s = url.trim();
  if (!s) {
    return "none";
  }
  const lower = s.toLowerCase();
  if (lower.startsWith("magnet:") || /\.torrent($|\?)/.test(lower)) {
    return "torrent";
  }
  if (isPublicTelegramMedia(s)) {
    return "media";
  }
  const host = /^https?:\/\//i.test(s) ? extractHost(s) : "";
  if (!host) {
    return "invalid";
  }
  return MEDIA_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ? "media" : "file";
}

export const DOWNLOAD_EXAMPLES = [
  { label: "Video", url: "https://www.youtube.com/watch?v=contoh-live2d" },
  { label: "Audio", url: "https://soundcloud.com/contoh/ngobrol-teknologi-42" },
  { label: "File", url: "https://archive.org/download/contoh/dataset-suara-id.zip" },
  { label: "Magnet", url: "magnet:?xt=urn:btih:contoh&dn=big-buck-bunny-1080p" },
] as const;

export const STATUS_LABELS: Readonly<Record<DownloadStatus, string>> = {
  queued: "Queued",
  running: "Downloading",
  paused: "Paused",
  processing: "Processing",
  done: "Done",
  failed: "Failed",
  interrupted: "Interrupted",
};

/** Tailwind text class for the status label. */
export const STATUS_TEXT: Readonly<Record<DownloadStatus, string>> = {
  queued: "text-muted",
  running: "text-accent",
  paused: "text-muted",
  processing: "text-ink",
  done: "text-ink",
  failed: "text-danger",
  interrupted: "text-amber-400",
};

/** Tailwind background class for the progress bar. */
export const STATUS_BAR: Readonly<Record<DownloadStatus, string>> = {
  queued: "bg-disabled",
  running: "bg-accent",
  paused: "bg-disabled",
  processing: "bg-heat-3",
  done: "bg-heat-2",
  failed: "bg-danger",
  interrupted: "bg-amber-400",
};

/** Formats byte rate using existing formatSize helper, e.g. "8,2 MB/s". */
export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0 || !Number.isFinite(bytesPerSec)) {
    return "0 B/s";
  }
  return `${formatSize(Math.round(bytesPerSec))}/s`;
}

/** Formats ETA in seconds to short text: "19s", "2m", "1h 30m". */
export function formatEta(seconds: number): string {
  if (seconds <= 0 || !Number.isFinite(seconds)) {
    return "0s";
  }
  const s = Math.round(seconds);
  if (s < 60) {
    return `${s}s`;
  }
  if (s < 3600) {
    return `${Math.round(s / 60)}m`;
  }
  const hours = Math.floor(s / 3600);
  const mins = Math.round((s % 3600) / 60);
  if (mins === 60) {
    return `${hours + 1}h`;
  }
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

/** Calculates download percentage (0 to 100). */
export function progressPercent(
  row: Pick<DownloadView, "doneBytes" | "totalBytes" | "status">,
): number {
  if (row.status === "queued" || row.status === "failed") {
    return 0;
  }
  if (row.status === "done") {
    return 100;
  }
  if (!row.totalBytes || row.totalBytes <= 0) {
    return 0;
  }
  const pct = Math.round((row.doneBytes / row.totalBytes) * 100);
  return Math.min(100, Math.max(0, pct));
}

/** Formats secondary progress text based on status and metadata. */
export function progressText(row: DownloadView): string {
  switch (row.status) {
    case "queued":
      return "Waiting in queue";
    case "running": {
      const pct = progressPercent(row);
      const parts: string[] = [];
      if (row.totalBytes && row.totalBytes > 0) {
        parts.push(`${pct}%`);
      } else if (row.doneBytes > 0) {
        parts.push(formatSize(row.doneBytes));
      } else {
        parts.push("0%");
      }
      if (row.speed !== null && row.speed !== undefined && row.speed > 0) {
        parts.push(formatSpeed(row.speed));
      }
      if (row.eta !== null && row.eta !== undefined) {
        parts.push(`${formatEta(row.eta)} left`);
      }
      return parts.join(" · ");
    }
    case "paused": {
      const pct = progressPercent(row);
      if (row.totalBytes && row.totalBytes > 0) {
        return `${pct}% · paused`;
      }
      if (row.doneBytes > 0) {
        return `${formatSize(row.doneBytes)} · paused`;
      }
      return "0% · paused";
    }
    case "processing": {
      if (row.options?.format) {
        return `Converting to ${row.options.format} (ffmpeg)…`;
      }
      return "Processing (ffmpeg)…";
    }
    case "done":
      return row.filePath ? `Saved to ${row.filePath}` : "Saved";
    case "failed":
      return row.error ?? "Failed";
    case "interrupted": {
      const now = Date.now();
      if (row.nextRetryAt && row.nextRetryAt > now) {
        const secs = Math.ceil((row.nextRetryAt - now) / 1000);
        return `Interrupted · retrying in ${secs}s`;
      }
      return "Interrupted · connection lost";
    }
    default:
      return "";
  }
}

/** Label for the add/download button based on detection kind and media options. */
export function addLabel(
  det: DetectedKind,
  opts?: Partial<MediaOptions> | null,
): string {
  if (det === "media") {
    if (opts?.audioOnly) {
      const fmt = opts.format ?? "MP3";
      return `Download audio ${fmt}`;
    }
    const quality = opts?.quality ?? "1080p";
    const fmt = opts?.format ?? "MP4";
    return `Download ${quality} ${fmt}`;
  }
  if (det === "torrent") {
    return "Add torrent";
  }
  return "Download";
}

/** Extracts domain name from a URL without leading 'www.'. */
export function extractHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Formats media resolution/bitrate and format: "1080p · MP4", "MP3 192 kbps". */
export function formatMedia(options: MediaOptions | null): string {
  if (!options) return "—";
  if (options.audioOnly) {
    return `${options.format} ${options.quality}`;
  }
  const parts = [options.quality, options.format];
  if (options.subtitles) {
    parts.push("subtitle");
  }
  return parts.join(" · ");
}

/** Formats metadata row string: "youtube.com · 1080p · MP4 · 412 MB". */
export function metaText(row: DownloadView): string {
  const host = extractHost(row.url) || (row.kind === "media" ? "media" : "file");
  const fmt = row.kind === "media" ? formatMedia(row.options) : "1 koneksi";
  const size = row.totalBytes && row.totalBytes > 0 ? formatSize(row.totalBytes) : "—";
  return [host, fmt, size].filter(Boolean).join(" · ");
}

export interface DetectionInfo {
  readonly label: string;
  readonly hint: string;
  /** Tailwind text class for the chip. */
  readonly color: string;
}

/** Returns status label, help hint, and accent color for the detection chip. */
export function detectionInfo(kind: DetectedKind, host?: string): DetectionInfo {
  switch (kind) {
    case "none":
      return {
        label: "Waiting for link",
        hint: "Paste a video, audio, or file link.",
        color: "text-muted",
      };
    case "media":
      return {
        label: "Video/audio · yt-dlp",
        hint: host
          ? `Detected ${host}. Title fetched automatically when download starts.`
          : "Title fetched automatically when download starts.",
        color: "text-accent",
      };
    case "file":
      return {
        label: "Direct download",
        hint: "Downloaded directly by the app, resumable if interrupted.",
        color: "text-accent",
      };
    case "torrent":
      return {
        label: "Torrent · magnet",
        hint: "Torrents not yet supported.",
        color: "text-danger",
      };
    case "invalid":
      return {
        label: "Unrecognized link",
        hint: "Make sure link starts with https://",
        color: "text-danger",
      };
  }
}

export type DownloadTab = "all" | "active" | "done" | "failed";

export const TAB_LABELS: Readonly<Record<DownloadTab, string>> = {
  all: "All",
  active: "Active",
  done: "Done",
  failed: "Failed",
};

const ACTIVE: Readonly<Record<DownloadStatus, boolean>> = {
  queued: true,
  running: true,
  paused: true,
  processing: true,
  interrupted: true,
  done: false,
  failed: false,
};

const IN_TAB: Readonly<Record<DownloadTab, (x: DownloadView) => boolean>> = {
  all: () => true,
  active: (x) => Boolean(ACTIVE[x.status]),
  done: (x) => x.status === "done",
  failed: (x) => x.status === "failed",
};

/** Filters downloads by active tab. */
export function filterDownloads(
  items: readonly DownloadView[],
  tab: DownloadTab,
): DownloadView[] {
  return items.filter(IN_TAB[tab]);
}

/** Computes count of items per tab. */
export function tabCounts(items: readonly DownloadView[]): Record<DownloadTab, number> {
  return {
    all: items.length,
    active: items.filter(IN_TAB.active).length,
    done: items.filter(IN_TAB.done).length,
    failed: items.filter(IN_TAB.failed).length,
  };
}
