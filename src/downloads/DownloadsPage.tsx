import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  errorMessage,
  type DownloadSettings,
  type DownloadView,
  type EnginesInfo,
} from "../api";
import { useToast } from "../shell/toast";
import { H1 } from "../shell/ui";
import { AddDownload } from "./AddDownload";
import { DownloadQueue } from "./DownloadQueue";
import { DownloadSettingsPanel } from "./DownloadSettingsPanel";
import { EnginesPanel } from "./EnginesPanel";
import { formatSpeed } from "./view";
import { MediaPlayerModal } from "./MediaPlayerModal";
import { BrowserIntegrationModal } from "./BrowserIntegrationModal";
import { useClipboardCatch } from "./useClipboardCatch";
import { detect } from "./view";

export function DownloadsPage({
  onReveal,
}: Readonly<{
  onReveal?: (path: string) => void;
}>) {
  const toast = useToast();
  const [items, setItems] = useState<DownloadView[]>([]);
  const [speed, setSpeed] = useState<number>(0);
  const [activeCount, setActiveCount] = useState<number>(0);
  const [engines, setEngines] = useState<EnginesInfo | null>(null);
  const [settings, setSettings] = useState<DownloadSettings | null>(null);
  const [playingMedia, setPlayingMedia] = useState<{
    title: string;
    filePath: string;
    isVideo: boolean;
  } | null>(null);
  const [browserModalOpen, setBrowserModalOpen] = useState(false);

  const { detectedUrl, dismiss, clear } = useClipboardCatch();
  // An answer older than one already shown is dropped: a slow poll must not overwrite a later action.
  const requests = useRef(0);
  const applied = useRef(0);
  const reloadList = useCallback(async () => {
    const request = ++requests.current;
    try {
      const payload = await api.downloadsList();
      if (request < applied.current) return;
      applied.current = request;
      setItems(payload.items);
      setSpeed(payload.speed);
      setActiveCount(payload.active);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [toast]);

  // Initial load of downloads, engines, and settings
  useEffect(() => {
    let active = true;
    void reloadList();
    api.downloadEngines().then(
      (res) => {
        if (active) setEngines(res);
      },
      (e) => {
        if (active) toast(errorMessage(e), "error");
      },
    );
    api.downloadSettings().then(
      (res) => {
        if (active) setSettings(res);
      },
      (e) => {
        if (active) toast(errorMessage(e), "error");
      },
    );
    return () => {
      active = false;
    };
  }, [reloadList, toast]);

  // Poll downloadsList every 1000 ms while some item is queued, running, or processing
  const hasActive = items.some(
    (x) => x.status === "queued" || x.status === "running" || x.status === "processing",
  );

  useEffect(() => {
    // Refresh list immediately when app window gains focus
    const onFocus = () => void reloadList();
    window.addEventListener("focus", onFocus);

    // Poll faster (1s) when active downloads exist, or idle background poll (3s)
    // so new downloads from the browser extension appear in real-time
    const intervalTime = hasActive ? 1000 : 3000;
    const interval = setInterval(() => {
      void reloadList();
    }, intervalTime);

    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, [hasActive, reloadList]);

  const handlePause = async (id: string) => {
    try {
      await api.pauseDownload(id);
      void reloadList();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const handleResume = async (id: string) => {
    try {
      await api.resumeDownload(id);
      void reloadList();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await api.retryDownload(id);
      void reloadList();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await api.removeDownload(id);
      void reloadList();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const handleOpen = async (id: string) => {
    try {
      await api.openDownload(id);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const handleReveal = async (id: string) => {
    try {
      const folderPath = await api.revealDownload(id);
      onReveal?.(folderPath);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  // Queued rows count too: pausing only the running ones would let the queue start them.
  const isActive = (x: DownloadView) =>
    x.status === "running" || x.status === "queued" || x.status === "processing";
  const anyRunning = items.some(isActive);
  const anyPaused = items.some((x) => x.status === "paused");

  const handlePauseAll = async () => {
    const running = items.filter(isActive);
    await Promise.allSettled(running.map((x) => api.pauseDownload(x.id)));
    void reloadList();
  };

  const handleResumeAll = async () => {
    const paused = items.filter((x) => x.status === "paused");
    await Promise.allSettled(paused.map((x) => api.resumeDownload(x.id)));
    void reloadList();
  };

  return (
    <>
      <div className="flex items-center gap-3.5">
        <h1 className={H1}>Downloads</h1>
        <div
          aria-live="polite"
          className="flex items-center gap-2 font-mono text-xs"
        >
          <span className="flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-accent">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M6 13l6 6 6-6" />
            </svg>
            {formatSpeed(speed)}
          </span>
          <span className="text-muted">{activeCount} active</span>
        </div>

        <button
          type="button"
          onClick={() => (anyRunning ? void handlePauseAll() : void handleResumeAll())}
          disabled={!anyRunning && !anyPaused}
          className="ml-auto flex min-h-9 items-center gap-2 rounded-lg border border-line bg-transparent px-3.5 text-xs text-ink transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent"
        >
          {anyRunning ? (
            <>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
              Pause all
            </>
          ) : (
            <>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
              Resume all
            </>
          )}
        </button>
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-[minmax(0,1fr)_300px] gap-4.5">
        <div className="flex min-h-0 flex-col gap-3.5">
          {detectedUrl && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-accent/40 bg-surface-2 p-3 text-xs shadow-md">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent font-bold text-[10px]">
                  📋
                </span>
                <span className="text-muted shrink-0">Link in clipboard:</span>
                <span className="truncate font-mono font-medium text-ink" title={detectedUrl}>
                  {detectedUrl}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const url = detectedUrl;
                    clear();
                    try {
                      await api.addDownload({
                        url,
                        kind: detect(url) === "media" ? "media" : "file",
                        options: detect(url) === "media" ? { audioOnly: false, quality: "1080p", format: "MP4", subtitles: false } : null,
                      });
                      toast("Link from clipboard added");
                      void reloadList();
                    } catch (e) {
                      toast(errorMessage(e), "error");
                    }
                  }}
                  className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-canvas hover:bg-accent-hover transition-colors"
                >
                  Download Now
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          <AddDownload onAdded={reloadList} />
          <DownloadQueue
            items={items}
            onPause={handlePause}
            onResume={handleResume}
            onRetry={handleRetry}
            onRemove={handleRemove}
            onOpen={handleOpen}
            onReveal={handleReveal}
            onPlay={(row) => {
              if (row.filePath) {
                const isVideo = !row.options?.audioOnly && !/\.(mp3|m4a|flac|opus|wav|ogg)$/i.test(row.filePath);
                setPlayingMedia({
                  title: row.title,
                  filePath: row.filePath,
                  isVideo,
                });
              }
            }}
            onDropUrl={async (dropped) => {
              const trimmed = dropped.trim();
              if (!trimmed) return;
              try {
                const kind = detect(trimmed) === "media" ? "media" : "file";
                await api.addDownload({
                  url: trimmed,
                  kind,
                  options: kind === "media" ? { audioOnly: false, quality: "1080p", format: "MP4", subtitles: false } : null,
                });
                toast("Download added from drag & drop");
                void reloadList();
              } catch (e) {
                toast(errorMessage(e), "error");
              }
            }}
           />
        </div>

        <aside
          aria-label="Download engines and settings"
          className="flex min-h-0 flex-col gap-3.5 overflow-y-auto"
        >
          <EnginesPanel
            engines={engines}
            onOpenBrowserSetup={() => setBrowserModalOpen(true)}
          />
          <DownloadSettingsPanel
            settings={settings}
            onSettingsChanged={setSettings}
          />
        </aside>
      </div>
      {playingMedia && (
        <MediaPlayerModal
          title={playingMedia.title}
          filePath={playingMedia.filePath}
          isVideo={playingMedia.isVideo}
          onClose={() => setPlayingMedia(null)}
        />
      )}
      {browserModalOpen && (
        <BrowserIntegrationModal onClose={() => setBrowserModalOpen(false)} />
      )}
    </>
  );
}
