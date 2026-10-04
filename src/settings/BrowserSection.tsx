import { useEffect, useState } from "react";
import { api, errorMessage, type NativeHostStatus } from "../api";
import { useToast } from "../shell/toast";

export function BrowserSection({
  onChanged,
}: Readonly<{ onChanged?: () => void }>) {
  const toast = useToast();
  const [status, setStatus] = useState<NativeHostStatus | null>(null);
  const [chromeId, setChromeId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      const s = await api.nativeHostStatus();
      setStatus(s);
      if (s.chromeExtensionId) {
        setChromeId(s.chromeExtensionId);
      }
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const handleInstall = async (browser: string) => {
    setLoading(true);
    try {
      const s = await api.installNativeHost(browser, chromeId.trim() || null);
      setStatus(s);
      toast("Manifest integrasi browser berhasil dipasang", "info");
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  };

  const handleUninstall = async () => {
    setLoading(true);
    try {
      const s = await api.uninstallNativeHost();
      setStatus(s);
      toast("Manifest integrasi browser berhasil dicopot", "info");
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      aria-labelledby="browser-integration-heading"
      className="rounded-2xl border border-line bg-surface p-4"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3
            id="browser-integration-heading"
            className="text-sm font-semibold text-ink"
          >
            Integrasi Ekstensi Browser
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            Kirim unduhan dari Chrome, Chromium, Brave, dan Firefox langsung ke Anchoa.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
            status?.installed
              ? "bg-accent/10 text-accent"
              : "bg-surface-2 text-muted"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              status?.installed ? "bg-accent" : "bg-muted"
            }`}
          />
          {status?.installed ? "Terpasang" : "Belum terpasang"}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-3 text-xs">
        <div>
          <label htmlFor="chrome-ext-id" className="font-medium text-ink">
            ID Ekstensi Chrome (32 karakter a-p):
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="chrome-ext-id"
              type="text"
              value={chromeId}
              onChange={(e) => setChromeId(e.target.value)}
              placeholder="contoh: abcdefghijklmnopabcdefghijklmnop"
              maxLength={32}
              className="flex-1 rounded-lg border border-line bg-canvas px-3 py-1.5 font-mono text-xs text-ink placeholder:text-muted focus:border-field-focus focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleInstall("chrome")}
              disabled={loading || chromeId.trim().length !== 32}
              className="rounded-lg bg-surface-2 px-3 py-1.5 font-medium text-ink transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Pasang Chrome
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-line bg-canvas p-2.5">
          <div>
            <span className="font-medium text-ink">Mozilla Firefox</span>
            <p className="text-[11px] text-muted">
              Menggunakan ID ekstensi tetap: downloads@anchoa.local
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleInstall("firefox")}
            disabled={loading}
            className="rounded-lg bg-surface-2 px-3 py-1.5 font-medium text-ink transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Pasang Firefox
          </button>
        </div>

        {status?.installed && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => void handleUninstall()}
              disabled={loading}
              className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-1.5 font-medium text-danger transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Copot Semua Manifest
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
