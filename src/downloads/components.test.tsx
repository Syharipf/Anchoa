import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type DownloadSettings, type DownloadView, type EnginesInfo } from "../api";
import { elements, hookHarness, type HookHarness } from "../test/hookHarness";
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
      expect(html).toContain("Kemajuan unduhan Tutorial Live2D");
      expect(html).toContain("anchoa-fish-school");
    });

    it("renders interrupted download with resume-now button", () => {
      const interruptedItem: DownloadView = {
        id: "d3",
        title: "Large Dataset",
        url: "https://example.com/dataset.iso",
        kind: "file",
        options: null,
        status: "interrupted",
        totalBytes: 500_000_000,
        doneBytes: 150_000_000,
        filePath: null,
        error: "connection timeout",
        createdAt: 3000,
        finishedAt: null,
        speed: null,
        eta: null,
        expectedSha256: null,
        actualSha256: null,
        firstInterruptedAt: 4000,
        nextRetryAt: Date.now() + 10000,
        retryCount: 1,
      };
      const html = renderToStaticMarkup(
        <DownloadQueue
          items={[interruptedItem]}
          onPause={() => {}}
          onResume={() => {}}
          onRetry={() => {}}
          onRemove={() => {}}
          onOpen={() => {}}
          onReveal={() => {}}
        />,
      );
      expect(html).toContain("Large Dataset");
      expect(html).toContain("Terputus");
      expect(html).toContain("Lanjutkan sekarang");
      expect(html).toContain("Kemajuan unduhan Large Dataset");
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

    it("renders the available engines without a torrent placeholder", () => {
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
      expect(html).not.toContain("Torrent");
      expect(html).not.toContain("Menyusul");
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

    describe("folder picker", () => {
      let harness: HookHarness<ReactNode> | undefined;
      const spies: { mockRestore: () => void }[] = [];
      const settings: DownloadSettings = { dir: "/home/user/Unduhan", parallel: 2, limit: 0 };

      afterEach(() => {
        harness?.dispose();
        harness = undefined;
        spies.splice(0).forEach((spy) => spy.mockRestore());
      });

      function start() {
        harness = hookHarness(() =>
          DownloadSettingsPanel({ settings, onSettingsChanged: () => {} }),
        );
        harness.render();
      }

      function button(label: string) {
        const found = elements(harness!.render()).find(
          (el) => el.type === "button" && el.props["aria-label"] === label,
        );
        expect(found).toBeDefined();
        return found!;
      }

      function pathInput() {
        const found = elements(harness!.render()).find(
          (el) => el.type === "input" && el.props["aria-label"] === "Path folder unduhan",
        );
        expect(found).toBeDefined();
        return found!;
      }

      async function openEditor() {
        await (elements(harness!.render()).find(
          (el) => el.type === "button" && el.props.children === "Ubah",
        )!.props.onClick as () => Promise<void>)();
        harness!.render();
      }

      it("fills the path input with the folder chosen in the picker", async () => {
        const pick = spyOn(api, "pickDirectory").mockResolvedValue("/mnt/Media/Unduhan");
        spies.push(pick);
        start();
        await openEditor();
        await (button("Pilih folder unduhan").props.onClick as () => Promise<void>)();
        await harness!.settle();
        expect(pathInput().props.value).toBe("/mnt/Media/Unduhan");
        expect(pick).toHaveBeenCalledTimes(1);
        expect(pick).toHaveBeenCalledWith();
      });

      it("leaves the path untouched when the picker is cancelled", async () => {
        const pick = spyOn(api, "pickDirectory").mockResolvedValue(null);
        spies.push(pick);
        start();
        await openEditor();
        const before = pathInput().props.value;
        await (button("Pilih folder unduhan").props.onClick as () => Promise<void>)();
        await harness!.settle();
        expect(pathInput().props.value).toBe(before);
        expect(pathInput().props.value).toBe("/home/user/Unduhan");
        expect(pick).toHaveBeenCalledTimes(1);
      });

      it("saves the picked path through the existing save flow", async () => {
        spies.push(spyOn(api, "pickDirectory").mockResolvedValue("/mnt/Media/Unduhan"));
        const save = spyOn(api, "saveDownloadSettings").mockResolvedValue({
          ...settings,
          dir: "/mnt/Media/Unduhan",
        });
        spies.push(save);
        start();
        await openEditor();
        await (button("Pilih folder unduhan").props.onClick as () => Promise<void>)();
        await harness!.settle();
        await (elements(harness!.render()).find(
          (el) => el.type === "button" && el.props.children === "Simpan",
        )!.props.onClick as () => Promise<void>)();
        await harness!.settle();
        expect(save).toHaveBeenCalledWith({ ...settings, dir: "/mnt/Media/Unduhan" });
      });
    });
});
