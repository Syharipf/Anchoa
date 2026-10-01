import { describe, expect, it } from "bun:test";
import type { DownloadView } from "../api";
import {
  addLabel,
  detect,
  detectionInfo,
  DOWNLOAD_EXAMPLES,
  extractHost,
  filterDownloads,
  formatEta,
  formatMedia,
  formatSpeed,
  metaText,
  progressPercent,
  progressText,
  STATUS_LABELS,
  tabCounts,
} from "./view";

describe("downloads view rules", () => {
  describe("detect", () => {
    it("returns none for empty or whitespace-only inputs", () => {
      expect(detect("")).toBe("none");
      expect(detect("   ")).toBe("none");
      expect(detect("\t\n")).toBe("none");
    });

    it("matches media hosts by host name only", () => {
      expect(detect("https://m.youtube.com/watch?v=abc")).toBe("media");
      expect(detect("https://example.com/mirror/youtube.com.zip")).toBe("file");
      expect(detect("https://notyoutube.com/a.zip")).toBe("file");
    });

    it("detects torrent and magnet URLs", () => {
      expect(detect("magnet:?xt=urn:btih:contoh&dn=big-buck-bunny-1080p")).toBe("torrent");
      expect(detect("MAGNET:?xt=urn:btih:contoh")).toBe("torrent");
      expect(detect("https://archive.org/download/contoh/debian.torrent")).toBe("torrent");
      expect(detect("http://example.com/test.torrent?token=abc")).toBe("torrent");
    });

    it("detects media URLs from supported hosts", () => {
      expect(detect("https://www.youtube.com/watch?v=contoh-live2d")).toBe("media");
      expect(detect("https://youtu.be/contoh-live2d")).toBe("media");
      expect(detect("https://vimeo.com/123456789")).toBe("media");
      expect(detect("https://soundcloud.com/contoh/ngobrol-teknologi-42")).toBe("media");
      expect(detect("https://www.twitch.tv/streamer")).toBe("media");
      expect(detect("https://bandcamp.com/album/title")).toBe("media");
      expect(detect("https://dailymotion.com/video/x123")).toBe("media");
      expect(detect("https://bilibili.com/video/BV123")).toBe("media");
      expect(detect("  HTTPS://YOUTUBE.COM/watch?v=xyz  ")).toBe("media");
    });

    it("detects direct file URLs", () => {
      expect(detect("https://archive.org/download/contoh/dataset-suara-id.zip")).toBe("file");
      expect(detect("http://127.0.0.1:8000/contoh.bin")).toBe("file");
      expect(detect("https://example.com/document.pdf")).toBe("file");
      expect(detect("http://localhost:8000/archive.tar.gz")).toBe("file");
    });

    it("returns invalid for unrecognized or malformed inputs", () => {
      expect(detect("not a url")).toBe("invalid");
      expect(detect("ftp://example.com/file.bin")).toBe("invalid");
      expect(detect("https://")).toBe("invalid");
      expect(detect("http://")).toBe("invalid");
      expect(detect("http://localhost:8000/download")).toBe("file");
      expect(detect("http://[::1]:8000/download")).toBe("file");
    });
  });

  describe("DOWNLOAD_EXAMPLES", () => {
    it("matches the artboard examples and correctly categorizes them", () => {
      expect(DOWNLOAD_EXAMPLES).toHaveLength(4);
      expect(detect(DOWNLOAD_EXAMPLES[0].url)).toBe("media");
      expect(detect(DOWNLOAD_EXAMPLES[1].url)).toBe("media");
      expect(detect(DOWNLOAD_EXAMPLES[2].url)).toBe("file");
      expect(detect(DOWNLOAD_EXAMPLES[3].url)).toBe("torrent");
    });
  });

  describe("formatSpeed", () => {
    it("formats 0 and invalid numbers as 0 B/s", () => {
      expect(formatSpeed(0)).toBe("0 B/s");
      expect(formatSpeed(-50)).toBe("0 B/s");
      expect(formatSpeed(NaN)).toBe("0 B/s");
      expect(formatSpeed(Infinity)).toBe("0 B/s");
    });

    it("formats bytes under 1 KB", () => {
      expect(formatSpeed(512)).toBe("512 B/s");
      expect(formatSpeed(1023)).toBe("1023 B/s");
    });

    it("formats kilobytes per second", () => {
      expect(formatSpeed(1024)).toBe("1 KB/s");
      expect(formatSpeed(4 * 1024)).toBe("4 KB/s");
      expect(formatSpeed(500 * 1024)).toBe("500 KB/s");
    });

    it("formats megabytes per second with comma decimal", () => {
      expect(formatSpeed(1024 * 1024)).toBe("1,0 MB/s");
      expect(formatSpeed(Math.round(8.2 * 1024 * 1024))).toBe("8,2 MB/s");
    });

    it("formats gigabytes per second with comma decimal", () => {
      expect(formatSpeed(Math.round(1.5 * 1024 * 1024 * 1024))).toBe("1,5 GB/s");
    });
  });

  describe("formatEta", () => {
    it("formats seconds below 1 minute", () => {
      expect(formatEta(0)).toBe("0 dtk");
      expect(formatEta(-5)).toBe("0 dtk");
      expect(formatEta(19)).toBe("19 dtk");
      expect(formatEta(59)).toBe("59 dtk");
    });

    it("formats minutes below 1 hour", () => {
      expect(formatEta(60)).toBe("1 mnt");
      expect(formatEta(120)).toBe("2 mnt");
      expect(formatEta(190)).toBe("3 mnt");
    });

    it("formats hours and remaining minutes", () => {
      expect(formatEta(3600)).toBe("1 jam");
      expect(formatEta(5400)).toBe("1 jam 30 mnt");
      expect(formatEta(7200)).toBe("2 jam");
    });
  });

  describe("STATUS_LABELS", () => {
    it("has exact Indonesian labels for all download statuses", () => {
      expect(STATUS_LABELS.queued).toBe("Menunggu");
      expect(STATUS_LABELS.running).toBe("Mengunduh");
      expect(STATUS_LABELS.paused).toBe("Dijeda");
      expect(STATUS_LABELS.processing).toBe("Memproses");
      expect(STATUS_LABELS.done).toBe("Selesai");
      expect(STATUS_LABELS.failed).toBe("Gagal");
    });
  });

  describe("progressPercent", () => {
    it("returns 0 for queued and failed rows", () => {
      expect(
        progressPercent({
          status: "queued",
          doneBytes: 500,
          totalBytes: 1000,
        }),
      ).toBe(0);
      expect(
        progressPercent({
          status: "failed",
          doneBytes: 500,
          totalBytes: 1000,
        }),
      ).toBe(0);
    });

    it("returns 100 for done rows", () => {
      expect(
        progressPercent({
          status: "done",
          doneBytes: 500,
          totalBytes: 1000,
        }),
      ).toBe(100);
    });

    it("calculates percentage correctly for running and paused rows", () => {
      expect(
        progressPercent({
          status: "running",
          doneBytes: 63,
          totalBytes: 100,
        }),
      ).toBe(63);
      expect(
        progressPercent({
          status: "paused",
          doneBytes: 22,
          totalBytes: 100,
        }),
      ).toBe(22);
    });

    it("returns 0 when totalBytes is missing or zero", () => {
      expect(
        progressPercent({
          status: "running",
          doneBytes: 1000,
          totalBytes: null,
        }),
      ).toBe(0);
      expect(
        progressPercent({
          status: "running",
          doneBytes: 1000,
          totalBytes: 0,
        }),
      ).toBe(0);
    });
  });

  describe("progressText", () => {
    const makeRow = (overrides: Partial<DownloadView>): DownloadView => ({
      id: "d1",
      title: "Test download",
      url: "https://example.com/test.mp4",
      kind: "media",
      options: {
        audioOnly: false,
        quality: "1080p",
        format: "MP4",
        subtitles: false,
      },
      status: "running",
      totalBytes: 100 * 1024 * 1024,
      doneBytes: 63 * 1024 * 1024,
      filePath: null,
      error: null,
      createdAt: 1000,
      finishedAt: null,
      speed: Math.round(8.2 * 1024 * 1024),
      eta: 19,
      ...overrides,
    });

    it("formats running row with percentage, speed, and eta", () => {
      const row = makeRow({});
      expect(progressText(row)).toBe("63% · 8,2 MB/s · 19 dtk lagi");
    });

    it("formats running row without eta", () => {
      const row = makeRow({ eta: null });
      expect(progressText(row)).toBe("63% · 8,2 MB/s");
    });

    it("formats running row without speed and eta", () => {
      const row = makeRow({ speed: null, eta: null });
      expect(progressText(row)).toBe("63%");
    });

    it("formats running row with unknown total bytes", () => {
      const row = makeRow({
        totalBytes: null,
        doneBytes: 4 * 1024 * 1024,
        speed: 1024 * 1024,
        eta: 10,
      });
      expect(progressText(row)).toBe("4,0 MB · 1,0 MB/s · 10 dtk lagi");
    });

    it("formats queued row", () => {
      const row = makeRow({ status: "queued" });
      expect(progressText(row)).toBe("Menunggu giliran antrean");
    });

    it("formats paused row with percentage", () => {
      const row = makeRow({
        status: "paused",
        doneBytes: 22 * 1024 * 1024,
        totalBytes: 100 * 1024 * 1024,
      });
      expect(progressText(row)).toBe("22% · dijeda");
    });

    it("formats paused row with unknown total bytes", () => {
      const row = makeRow({
        status: "paused",
        totalBytes: null,
        doneBytes: 4 * 1024 * 1024,
      });
      expect(progressText(row)).toBe("4,0 MB · dijeda");
    });

    it("formats processing row with audio or video format", () => {
      const rowAudio = makeRow({
        status: "processing",
        options: {
          audioOnly: true,
          quality: "192 kbps",
          format: "MP3",
          subtitles: false,
        },
      });
      expect(progressText(rowAudio)).toBe("Mengonversi ke MP3 (ffmpeg)…");

      const rowVideo = makeRow({
        status: "processing",
        options: {
          audioOnly: false,
          quality: "1080p",
          format: "MKV",
          subtitles: false,
        },
      });
      expect(progressText(rowVideo)).toBe("Mengonversi ke MKV (ffmpeg)…");

      const rowNoOptions = makeRow({
        status: "processing",
        options: null,
      });
      expect(progressText(rowNoOptions)).toBe("Memproses (ffmpeg)…");
    });

    it("formats done row with file path", () => {
      const row = makeRow({
        status: "done",
        filePath: "~/Unduhan/video.mp4",
      });
      expect(progressText(row)).toBe("Tersimpan di ~/Unduhan/video.mp4");

      const rowNoPath = makeRow({
        status: "done",
        filePath: null,
      });
      expect(progressText(rowNoPath)).toBe("Tersimpan");
    });

    it("formats failed row with error message", () => {
      const row = makeRow({
        status: "failed",
        error: "Gagal: video memerlukan login",
      });
      expect(progressText(row)).toBe("Gagal: video memerlukan login");

      const rowNoErr = makeRow({
        status: "failed",
        error: null,
      });
      expect(progressText(rowNoErr)).toBe("Gagal");
    });
  });

  describe("addLabel", () => {
    it("returns download label for video media", () => {
      expect(
        addLabel("media", {
          audioOnly: false,
          quality: "1080p",
          format: "MP4",
          subtitles: false,
        }),
      ).toBe("Unduh 1080p MP4");

      expect(
        addLabel("media", {
          audioOnly: false,
          quality: "2160p",
          format: "MKV",
          subtitles: true,
        }),
      ).toBe("Unduh 2160p MKV");
    });

    it("returns download label for audio media", () => {
      expect(
        addLabel("media", {
          audioOnly: true,
          quality: "192 kbps",
          format: "MP3",
          subtitles: false,
        }),
      ).toBe("Unduh audio MP3");

      expect(
        addLabel("media", {
          audioOnly: true,
          quality: "320 kbps",
          format: "M4A",
          subtitles: false,
        }),
      ).toBe("Unduh audio M4A");
    });

    it("uses default video settings when options are omitted", () => {
      expect(addLabel("media")).toBe("Unduh 1080p MP4");
      expect(addLabel("media", null)).toBe("Unduh 1080p MP4");
    });

    it("returns torrent label for torrents", () => {
      expect(addLabel("torrent")).toBe("Tambah torrent");
    });

    it("returns standard Unduh label for files and other kinds", () => {
      expect(addLabel("file")).toBe("Unduh");
      expect(addLabel("none")).toBe("Unduh");
      expect(addLabel("invalid")).toBe("Unduh");
    });
  });

  describe("extractHost", () => {
    it("extracts clean hostnames without leading www", () => {
      expect(extractHost("https://www.youtube.com/watch?v=123")).toBe("youtube.com");
      expect(extractHost("https://archive.org/download/test.zip")).toBe("archive.org");
      expect(extractHost("invalid-url")).toBe("");
      expect(extractHost("")).toBe("");
    });
  });

  describe("formatMedia", () => {
    it("formats video media format string", () => {
      expect(
        formatMedia({
          audioOnly: false,
          quality: "1080p",
          format: "MP4",
          subtitles: false,
        }),
      ).toBe("1080p · MP4");

      expect(
        formatMedia({
          audioOnly: false,
          quality: "1080p",
          format: "MP4",
          subtitles: true,
        }),
      ).toBe("1080p · MP4 · subtitle");
    });

    it("formats audio media format string", () => {
      expect(
        formatMedia({
          audioOnly: true,
          quality: "192 kbps",
          format: "MP3",
          subtitles: false,
        }),
      ).toBe("MP3 192 kbps");
    });

    it("returns dash when options are missing", () => {
      expect(formatMedia(null)).toBe("—");
    });
  });

  describe("metaText", () => {
    it("combines host, format, and total size", () => {
      const row: DownloadView = {
        id: "d1",
        title: "Tutorial Live2D",
        url: "https://www.youtube.com/watch?v=contoh",
        kind: "media",
        options: {
          audioOnly: false,
          quality: "1080p",
          format: "MP4",
          subtitles: false,
        },
        status: "running",
        totalBytes: 412 * 1024 * 1024,
        doneBytes: 200 * 1024 * 1024,
        filePath: null,
        error: null,
        createdAt: 1000,
        finishedAt: null,
        speed: 1024 * 1024,
        eta: 10,
      };

      expect(metaText(row)).toBe("youtube.com · 1080p · MP4 · 412,0 MB");
    });
  });

  describe("filterDownloads and tabCounts", () => {
    const rows: DownloadView[] = [
      {
        id: "1",
        title: "Running item",
        url: "https://youtube.com/1",
        kind: "media",
        options: null,
        status: "running",
        totalBytes: 100,
        doneBytes: 50,
        filePath: null,
        error: null,
        createdAt: 1,
        finishedAt: null,
        speed: 10,
        eta: 5,
      },
      {
        id: "2",
        title: "Paused item",
        url: "https://example.com/2",
        kind: "file",
        options: null,
        status: "paused",
        totalBytes: 100,
        doneBytes: 10,
        filePath: null,
        error: null,
        createdAt: 2,
        finishedAt: null,
        speed: null,
        eta: null,
      },
      {
        id: "3",
        title: "Done item",
        url: "https://example.com/3",
        kind: "file",
        options: null,
        status: "done",
        totalBytes: 100,
        doneBytes: 100,
        filePath: "/done/3",
        error: null,
        createdAt: 3,
        finishedAt: 100,
        speed: null,
        eta: null,
      },
      {
        id: "4",
        title: "Failed item",
        url: "https://example.com/4",
        kind: "file",
        options: null,
        status: "failed",
        totalBytes: null,
        doneBytes: 0,
        filePath: null,
        error: "Network error",
        createdAt: 4,
        finishedAt: null,
        speed: null,
        eta: null,
      },
    ];

    it("counts tabs correctly", () => {
      const counts = tabCounts(rows);
      expect(counts.all).toBe(4);
      expect(counts.active).toBe(2);
      expect(counts.done).toBe(1);
      expect(counts.failed).toBe(1);
    });

    it("filters downloads by tab", () => {
      expect(filterDownloads(rows, "all")).toHaveLength(4);
      expect(filterDownloads(rows, "active")).toHaveLength(2);
      expect(filterDownloads(rows, "done")).toHaveLength(1);
      expect(filterDownloads(rows, "failed")).toHaveLength(1);
    });
  });

  describe("detectionInfo", () => {
    it("returns proper labels and descriptions per kind", () => {
      expect(detectionInfo("none").label).toBe("Menunggu tautan");
      expect(detectionInfo("media", "youtube.com").label).toBe("Video/audio · yt-dlp");
      expect(detectionInfo("media", "youtube.com").hint).toContain("youtube.com");
      expect(detectionInfo("file").label).toBe("File langsung");
      expect(detectionInfo("torrent").label).toBe("Torrent · magnet");
      expect(detectionInfo("invalid").label).toBe("Tautan tidak dikenali");
    });
  });
});
