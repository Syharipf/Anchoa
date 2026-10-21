import { formatSize } from "./view";

export function ActionBar({
  selectedCount,
  totalSizeBytes,
  onCopy,
  onMove,
  onTrash,
  onClear,
}: Readonly<{
  selectedCount: number;
  totalSizeBytes: number;
  onCopy: () => void;
  onMove: () => void;
  onTrash: () => void;
  onClear: () => void;
}>) {
  return (
    <div
      data-anim
      style={{ animation: "anchoa-pop 0.15s ease-out" }}
      className="flex shrink-0 items-center gap-3 border-t border-line bg-surface-2 px-3.5 py-2 pr-[88px] text-xs"
    >
      <span className="font-semibold text-ink">
        {selectedCount} item{selectedCount === 1 ? "" : "s"} <span className="font-mono font-normal text-muted">· {formatSize(totalSizeBytes)}</span>
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onCopy}
          className="min-h-[30px] rounded-lg border border-disabled px-2.5 text-xs text-ink transition-colors hover:bg-surface"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={onMove}
          className="min-h-[30px] rounded-lg border border-disabled px-2.5 text-xs text-ink transition-colors hover:bg-surface"
        >
          Move
        </button>
        <button
          type="button"
          onClick={onTrash}
          className="min-h-[30px] rounded-lg border border-danger px-2.5 text-xs text-danger transition-colors hover:bg-danger-row"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={onClear}
          className="min-h-[30px] rounded-lg px-2.5 text-xs text-muted transition-colors hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
