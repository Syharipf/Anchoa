import { describe, expect, it } from "bun:test";
import type { FileEntry } from "../api";
import {
  formatSize,
  KIND_ICONS,
  KIND_LABELS,
  reportToasts,
  select,
  totalSize,
  type SelectionState,
} from "./view";

describe("file manager view rules", () => {
  describe("select", () => {
    it("selects a single index and sets anchor on plain click", () => {
      const initial: SelectionState = { selected: [], anchor: null };
      const res = select(initial, 3, {});
      expect(res.selected).toHaveLength(1);
      expect(res.selected[0]).toBe(3);
      expect(res.anchor).toBe(3);
    });

    it("replaces existing selection on plain click", () => {
      const state: SelectionState = { selected: [1, 2, 5], anchor: 1 };
      const res = select(state, 4, {});
      expect(res.selected).toHaveLength(1);
      expect(res.selected[0]).toBe(4);
      expect(res.anchor).toBe(4);
    });

    it("toggles item into selection and sets anchor on Ctrl+click", () => {
      const state: SelectionState = { selected: [1, 3], anchor: 1 };
      const res = select(state, 5, { ctrl: true });
      expect(res.selected).toHaveLength(3);
      expect(res.selected).toEqual([1, 3, 5]);
      expect(res.anchor).toBe(5);
    });

    it("toggles item out of selection on Ctrl+click", () => {
      const state: SelectionState = { selected: [1, 3, 5], anchor: 5 };
      const res = select(state, 3, { ctrl: true });
      expect(res.selected).toHaveLength(2);
      expect(res.selected).toEqual([1, 5]);
      expect(res.anchor).toBe(3);
    });

    it("selects forward range from anchor on Shift+click", () => {
      const state: SelectionState = { selected: [1], anchor: 1 };
      const res = select(state, 4, { shift: true });
      expect(res.selected).toHaveLength(4);
      expect(res.selected).toEqual([1, 2, 3, 4]);
      expect(res.anchor).toBe(1);
    });

    it("selects backward range from anchor on Shift+click", () => {
      const state: SelectionState = { selected: [5], anchor: 5 };
      const res = select(state, 2, { shift: true });
      expect(res.selected).toHaveLength(4);
      expect(res.selected).toEqual([2, 3, 4, 5]);
      expect(res.anchor).toBe(5);
    });

    it("sets anchor to target if anchor was null on Shift+click", () => {
      const state: SelectionState = { selected: [], anchor: null };
      const res = select(state, 3, { shift: true });
      expect(res.selected).toHaveLength(1);
      expect(res.selected[0]).toBe(3);
      expect(res.anchor).toBe(3);
    });
  });

  describe("formatSize", () => {
    it("formats bytes under 1 KB without decimals", () => {
      expect(formatSize(0)).toBe("0 B");
      expect(formatSize(512)).toBe("512 B");
      expect(formatSize(1023)).toBe("1023 B");
    });

    it("formats kilobytes without decimals", () => {
      expect(formatSize(1024)).toBe("1 KB");
      expect(formatSize(4 * 1024)).toBe("4 KB");
      expect(formatSize(4096)).toBe("4 KB");
      expect(formatSize(1024 * 100)).toBe("100 KB");
    });

    it("formats megabytes with one decimal and Indonesian comma", () => {
      expect(formatSize(1024 * 1024)).toBe("1,0 MB");
      expect(formatSize(Math.round(12.4 * 1024 * 1024))).toBe("12,4 MB");
    });

    it("formats gigabytes with one decimal and Indonesian comma", () => {
      expect(formatSize(Math.round(1.2 * 1024 * 1024 * 1024))).toBe("1,2 GB");
    });
  });

  describe("totalSize", () => {
    const entries: FileEntry[] = [
      { name: "folder1", path: "/a/f1", kind: "folder", size: 15, modified: 0, hidden: false },
      { name: "img.png", path: "/a/img.png", kind: "image", size: 1048576, modified: 0, hidden: false },
      { name: "doc.txt", path: "/a/doc.txt", kind: "text", size: 2048, modified: 0, hidden: false },
      { name: "folder2", path: "/a/f2", kind: "folder", size: 3, modified: 0, hidden: false },
      { name: "video.mp4", path: "/a/v.mp4", kind: "video", size: 5242880, modified: 0, hidden: false },
    ];

    it("sums non-folder entries and counts folders as 0 bytes", () => {
      expect(totalSize(entries, [0])).toBe(0);
      expect(totalSize(entries, [0, 1])).toBe(1048576);
      expect(totalSize(entries, [0, 1, 2, 3, 4])).toBe(1048576 + 2048 + 5242880);
    });

    it("returns 0 for empty selection", () => {
      expect(totalSize(entries, [])).toBe(0);
    });

    it("sums non-folder entries when called with entry array directly", () => {
      expect(totalSize([entries[1], entries[2]])).toBe(1048576 + 2048);
      expect(totalSize([entries[0], entries[3]])).toBe(0);
      expect(totalSize([])).toBe(0);
    });
  });

  describe("reportToasts", () => {
    it("returns ok message when done items are present", () => {
      const res = reportToasts({ done: ["/a", "/b"], failed: [] }, "disalin");
      expect(res.ok).toBe("2 item disalin");
      expect(res.error).toBeUndefined();
    });

    it("returns error message when failed items are present", () => {
      const res = reportToasts(
        { done: [], failed: [{ path: "/a", error: "Permission denied" }] },
        "disalin",
      );
      expect(res.ok).toBeUndefined();
      expect(res.error).toBe("Gagal: /a: Permission denied");
    });

    it("formats multiple failures separated by comma", () => {
      const res = reportToasts(
        {
          done: [],
          failed: [
            { path: "/a", error: "Permission denied" },
            { path: "/b", error: "Disk full" },
          ],
        },
        "dipindahkan",
      );
      expect(res.ok).toBeUndefined();
      expect(res.error).toBe("Gagal: /a: Permission denied, /b: Disk full");
    });

    it("returns both ok and error when both done and failed are present", () => {
      const res = reportToasts(
        {
          done: ["/ok1"],
          failed: [{ path: "/fail1", error: "Error" }],
        },
        "dipindahkan ke Tong Sampah",
      );
      expect(res.ok).toBe("1 item dipindahkan ke Tong Sampah");
      expect(res.error).toBe("Gagal: /fail1: Error");
    });

    it("returns empty object when done and failed are empty", () => {
      const res = reportToasts({ done: [], failed: [] }, "disalin");
      expect(res.ok).toBeUndefined();
      expect(res.error).toBeUndefined();
    });
  });

  describe("KIND_LABELS", () => {
    it("provides Indonesian labels for all 6 file kinds", () => {
      expect(KIND_LABELS.folder).toBe("Folder");
      expect(KIND_LABELS.image).toBe("Gambar");
      expect(KIND_LABELS.video).toBe("Video");
      expect(KIND_LABELS.pdf).toBe("PDF");
      expect(KIND_LABELS.text).toBe("Teks");
      expect(KIND_LABELS.other).toBe("Berkas");
    });
  });

  describe("KIND_ICONS", () => {
    it("provides SVG path data strings for all 6 file kinds", () => {
      const kinds = ["folder", "image", "video", "pdf", "text", "other"] as const;
      expect(kinds).toHaveLength(6);
      for (const k of kinds) {
        expect(typeof KIND_ICONS[k]).toBe("string");
        expect(KIND_ICONS[k].length).toBeGreaterThan(0);
        expect(KIND_ICONS[k].startsWith("M")).toBe(true);
      }
    });
  });
});
