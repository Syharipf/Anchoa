import { useEffect, useState } from "react";
import { api, errorMessage, type TraySettings } from "../api";
import { useToast } from "../shell/toast";
import { H2, PANEL } from "../shell/ui";

export function TraySection({
  onChanged,
}: Readonly<{ onChanged?: () => void }>) {
  const toast = useToast();
  const [settings, setSettings] = useState<TraySettings | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const current = await api.traySettings();
      setSettings(current);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const handleToggle = async () => {
    if (!settings || loading) return;
    const next = !settings.closeToTray;
    setLoading(true);
    try {
      await api.saveCloseToTray(next);
      setSettings({ ...settings, closeToTray: next });
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setLoading(false);
    }
  };

  const closeToTray = settings?.closeToTray ?? true;
  const trayAvailable = settings?.trayAvailable ?? true;

  return (
    <section
      aria-labelledby="tray-integration-heading"
      className={`${PANEL} flex flex-col gap-3`}
    >
      <div className="flex items-center justify-between">
        <h2 id="tray-integration-heading" className={H2}>
          Baki sistem (Tray)
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            trayAvailable
              ? "bg-accent/15 text-accent"
              : "bg-surface-2 text-muted"
          }`}
        >
          {trayAvailable ? "Tersedia" : "Tidak terdeteksi"}
        </span>
      </div>

      <div className="flex flex-col gap-3 text-xs">
        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span
              id="lbl-close-to-tray"
              className="text-sm font-medium text-ink"
            >
              Tetap berjalan di tray saat jendela ditutup
            </span>
            <span className="text-muted">
              Saat jendela ditutup, aplikasi diminimalkan ke baki sistem dan
              tetap menjalankan pengingat, sinkronisasi, serta unduhan.
            </span>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={closeToTray}
            aria-labelledby="lbl-close-to-tray"
            disabled={loading}
            onClick={() => void handleToggle()}
            className={`flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
              closeToTray ? "bg-accent" : "bg-disabled"
            } ${loading ? "opacity-50" : ""}`}
          >
            <span
              className={`h-[18px] w-[18px] rounded-full transition-transform ${
                closeToTray
                  ? "translate-x-[18px] bg-canvas"
                  : "translate-x-0 bg-muted"
              }`}
            />
          </button>
        </div>

        {!trayAvailable && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-2.5 text-amber-200">
            Baki sistem tidak aktif di sesi desktop ini. Aplikasi akan langsung
            keluar saat jendela ditutup agar tidak meninggalkan proses yang
            tidak dapat diakses.
          </div>
        )}

        <p className="m-0 leading-relaxed text-muted">
          Catatan GNOME: Baki sistem memerlukan ekstensi AppIndicator
          (AppIndicator and KStatusNotifierItem Support). Jika baki sistem tidak
          tersedia di lingkungan desktop, Anchoa otomatis beralih ke mode keluar
          saat jendela ditutup. Untuk keluar sepenuhnya saat baki sistem aktif,
          gunakan opsi Keluar di menu baki sistem.
        </p>
      </div>
    </section>
  );
}
