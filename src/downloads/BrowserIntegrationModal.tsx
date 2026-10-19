import { useEffect, useState } from "react";
import { api, errorMessage, type NativeHostStatus } from "../api";
import { useToast } from "../shell/toast";
import { PRIMARY, SECONDARY } from "../shell/ui";

export function BrowserIntegrationModal({
  onClose,
}: Readonly<{
  onClose: () => void;
}>) {
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
      toast("Manifest integrasi browser berhasil dipasang");
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
      toast("Manifest integrasi browser berhasil dicopot");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="browser-int-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="flex w-full max-w-xl flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/20 text-accent font-mono text-xs">
              🌐
            </span>
            <h2 id="browser-int-title" className="font-display text-base font-semibold text-ink">
              Integrasi Browser &amp; Download Otomatis
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink transition-colors"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-muted leading-relaxed">
          Dengan memasang ekstensi, setiap kali mengklik tautan download di Chrome, Brave, atau Firefox, berkas otomatis dialihkan dan diunduh cepat lewat Anchoa (lengkap dengan pause/resume &amp; akselerator 8 koneksi).
        </p>

        {/* Step-by-step installation guide */}
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-canvas p-3.5 text-xs">
          <span className="font-semibold text-accent">Langkah 1: Pasang Ekstensi di Browser</span>
          <ol className="list-decimal pl-5 space-y-1 text-muted">
            <li>Buka halaman ekstensi browser: <code className="text-ink">chrome://extensions/</code> (Chrome/Brave/Helium) lalu aktifkan <b>Developer mode</b>.</li>
            <li>Klik <b>Load unpacked</b> lalu pilih folder <code className="text-ink">browser-extension/</code> di direktori repo Anchoa.</li>
            <li>Salin <b>ID Ekstensi</b> yang muncul (32 karakter huruf a-p).</li>
          </ol>
        </div>

        {/* Step 2: Register manifest */}
        <div className="flex flex-col gap-3 text-xs">
          <span className="font-semibold text-accent">Langkah 2: Hubungkan Manifest ke Anchoa</span>
          
          <div>
            <label htmlFor="chrome-id-input" className="block text-muted mb-1 font-medium">
              ID Ekstensi Chrome / Chromium / Brave / Helium:
            </label>
            <div className="flex gap-2">
              <input
                id="chrome-id-input"
                type="text"
                value={chromeId}
                onChange={(e) => setChromeId(e.target.value)}
                placeholder="tempel 32 karakter ID ekstensi..."
                maxLength={32}
                className="flex-1 rounded-lg border border-line bg-canvas px-3 py-1.5 font-mono text-xs text-ink placeholder:text-muted focus:border-field-focus focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleInstall("chrome")}
                disabled={loading || chromeId.trim().length !== 32}
                className={`${PRIMARY} py-1 text-xs`}
              >
                Hubungkan Chromium/Helium
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-line bg-canvas p-2.5">
            <div>
              <span className="font-medium text-ink">Mozilla Firefox</span>
              <p className="text-[11px] text-muted">
                Load temporary add-on via <code className="text-ink">about:debugging</code>
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleInstall("firefox")}
              disabled={loading}
              className={`${SECONDARY} py-1 text-xs`}
            >
              Hubungkan Firefox
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-line pt-3 mt-1">
          {status?.installed && (
            <button
              type="button"
              onClick={() => void handleUninstall()}
              disabled={loading}
              className="text-xs text-danger hover:underline"
            >
              Copot Manifest
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className={`${SECONDARY} ml-auto py-1 px-4 text-xs`}
          >
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
}
