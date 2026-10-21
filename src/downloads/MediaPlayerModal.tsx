import { useEffect } from "react";
import { assetUrl } from "../api";
import { SECONDARY } from "../shell/ui";

export function MediaPlayerModal({
  title,
  filePath,
  isVideo,
  onClose,
}: Readonly<{
  title: string;
  filePath: string;
  isVideo: boolean;
  onClose: () => void;
}>) {
  const mediaSrc = assetUrl(filePath);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="player-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-fade"
    >
      <div className="flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        {/* Header bar */}
        <div className="flex items-center justify-between border-b border-line bg-surface-2 px-5 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/20 text-accent font-mono text-xs">
              {isVideo ? "▶" : "🎵"}
            </span>
            <h2
              id="player-title"
              className="truncate font-display text-sm font-semibold text-ink"
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close player"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-ink transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Media surface */}
        <div className="flex flex-col items-center justify-center bg-black p-4">
          {isVideo ? (
            <video
              controls
              autoPlay
              src={mediaSrc}
              className="max-h-[65vh] w-full rounded-lg object-contain"
            >
              <track kind="captions" />
              Your browser does not support this video.
            </video>
          ) : (
            <div className="flex w-full flex-col items-center gap-4 py-8">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-2 text-accent text-3xl">
                🎵
              </div>
              <audio controls autoPlay src={mediaSrc} className="w-full max-w-md">
                Your browser does not support this audio.
              </audio>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="flex items-center justify-between border-t border-line bg-surface-2 px-5 py-2.5 text-xs text-muted">
          <span className="truncate font-mono text-[11px]" title={filePath}>
            {filePath}
          </span>
          <button
            type="button"
            onClick={onClose}
            className={`${SECONDARY} py-1 text-xs`}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
