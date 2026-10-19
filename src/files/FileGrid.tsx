import type { MouseEvent } from "react";
import { assetUrl, type FileEntry, type FolderMeta } from "../api";
import { isRemotePath } from "./remotes";
import { formatSize, KIND_ICONS } from "./view";

export function FileGrid({
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
        Folder kosong
      </div>
    );
  }

  return (
    <div
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(null, e);
      }}
      className="grid flex-1 content-start gap-2.5 overflow-y-auto p-3.5"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))",
      }}
    >
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
            draggable={!isRemotePath(entry.path)}
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
            title={entry.name}
            className={`flex flex-col items-center gap-2 rounded-xl border p-2.5 text-center text-ink transition-colors ${
              isCut ? "opacity-50" : ""
            } ${
              isSelected
                ? "border-field-focus bg-surface-2"
                : "border-transparent hover:bg-surface"
            }`}
          >
            <span className="relative flex h-[68px] w-full items-center justify-center">
              {entry.kind === "image" && !isRemotePath(entry.path) ? (
                <img
                  loading="lazy"
                  src={assetUrl(entry.path)}
                  alt=""
                  className="h-full w-full rounded object-cover"
                />
              ) : (
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill={entry.kind === "folder" ? "currentColor" : "none"}
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={isSelected ? "text-accent" : "text-muted"}
                  style={meta?.color ? { color: meta.color } : undefined}
                  aria-hidden="true"
                >
                  <path d={KIND_ICONS[entry.kind]} />
                </svg>
              )}
              {meta?.emoji && (
                <span aria-hidden="true" className="absolute right-1 bottom-0 text-lg leading-none">
                  {meta.emoji}
                </span>
              )}
            </span>
            <span className="line-clamp-2 max-w-full text-xs leading-snug break-all">
              {entry.name}
            </span>
            <span className="font-mono text-[11px] text-muted">{sub}</span>
          </button>
        );
      })}
    </div>
  );
}
