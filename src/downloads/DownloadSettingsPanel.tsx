import { useState, useEffect } from "react";
import {
  api,
  errorMessage,
  type DownloadSettings,
} from "../api";
import { useToast } from "../shell/toast";

const LIMIT_OPTIONS = [
  { label: "Tanpa batas", value: 0 },
  { label: "1 MB/s", value: 1048576 },
  { label: "5 MB/s", value: 5242880 },
  { label: "10 MB/s", value: 10485760 },
] as const;

export function DownloadSettingsPanel({
  settings,
  onSettingsChanged,
}: Readonly<{
  settings: DownloadSettings | null;
  onSettingsChanged?: (updated: DownloadSettings) => void;
}>) {
  const toast = useToast();
  const [editingDir, setEditingDir] = useState(false);
  const [dirInput, setDirInput] = useState(settings?.dir ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings?.dir) {
      setDirInput(settings.dir);
    }
  }, [settings?.dir]);

  const saveSettings = async (next: DownloadSettings) => {
    setSaving(true);
    try {
      const updated = await api.saveDownloadSettings(next);
      onSettingsChanged?.(updated);
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDir = async () => {
    if (!settings) return;
    const trimmed = dirInput.trim();
    if (!trimmed) {
      toast("Folder unduhan tidak boleh kosong", "error");
      return;
    }
    setSaving(true);
    try {
      const updated = await api.saveDownloadSettings({ ...settings, dir: trimmed });
      onSettingsChanged?.(updated);
      setEditingDir(false);
      toast("Folder unduhan diperbarui", "info");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleParallelChange = (parallel: number) => {
    if (!settings || parallel < 1 || parallel > 5) return;
    void saveSettings({ ...settings, parallel });
  };

  const handleLimitChange = (limit: number) => {
    if (!settings) return;
    void saveSettings({ ...settings, limit });
  };

  if (!settings) return null;

  return (
    <section
      aria-labelledby="pengaturan-unduhan-judul"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-3.5"
    >
      <h2 id="pengaturan-unduhan-judul" className="text-sm font-semibold font-display text-ink">
        Pengaturan
      </h2>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs text-ink">Simpan ke</span>
            {!editingDir && (
              <span
                title={settings.dir}
                className="truncate font-mono text-xs text-muted"
              >
                {settings.dir}
              </span>
            )}
          </div>
          {!editingDir && (
            <button
              type="button"
              onClick={() => setEditingDir(true)}
              className="min-h-7 rounded-md border border-line px-2.5 text-xs text-ink transition-colors hover:bg-surface-2"
            >
              Ubah
            </button>
          )}
        </div>
        {editingDir && (
          <div className="flex flex-col gap-2 pt-1">
            <input
              value={dirInput}
              onChange={(e) => setDirInput(e.target.value)}
              placeholder="Path folder unduhan…"
              aria-label="Path folder unduhan"
              className="w-full rounded-lg border border-line bg-canvas px-3 py-1.5 font-mono text-xs text-ink outline-none focus:border-field-focus"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDirInput(settings.dir);
                  setEditingDir(false);
                }}
                className="rounded-md px-2.5 py-1 text-xs text-muted transition-colors hover:text-ink"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleSaveDir()}
                disabled={saving}
                className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-canvas transition-colors disabled:opacity-50"
              >
                {saving ? "Menyimpan…" : "Simpan"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span id="bersamaan-label" className="text-xs text-ink">
          Unduhan bersamaan
        </span>
        <div
          role="group"
          aria-labelledby="bersamaan-label"
          className="flex items-center rounded-lg border border-line bg-canvas"
        >
          <button
            type="button"
            onClick={() => handleParallelChange(settings.parallel - 1)}
            disabled={settings.parallel <= 1 || saving}
            aria-label="Kurangi unduhan bersamaan"
            className="flex h-7 w-7 items-center justify-center rounded-l-lg text-xs text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-disabled"
          >
            −
          </button>
          <span
            aria-live="polite"
            className="min-w-6 text-center font-mono text-xs text-ink"
          >
            {settings.parallel}
          </span>
          <button
            type="button"
            onClick={() => handleParallelChange(settings.parallel + 1)}
            disabled={settings.parallel >= 5 || saving}
            aria-label="Tambah unduhan bersamaan"
            className="flex h-7 w-7 items-center justify-center rounded-r-lg text-xs text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-disabled"
          >
            +
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span id="batas-label" className="text-xs text-ink">
          Batas kecepatan
        </span>
        <div
          role="group"
          aria-labelledby="batas-label"
          className="flex flex-wrap gap-1 rounded-lg border border-line bg-canvas p-0.5"
        >
          {LIMIT_OPTIONS.map((opt) => {
            const active = settings.limit === opt.value;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => handleLimitChange(opt.value)}
                disabled={saving}
                aria-pressed={active}
                className={`min-h-6 flex-1 whitespace-nowrap rounded-md px-1 font-mono text-[11px] transition-colors ${
                  active
                    ? "bg-surface-2 font-medium text-ink"
                    : "text-muted hover:text-ink"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line pt-2.5">
        <span id="pantau-clipboard-label" className="text-xs text-ink">
          Pantau clipboard
        </span>
        <button
          type="button"
          role="switch"
          aria-checked="true"
          aria-labelledby="pantau-clipboard-label"
          className="flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full bg-accent p-0.5"
        >
          <span className="h-[18px] w-[18px] rounded-full bg-[#12151B] transition-transform translate-x-[18px]" />
        </button>
      </div>
    </section>
  );
}
