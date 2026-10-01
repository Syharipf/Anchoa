import type { MouseEvent } from "react";
import { assetUrl, type FileEntry } from "../api";
import { formatSize, KIND_ICONS } from "./view";

export function FileGrid({
  entries,
  selected,
  onSelect,
  onOpen,
}: Readonly<{
  entries: readonly FileEntry[];
  selected: readonly number[];
  onSelect: (index: number, e: MouseEvent) => void;
  onOpen: (entry: FileEntry) => void;
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
      className="grid flex-1 content-start gap-2.5 overflow-y-auto p-3.5"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(108px, 1fr))",
      }}
    >
      {entries.map((entry, index) => {
        const isSelected = selected.includes(index);
        const sub =
          entry.kind === "folder"
            ? `${entry.size} item`
            : formatSize(entry.size);

        return (
          <button
            key={entry.path}
            type="button"
            onClick={(e) => onSelect(index, e)}
            onDoubleClick={() => onOpen(entry)}
            aria-pressed={isSelected}
            aria-label={`${entry.name}, ${sub}`}
            title={entry.name}
            className={`flex flex-col items-center gap-2 rounded-xl border p-2.5 text-center text-ink transition-colors ${
              isSelected
                ? "border-field-focus bg-surface-2"
                : "border-transparent hover:bg-surface"
            }`}
          >
            <span className="flex h-[68px] w-full items-center justify-center">
              {entry.kind === "image" ? (
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
                  aria-hidden="true"
                >
                  <path d={KIND_ICONS[entry.kind]} />
                </svg>
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
