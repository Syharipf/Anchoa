import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { api, errorMessage, type UpdateCheck } from "../api";
import { useToast } from "../shell/toast";
import { H2, PANEL } from "../shell/ui";
import { sectionStatus, THIRD_PARTY_LICENSES } from "./view";

const REPO_URL = "https://github.com/Syharipf/Anchoa";
const RELEASES_URL = "https://github.com/Syharipf/Anchoa/releases";

export function AboutSection({ version: initialVersion }: Readonly<{ version?: string }>) {
  const toast = useToast();
  const [version, setVersion] = useState(initialVersion ?? "");
  const [checking, setChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheck | null>(null);

  useEffect(() => {
    if (initialVersion !== undefined) {
      setVersion(initialVersion);
    } else {
      getVersion().then(setVersion, () => setVersion(""));
    }
  }, [initialVersion]);

  async function handleCheckUpdate() {
    setChecking(true);
    setUpdateResult(null);
    try {
      const res = await api.checkUpdate();
      setUpdateResult(res);
      if (res.newer) {
        toast(`Version ${res.latest} available`);
      } else {
        toast("Already the latest version");
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setChecking(false);
    }
  }


  function openExternal(url: string) {
    api.openLink(url).catch((e) => toast(errorMessage(e), "error"));
  }

  const displayVersion = sectionStatus("about", { version });

  return (
    <div className="flex flex-col gap-4">
      {/* App version and update check */}
      <section className={`${PANEL} flex flex-col gap-3`}>
        <div className="flex items-center justify-between">
          <h2 className={H2}>Anchoa</h2>
          <span className="font-mono text-sm font-semibold text-accent">
            {displayVersion}
          </span>
        </div>

        <p className="m-0 text-xs text-muted">
          One app for finance, projects, tasks, schedule, notes, files, and downloads, interconnected and stored on your device.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleCheckUpdate()}
            disabled={checking}
            className="flex h-8 items-center gap-1.5 rounded-[9px] border border-line bg-surface px-3 text-xs text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {checking
              ? "Checking…"
              : updateResult?.newer
                ? `Version ${updateResult.latest} available`
                : updateResult
                  ? "Already the latest version"
                  : "Check for updates"}
          </button>

          {updateResult?.newer && (
            <button
              type="button"
              onClick={() => openExternal(updateResult.url || RELEASES_URL)}
              className="text-xs font-medium text-accent underline hover:text-accent/80"
            >
              Download update ›
            </button>
          )}
        </div>

        {/* Repository links */}
        <div className="flex flex-wrap items-center gap-4 pt-1 text-xs">
          <button
            type="button"
            onClick={() => openExternal(REPO_URL)}
            className="cursor-pointer text-accent hover:underline"
          >
            GitHub Repository
          </button>
          <span className="text-muted">·</span>
          <button
            type="button"
            onClick={() => openExternal(RELEASES_URL)}
            className="cursor-pointer text-accent hover:underline"
          >
            Release Notes
          </button>
        </div>

        <div className="flex flex-col gap-1.5 pt-1">
          <p className="m-0 text-xs text-muted">
            To update Anchoa, use your system package manager or download the latest release from GitHub.
          </p>
        </div>
      </section>

      {/* Third party licenses */}
      <section className={`${PANEL} flex flex-col gap-3`}>
        <h2 className={H2}>Third-party licenses</h2>
        <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface-2">
          {THIRD_PARTY_LICENSES.map((item) => (
            <div
              key={item.name}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-xs"
            >
              <span className="font-medium text-ink">{item.name}</span>
              <span className="font-mono text-muted">{item.license}</span>
              <button
                type="button"
                onClick={() => openExternal(item.url)}
                aria-label={`Open license or project website for ${item.name}`}
                className="cursor-pointer text-accent hover:underline"
              >
                {item.url.replace(/^https?:\/\//, "")}
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
