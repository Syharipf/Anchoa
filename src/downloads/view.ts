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
];

/**
 * Detects download category from URL based on spec U4 and the Unduhan artboard:
 * - magnet: or .torrent -> torrent
 * - video/audio hosts -> media
 * - http(s) URLs -> file
 * - empty -> none
 * - everything else -> invalid
 */
export function detect(url: string): DetectedKind {
  const s = url.trim().toLowerCase();
  if (!s) {
    return "none";
  }
  if (s.startsWith("magnet:") || /\.torrent($|\?)/.test(s)) {
    return "torrent";
  }
  const host = /^https?:\/\//.test(s) ? extractHost(s) : "";
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
  queued: "Menunggu",
  running: "Mengunduh",
  paused: "Dijeda",
  processing: "Memproses",
  done: "Selesai",
  failed: "Gagal",
};

/** Tailwind text class for the status label. */
export const STATUS_TEXT: Readonly<Record<DownloadStatus, string>> = {
  queued: "text-muted",
  running: "text-accent",
  paused: "text-muted",
  processing: "text-ink",
  done: "text-ink",
  failed: "text-danger",
};

/** Tailwind background class for the progress bar. */
export const STATUS_BAR: Readonly<Record<DownloadStatus, string>> = {
  queued: "bg-disabled",
  running: "bg-accent",
  paused: "bg-disabled",
  processing: "bg-heat-3",
  done: "bg-heat-2",
  failed: "bg-danger",
};

/** Formats byte rate using existing formatSize helper, e.g. "8,2 MB/s". */
export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0 || !Number.isFinite(bytesPerSec)) {
    return "0 B/s";
  }
  return `${formatSize(Math.round(bytesPerSec))}/s`;
}

/** Formats ETA in seconds to Indonesian short text: "19 dtk", "2 mnt", "1 jam 30 mnt". */
export function formatEta(seconds: number): string {
  if (seconds <= 0 || !Number.isFinite(seconds)) {
    return "0 dtk";
  }
  const s = Math.round(seconds);
  if (s < 60) {
    return `${s} dtk`;
  }
  if (s < 3600) {
    return `${Math.round(s / 60)} mnt`;
  }
  const hours = Math.floor(s / 3600);
  const mins = Math.round((s % 3600) / 60);
  if (mins === 60) {
    return `${hours + 1} jam`;
  }
  if (mins === 0) {
    return `${hours} jam`;
  }
  return `${hours} jam ${mins} mnt`;
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
      return "Menunggu giliran antrean";
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
        parts.push(`${formatEta(row.eta)} lagi`);
      }
      return parts.join(" · ");
    }
    case "paused": {
      const pct = progressPercent(row);
      if (row.totalBytes && row.totalBytes > 0) {
        return `${pct}% · dijeda`;
      }
      if (row.doneBytes > 0) {
        return `${formatSize(row.doneBytes)} · dijeda`;
      }
      return "0% · dijeda";
    }
    case "processing": {
      if (row.options?.format) {
        return `Mengonversi ke ${row.options.format} (ffmpeg)…`;
      }
      return "Memproses (ffmpeg)…";
    }
    case "done":
      return row.filePath ? `Tersimpan di ${row.filePath}` : "Tersimpan";
    case "failed":
      return row.error ?? "Gagal";
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
      return `Unduh audio ${fmt}`;
    }
    const quality = opts?.quality ?? "1080p";
    const fmt = opts?.format ?? "MP4";
    return `Unduh ${quality} ${fmt}`;
  }
  if (det === "torrent") {
    return "Tambah torrent";
  }
  return "Unduh";
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
        label: "Menunggu tautan",
        hint: "Tempel tautan video, audio, atau file.",
        color: "text-muted",
      };
    case "media":
      return {
        label: "Video/audio · yt-dlp",
        hint: host
          ? `Terdeteksi ${host}. Judul diambil otomatis saat unduhan mulai.`
          : "Judul diambil otomatis saat unduhan mulai.",
        color: "text-accent",
      };
    case "file":
      return {
        label: "File langsung",
        hint: "Diunduh langsung oleh aplikasi, bisa dilanjut kalau terputus.",
        color: "text-accent",
      };
    case "torrent":
      return {
        label: "Torrent · magnet",
        hint: "Torrent belum didukung.",
        color: "text-danger",
      };
    case "invalid":
      return {
        label: "Tautan tidak dikenali",
        hint: "Pastikan tautan diawali https://",
        color: "text-danger",
      };
  }
}

export type DownloadTab = "all" | "active" | "done" | "failed";

export const TAB_LABELS: Readonly<Record<DownloadTab, string>> = {
  all: "Semua",
  active: "Aktif",
  done: "Selesai",
  failed: "Gagal",
};

const ACTIVE: ReadonlySet<DownloadStatus> = new Set(["queued", "running", "paused", "processing"]);

const IN_TAB: Readonly<Record<DownloadTab, (x: DownloadView) => boolean>> = {
  all: () => true,
  active: (x) => ACTIVE.has(x.status),
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
