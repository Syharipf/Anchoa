import type { FileEntry, FileKind } from "../api";

export interface SelectionState {
  readonly selected: readonly number[];
  readonly anchor: number | null;
}

export interface SelectOptions {
  readonly ctrl?: boolean;
  readonly shift?: boolean;
}

/** Handles file selection: plain click, Ctrl toggle, and Shift range from anchor. */
export function select(
  state: SelectionState,
  index: number,
  options: SelectOptions,
): { selected: number[]; anchor: number | null } {
  if (options.shift) {
    const from = state.anchor ?? index;
    const start = Math.min(from, index);
    const end = Math.max(from, index);
    const range: number[] = [];
    for (let i = start; i <= end; i++) {
      range.push(i);
    }
    return { selected: range, anchor: from };
  }
  if (options.ctrl) {
    const exists = state.selected.includes(index);
    const next = exists
      ? state.selected.filter((i) => i !== index)
      : [...state.selected, index].sort((a, b) => a - b);
    return { selected: next, anchor: index };
  }
  return { selected: [index], anchor: index };
}

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;
const TB = 1024 * GB;

/** Formats byte sizes using Indonesian conventions: "512 B", "4 KB", "12,4 MB", "1,2 GB". */
export function formatSize(bytes: number): string {
  if (bytes < KB) {
    return `${bytes} B`;
  }
  if (bytes < MB) {
    return `${Math.round(bytes / KB)} KB`;
  }
  if (bytes < GB) {
    return `${(bytes / MB).toFixed(1).replace(".", ",")} MB`;
  }
  if (bytes < TB) {
    return `${(bytes / GB).toFixed(1).replace(".", ",")} GB`;
  }
  return `${(bytes / TB).toFixed(1).replace(".", ",")} TB`;
}

/** Calculates total bytes of selected entries (folders count as 0 bytes). */
export function totalSize(
  entries: readonly FileEntry[],
  selected?: readonly number[],
): number {
  let total = 0;
  if (selected !== undefined) {
    for (const idx of selected) {
      const entry = entries[idx];
      if (entry && entry.kind !== "folder") {
        total += entry.size;
      }
    }
  } else {
    for (const entry of entries) {
      if (entry && entry.kind !== "folder") {
        total += entry.size;
      }
    }
  }
  return total;
}

export interface ReportLike {
  readonly done: readonly unknown[];
  readonly failed: readonly { readonly path: string; readonly error: string }[];
}

/** Formats user toast messages for batch file operations (paste, trash). */
export function reportToasts(
  report: ReportLike,
  doneVerb: string,
): { ok?: string; error?: string } {
  const result: { ok?: string; error?: string } = {};
  if (report.done.length > 0) {
    result.ok = `${report.done.length} item ${doneVerb}`;
  }
  if (report.failed.length > 0) {
    const errs = report.failed
      .map((f) => `${f.path}: ${f.error}`)
      .join(", ");
    result.error = `Gagal: ${errs}`;
  }
  return result;
}

export const KIND_LABELS: Record<FileKind, string> = {
  folder: "Folder",
  image: "Gambar",
  video: "Video",
  pdf: "PDF",
  text: "Teks",
  other: "Berkas",
};

export const KIND_ICONS: Record<FileKind, string> = {
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  image: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM21 17l-5-5-9 8",
  video: "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM10 9.5v5l4-2.5z",
  pdf: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  text: "M6 3h9l3 3v15H6zM9 11h6M9 15h6",
  other: "M6 3h9l3 3v15H6z",
};
