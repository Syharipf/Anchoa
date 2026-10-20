import type { ConvertFormat, FileEntry, FileKind } from "../api";

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

/** Last segment of a local path, without trailing separators. */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/** Parent folder of a local path; `/` stays `/`, a bare name has `.`. */
export function parentPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (!trimmed) return "/";
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}\\`;
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (idx === 0) return trimmed.slice(0, 1);
  if (idx < 0) return ".";
  const parent = trimmed.slice(0, idx);
  // A Windows drive root keeps its separator: `C:\Users` → `C:\`.
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent;
}

/** Appends one name to a folder path, without doubling the separator. */
export function joinPath(dir: string, name: string): string {
  if (/[\\/]$/.test(dir)) return `${dir}${name}`;
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return `${dir}${sep}${name}`;
}

/** Archive stem: `report.tar.gz` → `report`, `notes.txt` → `notes`. */
export function archiveStem(name: string): string {
  const lower = name.toLowerCase();
  for (const suffix of [".tar.gz", ".tar.bz2", ".tar.xz", ".tar"]) {
    if (lower.endsWith(suffix)) return name.slice(0, name.length - suffix.length);
  }
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** Lower-case extension without the dot: `.bashrc` and `a.tar.gz` follow the backend rule. */
export function fileExtension(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot <= 0 || dot === lower.length - 1 ? "" : lower.slice(dot + 1);
}

/** Output name mirroring the backend claim loop: `foto.jpg`, then `foto (2).jpg`. */
export function convertedName(
  name: string,
  target: string,
  taken: readonly string[],
): string {
  const stem = archiveStem(name) || "berkas";
  const used = new Set(taken);
  let counter = 2;
  let candidate = `${stem}.${target}`;
  while (used.has(candidate)) {
    candidate = `${stem} (${counter}).${target}`;
    counter += 1;
  }
  return candidate;
}

/** Targets advertised for this file name; empty when the backend has no rule. */
export function targetsFor(
  name: string,
  formats: readonly ConvertFormat[],
): string[] {
  const extension = fileExtension(name);
  return [...(formats.find((format) => format.sourceExt === extension)?.targets ?? [])];
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
