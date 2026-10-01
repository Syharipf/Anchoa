import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { api, errorMessage, type UpdateCheck } from "../api";
import { useToast } from "../shell/toast";
import { H2, PANEL, SECONDARY } from "../shell/ui";
import { sectionStatus, THIRD_PARTY_LICENSES } from "./view";

const REPO_URL = "https://github.com/Syharipf/Anchoa";
const RELEASES_URL = "https://github.com/Syharipf/Anchoa/releases";
const UPGRADE_COMMAND = "sudo dnf upgrade anchoa";

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
        toast(`Versi ${res.latest} tersedia`);
      } else {
        toast("Sudah versi terbaru");
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setChecking(false);
    }
  }

  function handleCopyCommand() {
    if (navigator?.clipboard) {
      void navigator.clipboard.writeText(UPGRADE_COMMAND);
      toast("Perintah disalin ke clipboard");
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
          Satu aplikasi untuk keuangan, proyek, tugas, jadwal, catatan, berkas, dan unduhan, saling terhubung dan tersimpan di laptopmu.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleCheckUpdate()}
            disabled={checking}
            className={SECONDARY}
          >
            {checking
              ? "Memeriksa…"
              : updateResult?.newer
                ? `Versi ${updateResult.latest} tersedia`
                : updateResult
                  ? "Sudah versi terbaru"
                  : "Cek pembaruan"}
          </button>

          {updateResult?.newer && (
            <button
              type="button"
              onClick={() => openExternal(updateResult.url || RELEASES_URL)}
              className="text-xs font-medium text-accent underline hover:text-accent/80"
            >
              Unduh pembaruan ›
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
            Repositori GitHub
          </button>
          <span className="text-muted">·</span>
          <button
            type="button"
            onClick={() => openExternal(RELEASES_URL)}
            className="cursor-pointer text-accent hover:underline"
          >
            Catatan Rilis
          </button>
        </div>

        {/* CLI upgrade command */}
        <div className="flex flex-col gap-1.5 pt-1">
          <span className="text-xs text-muted">Pembaruan paket RPM:</span>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-ink">
            <code className="select-all">{UPGRADE_COMMAND}</code>
            <button
              type="button"
              onClick={handleCopyCommand}
              className="shrink-0 cursor-pointer rounded px-2 py-1 text-[11px] text-muted transition-colors hover:bg-surface hover:text-ink"
            >
              Salin
            </button>
          </div>
        </div>
      </section>

      {/* Third party licenses */}
      <section className={`${PANEL} flex flex-col gap-3`}>
        <h2 className={H2}>Lisensi pihak ketiga</h2>
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
                aria-label={`Buka lisensi atau situs ${item.name}`}
                className="cursor-pointer text-accent hover:underline"
              >
                Buka ↗
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
