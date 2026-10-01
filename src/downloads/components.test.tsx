import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DownloadSettings, DownloadView, EnginesInfo } from "../api";
import { AddDownload } from "./AddDownload";
import { DownloadQueue } from "./DownloadQueue";
import { DownloadSettingsPanel } from "./DownloadSettingsPanel";
import { EnginesPanel } from "./EnginesPanel";

describe("Unduhan components", () => {
  describe("AddDownload", () => {
    it("renders input, detection badge, examples, and download button", () => {
      const html = renderToStaticMarkup(<AddDownload onAdded={() => {}} />);
      expect(html).toContain("Tempel tautan video, audio, atau file…");
      expect(html).toContain("Menunggu tautan");
      expect(html).toContain("Contoh:");
      expect(html).toContain("Video");
      expect(html).toContain("Audio");
      expect(html).toContain("File");
      expect(html).toContain("Magnet");
      expect(html).toContain("Unduh");
    });
  });

  describe("DownloadQueue", () => {
    const items: DownloadView[] = [
      {
        id: "d1",
        title: "Tutorial Live2D",
        url: "https://www.youtube.com/watch?v=abc",
        kind: "media",
        options: { audioOnly: false, quality: "1080p", format: "MP4", subtitles: false },
        status: "running",
        totalBytes: 100_000_000,
        doneBytes: 50_000_000,
        filePath: null,
        error: null,
        createdAt: 1000,
        finishedAt: null,
        speed: 5_000_000,
        eta: 10,
      },
      {
        id: "d2",
        title: "Berkas arsip",
        url: "https://example.com/file.zip",
        kind: "file",
        options: null,
        status: "done",
        totalBytes: 20_000_000,
        doneBytes: 20_000_000,
        filePath: "/home/user/Unduhan/file.zip",
        error: null,
        createdAt: 2000,
        finishedAt: 3000,
        speed: null,
        eta: null,
      },
    ];

    it("renders tabs with counts and download items", () => {
      const html = renderToStaticMarkup(
        <DownloadQueue
          items={items}
          onPause={() => {}}
          onResume={() => {}}
          onRetry={() => {}}
          onRemove={() => {}}
          onOpen={() => {}}
          onReveal={() => {}}
        />,
      );
      expect(html).toContain("Antrean");
      expect(html).toContain("Semua");
      expect(html).toContain("Aktif");
      expect(html).toContain("Selesai");
      expect(html).toContain("Gagal");
      expect(html).toContain("Tutorial Live2D");
      expect(html).toContain("Berkas arsip");
      expect(html).toContain("Mengunduh");
      expect(html).toContain("Selesai");
      expect(html).toContain("Buka di Berkas");
      expect(html).toContain("Hapus dari daftar");
    });

    it("renders empty message when no items", () => {
      const html = renderToStaticMarkup(
        <DownloadQueue
          items={[]}
          onPause={() => {}}
          onResume={() => {}}
          onRetry={() => {}}
          onRemove={() => {}}
          onOpen={() => {}}
          onReveal={() => {}}
        />,
      );
      expect(html).toContain("Tidak ada unduhan di tab ini.");
    });
  });

  describe("EnginesPanel", () => {
    it("shows the install command when an engine is missing", () => {
      const html = renderToStaticMarkup(
        <EnginesPanel engines={{ ytdlp: null, ffmpeg: null, hint: "sudo dnf install yt-dlp ffmpeg" }} />,
      );
      expect(html).toContain("Belum terpasang");
      expect(html).toContain("sudo dnf install yt-dlp ffmpeg");
    });

    it("renders engines info including yt-dlp, ffmpeg, File langsung, and Torrent", () => {
      const engines: EnginesInfo = {
        ytdlp: { version: "2026.09.01", stale: false },
        ffmpeg: { version: "ffmpeg version 7.0.2 Copyright (c) 2000-2024" },
        hint: null,
      };
      const html = renderToStaticMarkup(<EnginesPanel engines={engines} />);
      expect(html).toContain("Mesin unduhan");
      expect(html).toContain("yt-dlp");
      expect(html).toContain("2026.09.01");
      expect(html).toContain("ffmpeg");
      expect(html).toContain(">7.0.2<");
      expect(html).not.toContain("Belum terpasang");
      expect(html).toContain("File langsung");
      expect(html).toContain("Bawaan");
      expect(html).toContain("Torrent");
      expect(html).toContain("Menyusul");
    });

    it("renders uninstalled engines and stale yt-dlp notice", () => {
      const staleEngines: EnginesInfo = {
        ytdlp: { version: "2026.01.01", stale: true },
        ffmpeg: null,
        hint: "Perbarui: sudo dnf upgrade yt-dlp",
      };
      const html = renderToStaticMarkup(<EnginesPanel engines={staleEngines} />);
      expect(html).toContain("Perbarui");
      expect(html).toContain("Belum terpasang");
    });
  });

  describe("DownloadSettingsPanel", () => {
    it("renders folder, parallel downloads stepper, and speed limits", () => {
      const settings: DownloadSettings = {
        dir: "/home/user/Unduhan",
        parallel: 3,
        limit: 5242880,
      };
      const html = renderToStaticMarkup(
        <DownloadSettingsPanel settings={settings} onSettingsChanged={() => {}} />,
      );
      expect(html).toContain("Pengaturan");
      expect(html).toContain("Simpan ke");
      expect(html).toContain("/home/user/Unduhan");
      expect(html).toContain("Ubah");
      expect(html).toContain("Unduhan bersamaan");
      expect(html).toContain("3");
      expect(html).toContain("Batas kecepatan");
      expect(html).toContain("Tanpa batas");
      expect(html).toContain("1 MB/s");
      expect(html).toContain("5 MB/s");
      expect(html).toContain("10 MB/s");
    });
  });
});
