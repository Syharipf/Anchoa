import type { MouseEvent } from "react";
import type { FileEntry, FolderMeta } from "../api";
import { formatSize, KIND_ICONS, KIND_LABELS } from "./view";

function formatModDate(ms: number): string {
  if (!ms) return "-";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
  return `${dateStr} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function FileList({
  entries,
  selected,
  markers,
  clipboard,
  onSelect,
  onOpen,
  onDropIntoFolder,
  onContextMenu,
}: Readonly<{
  entries: readonly FileEntry[];
  selected: readonly number[];
  /** Folder markers keyed by path. */
  markers?: ReadonlyMap<string, FolderMeta>;
  clipboard?: { mode: "copy" | "move"; paths: readonly string[] } | null;
  onSelect: (index: number, e: MouseEvent) => void;
  onOpen: (entry: FileEntry) => void;
  onDropIntoFolder?: (sources: string[], targetFolder: string) => void;
  onContextMenu?: (entry: FileEntry | null, e: MouseEvent) => void;
}>) {
  if (entries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        Empty folder
      </div>
    );
  }

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(null, e);
      }}
      className="flex flex-1 flex-col overflow-y-auto"
    >
      <div
        aria-hidden="true"
        className="sticky top-0 grid grid-cols-[minmax(0,1fr)_90px_120px_150px] gap-3 border-b border-line bg-sidebar px-3.5 py-2 text-[11px] uppercase tracking-[0.08em] text-muted"
      >
        <span>Name</span>
        <span className="text-right">Size</span>
        <span>Kind</span>
        <span>Modified</span>
      </div>

      {entries.map((entry, index) => {
        const isSelected = selected.includes(index);
        const isCut = clipboard?.mode === "move" && clipboard.paths.includes(entry.path);
        const meta = markers?.get(entry.path);
        const sub =
          entry.kind === "folder"
            ? `${entry.size} item`
            : formatSize(entry.size);
        return (
          <button
            key={entry.path}
            type="button"
            data-file-entry
            draggable
            onDragStart={(e) => {
              const paths =
                isSelected && selected.length > 1
                  ? selected.map((idx) => entries[idx]?.path).filter(Boolean)
                  : [entry.path];
              e.dataTransfer.setData("application/json", JSON.stringify(paths));
              e.dataTransfer.setData("text/plain", entry.path);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (entry.kind === "folder") {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }
            }}
            onDrop={(e) => {
              if (entry.kind === "folder" && onDropIntoFolder) {
                e.preventDefault();
                e.stopPropagation();
                try {
                  const raw = e.dataTransfer.getData("application/json");
                  const paths: string[] = raw
                    ? JSON.parse(raw)
                    : [e.dataTransfer.getData("text/plain")].filter(Boolean);
                  if (paths.length > 0) onDropIntoFolder(paths, entry.path);
                } catch {}
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenu?.(entry, e);
            }}
            onClick={(e) => onSelect(index, e)}
            onDoubleClick={() => onOpen(entry)}
            aria-pressed={isSelected}
            aria-label={`${entry.name}, ${sub}`}
            className={`grid grid-cols-[minmax(0,1fr)_90px_120px_150px] items-center gap-3 border-b border-[#1a1e26] px-3.5 py-[7px] text-left text-[13px] text-ink transition-colors ${
              isCut ? "opacity-50" : ""
            } ${
              isSelected
                ? "bg-surface-2 shadow-[inset_2px_0_0_#c6f36b]"
                : "hover:bg-surface-2"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center ${
                  isSelected ? "text-accent" : "text-muted"
                }`}
                style={meta?.color ? { color: meta.color } : undefined}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill={entry.kind === "folder" ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={KIND_ICONS[entry.kind]} />
                </svg>
              </span>
              {meta?.emoji && <span aria-hidden="true">{meta.emoji}</span>}
              <span className="truncate">{entry.name}</span>
            </span>
            <span className="text-right font-mono text-xs text-muted">{sub}</span>
            <span className="text-xs text-muted">{KIND_LABELS[entry.kind]}</span>
            <span className="font-mono text-xs text-muted">
              {formatModDate(entry.modified)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
