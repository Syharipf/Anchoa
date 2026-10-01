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
    if (!hasActive) return;
    const interval = setInterval(() => {
      void reloadList();
    }, 1000);
    return () => clearInterval(interval);
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
        <h1 className={H1}>Unduhan</h1>
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
          <span className="text-muted">{activeCount} aktif</span>
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
              Jeda semua
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
              Lanjutkan semua
            </>
          )}
        </button>
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-[minmax(0,1fr)_300px] gap-4.5">
        <div className="flex min-h-0 flex-col gap-3.5">
          <AddDownload onAdded={reloadList} />
          <DownloadQueue
            items={items}
            onPause={handlePause}
            onResume={handleResume}
            onRetry={handleRetry}
            onRemove={handleRemove}
            onOpen={handleOpen}
            onReveal={handleReveal}
          />
        </div>

        <aside
          aria-label="Mesin dan pengaturan unduhan"
          className="flex min-h-0 flex-col gap-3.5 overflow-y-auto"
        >
          <EnginesPanel engines={engines} />
          <DownloadSettingsPanel
            settings={settings}
            onSettingsChanged={setSettings}
          />
        </aside>
      </div>
    </>
  );
}
