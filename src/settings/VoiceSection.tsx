import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import {
  api,
  errorMessage,
  type Voice,
  type VoiceComponent,
  type VoiceInstallProgress,
  type VoiceParams,
  type VoiceStatus,
} from "../api";
import { H2, PANEL, PRIMARY, SECONDARY } from "../shell/ui";

export interface VoiceSectionProps {
  readonly onChanged?: () => void;
}

const SAMPLE_TEXT = "Halo! Aku Anchoa, asisten pribadimu. Senang bisa membantu.";

export function VoiceSection({ onChanged }: Readonly<VoiceSectionProps>) {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<Record<string, VoiceInstallProgress | null>>({});
  const [installError, setInstallError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // Sliders state
  const [lengthScale, setLengthScale] = useState(1.0);
  const [noiseScale, setNoiseScale] = useState(0.667);
  const [noiseW, setNoiseW] = useState(0.8);

  const loadStatus = useCallback(async () => {
    try {
      const res = await api.voiceStatus();
      setStatus(res);
      setLengthScale(res.settings.params.lengthScale);
      setNoiseScale(res.settings.params.noiseScale);
      setNoiseW(res.settings.params.noiseW);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleInstall = async (component: VoiceComponent) => {
    setInstallError(null);
    setInstalling((prev) => ({
      ...prev,
      [component]: {
        component,
        file: "",
        doneBytes: 0,
        totalBytes: null,
        stage: "downloading",
      },
    }));

    try {
      await api.voiceInstall(component, (progress) => {
        setInstalling((prev) => ({ ...prev, [component]: progress }));
      });
      setInstalling((prev) => {
        const next = { ...prev };
        delete next[component];
        return next;
      });
      await loadStatus();
      onChanged?.();
    } catch (e) {
      setInstalling((prev) => {
        const next = { ...prev };
        delete next[component];
        return next;
      });
      setInstallError(errorMessage(e));
    }
  };

  const handleSelectVoice = async (id: string) => {
    try {
      const updated = await api.setVoice(id);
      setStatus((prev) => (prev ? { ...prev, settings: updated } : prev));
      setLengthScale(updated.params.lengthScale);
      setNoiseScale(updated.params.noiseScale);
      setNoiseW(updated.params.noiseW);
      onChanged?.();
    } catch (e) {
      setInstallError(errorMessage(e));
    }
  };

  const handleParamChange = async (key: keyof VoiceParams, value: number) => {
    if (!status) return;
    const newParams: VoiceParams = {
      lengthScale: key === "lengthScale" ? value : lengthScale,
      noiseScale: key === "noiseScale" ? value : noiseScale,
      noiseW: key === "noiseW" ? value : noiseW,
    };
    setLengthScale(newParams.lengthScale);
    setNoiseScale(newParams.noiseScale);
    setNoiseW(newParams.noiseW);

    try {
      const updated = await api.setVoice(status.settings.id, newParams);
      setStatus((prev) => (prev ? { ...prev, settings: updated } : prev));
      onChanged?.();
    } catch (e) {
      setInstallError(errorMessage(e));
    }
  };

  const handleImport = async () => {
    setImportError(null);
    setImporting(true);
    try {
      const onnxPath = await api.pickVoiceModel();
      if (!onnxPath) {
        setImporting(false);
        return;
      }
      const importedId = await api.voiceImport(onnxPath);
      const res = await api.voiceStatus();
      setStatus(res);
      if (res.voices.some((v) => v.id === importedId)) {
        await handleSelectVoice(importedId);
      }
      onChanged?.();
    } catch (e) {
      setImportError(errorMessage(e));
    } finally {
      setImporting(false);
    }
  };

  const handleSpeakSample = async () => {
    setSpeaking(true);
    try {
      await api.voiceSpeak(SAMPLE_TEXT);
    } catch {
      // ignore
    } finally {
      setSpeaking(false);
    }
  };

  const handleStopSpeak = async () => {
    try {
      await api.voiceStop();
    } catch {
      // ignore
    } finally {
      setSpeaking(false);
    }
  };

  const activeVoiceId = status?.settings.id ?? "";
  const activeVoice = status?.voices.find((v) => v.id === activeVoiceId);
  const canSpeak = Boolean(status?.piper && activeVoice?.installed);

  const renderProgressBar = (progress: VoiceInstallProgress | null | undefined) => {
    if (!progress) return null;
    const percent =
      progress.totalBytes && progress.totalBytes > 0
        ? Math.min(100, Math.round((progress.doneBytes / progress.totalBytes) * 100))
        : null;

    const stageLabel =
      progress.stage === "downloading"
        ? `Mengunduh… ${percent !== null ? `(${percent}%)` : ""}`
        : progress.stage === "verified"
          ? "Memverifikasi berkas…"
          : "Memasang…";

    return (
      <div className="flex w-full flex-col gap-1 py-1">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{stageLabel}</span>
          {progress.totalBytes && progress.totalBytes > 0 && (
            <span className="font-mono">{percent}%</span>
          )}
        </div>
        <div
          aria-hidden="true"
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
        >
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: percent !== null ? `${percent}%` : "100%" }}
          />
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <section className={PANEL}>
          <p className="m-0 text-sm text-muted">Memuat pengaturan suara…</p>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {installError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger"
        >
          <span className="flex-1">{installError}</span>
          <button
            type="button"
            aria-label="Tutup pesan kesalahan instalasi"
            onClick={() => setInstallError(null)}
            className="cursor-pointer font-semibold hover:underline"
          >
            Tutup
          </button>
        </div>
      )}

      {importError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger"
        >
          <span className="flex-1">{importError}</span>
          <button
            type="button"
            aria-label="Tutup pesan kesalahan impor"
            onClick={() => setImportError(null)}
            className="cursor-pointer font-semibold hover:underline"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Status Komponen Suara */}
      <section aria-labelledby="heading-voice-status" className={PANEL}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 id="heading-voice-status" className={H2}>
              Status Komponen Suara
            </h2>
            <span className="text-xs text-muted">STT whisper.cpp &amp; TTS Piper</span>
          </div>

          <div className="flex flex-col divide-y divide-line">
            {/* Perekam (pw-record) */}
            <div className="flex flex-col gap-1 py-3 first:pt-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      status?.pwRecord ? "bg-accent" : "bg-danger"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium text-ink">
                    Perekam Audio (pw-record)
                  </span>
                </div>
                <span className="text-xs text-muted">
                  {status?.pwRecord ? "Tersedia" : "Tidak ditemukan"}
                </span>
              </div>
              <span className="text-xs text-muted pl-4">
                Layanan PipeWire untuk merekam audio 16 kHz mono dari mikrofon.
              </span>
            </div>

            {/* Binary whisper */}
            <div className="flex flex-col gap-1 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      status?.whisper ? "bg-accent" : "bg-warn"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium text-ink">
                    Binary whisper.cpp
                  </span>
                </div>
                <span className="text-xs text-muted">
                  {status?.whisper ? "Terpasang" : "Belum terpasang"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted pl-4">
                {status?.whisper ? (
                  <span>Terdeteksi di sistem ({status.whisper}).</span>
                ) : (
                  <span>
                    Pasang paket whisper di Fedora:{" "}
                    <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink select-all">
                      sudo dnf install whisper-cpp
                    </code>
                  </span>
                )}
              </div>
            </div>

            {/* Model whisper base */}
            <div className="flex flex-col gap-1.5 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      status?.whisperModel ? "bg-accent" : "bg-warn"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium text-ink">
                    Model Whisper Base (ggml-base.bin)
                  </span>
                </div>
                {status?.whisperModel ? (
                  <span className="text-xs text-muted">Terpasang</span>
                ) : (
                  !installing["whisper-model"] && (
                    <button
                      type="button"
                      aria-label="Pasang model whisper base"
                      onClick={() => handleInstall("whisper-model")}
                      className={`${PRIMARY} min-h-8 px-3 text-xs`}
                    >
                      Pasang
                    </button>
                  )
                )}
              </div>
              <span className="text-xs text-muted pl-4">
                Model pengenal suara 148 MB untuk transkripsi offline cepat di CPU.
              </span>
              {renderProgressBar(installing["whisper-model"])}
            </div>

            {/* Piper TTS */}
            <div className="flex flex-col gap-1.5 py-3 last:pb-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      status?.piper ? "bg-accent" : "bg-warn"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-medium text-ink">Piper TTS</span>
                </div>
                {status?.piper ? (
                  <span className="text-xs text-muted">Terpasang</span>
                ) : (
                  !installing.piper && (
                    <button
                      type="button"
                      aria-label="Pasang Piper"
                      onClick={() => handleInstall("piper")}
                      className={`${PRIMARY} min-h-8 px-3 text-xs`}
                    >
                      Pasang
                    </button>
                  )
                )}
              </div>
              <span className="text-xs text-muted pl-4">
                Mesin neural speech synthesis lokal yang cepat dan alami.
              </span>
              {renderProgressBar(installing.piper)}
            </div>
          </div>
        </div>
      </section>

      {/* Daftar Suara & Impor */}
      <section aria-labelledby="heading-voice-list" className={PANEL}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 id="heading-voice-list" className={H2}>
                Pilihan Suara Asisten
              </h2>
              <span className="text-xs text-muted">
                Pilih suara aktif atau pasang dari katalog Piper
              </span>
            </div>
            <button
              type="button"
              aria-label="Impor suara"
              disabled={importing}
              onClick={handleImport}
              className={`${SECONDARY} min-h-8 px-3 text-xs cursor-pointer`}
            >
              {importing ? "Mengimpor…" : "Impor suara…"}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {status?.voices.map((v: Voice) => {
              const isActive = v.id === activeVoiceId;
              const isVoiceInstalling = Boolean(installing[`voice:${v.id}`]);

              return (
                <div
                  key={v.id}
                  className={`flex flex-col justify-between gap-2 rounded-xl border p-3 transition-colors ${
                    isActive
                      ? "border-accent bg-surface-2"
                      : "border-line bg-surface hover:bg-surface-2/60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-ink">
                        {v.label}
                      </span>
                      <span className="text-xs text-muted">
                        {v.imported
                          ? "Model Kustom (Impor)"
                          : `${v.language} · kualitas ${v.quality}`}
                      </span>
                    </div>
                    {isActive ? (
                      <span className="rounded-full bg-accent/20 px-2.5 py-0.5 text-xs font-semibold text-accent">
                        Suara aktif
                      </span>
                    ) : v.installed ? (
                      <button
                        type="button"
                        aria-label={`Pilih suara ${v.label}`}
                        onClick={() => handleSelectVoice(v.id)}
                        className={`${SECONDARY} min-h-7 px-2.5 text-xs cursor-pointer`}
                      >
                        Pilih
                      </button>
                    ) : (
                      !isVoiceInstalling && (
                        <button
                          type="button"
                          aria-label={`Pasang suara ${v.label}`}
                          onClick={() => handleInstall(`voice:${v.id}`)}
                          className={`${PRIMARY} min-h-7 px-2.5 text-xs`}
                        >
                          Pasang
                        </button>
                      )
                    )}
                  </div>
                  {renderProgressBar(installing[`voice:${v.id}`])}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pengaturan Parameter Suara */}
      <section aria-labelledby="heading-voice-params" className={PANEL}>
        <div className="flex flex-col gap-4">
          <div>
            <h2 id="heading-voice-params" className={H2}>
              Penyesuaian Suara Aktif
            </h2>
            <span className="text-xs text-muted">
              Sesuaikan kecepatan, ekspresi, dan variasi untuk suara {activeVoice?.label ?? "asisten"}
            </span>
          </div>

          <div className="flex flex-col gap-4">
            {/* Slider Kecepatan */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="slider-speed" className="font-medium text-ink">
                  Kecepatan (length_scale)
                </label>
                <span className="font-mono text-muted">{lengthScale.toFixed(2)}</span>
              </div>
              <input
                id="slider-speed"
                type="range"
                min="0.8"
                max="1.3"
                step="0.05"
                value={lengthScale}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  handleParamChange("lengthScale", parseFloat(e.target.value))
                }
                className="accent-accent cursor-pointer"
              />
              <span className="text-[11px] text-muted">
                Catatan: nilai lebih tinggi menghasilkan bicara yang lebih lambat (0.8–1.3).
              </span>
            </div>

            {/* Slider Ekspresi */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="slider-expression" className="font-medium text-ink">
                  Ekspresi (noise_scale)
                </label>
                <span className="font-mono text-muted">{noiseScale.toFixed(2)}</span>
              </div>
              <input
                id="slider-expression"
                type="range"
                min="0.3"
                max="0.9"
                step="0.01"
                value={noiseScale}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  handleParamChange("noiseScale", parseFloat(e.target.value))
                }
                className="accent-accent cursor-pointer"
              />
              <span className="text-[11px] text-muted">
                Tingkat variasi intonasi suara dan ekspresivitas (0.3–0.9).
              </span>
            </div>

            {/* Slider Variasi */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="slider-variation" className="font-medium text-ink">
                  Variasi (noise_w)
                </label>
                <span className="font-mono text-muted">{noiseW.toFixed(2)}</span>
              </div>
              <input
                id="slider-variation"
                type="range"
                min="0.5"
                max="1.0"
                step="0.05"
                value={noiseW}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  handleParamChange("noiseW", parseFloat(e.target.value))
                }
                className="accent-accent cursor-pointer"
              />
              <span className="text-[11px] text-muted">
                Variasi durasi fonem dan ritme jeda bicara (0.5–1.0).
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              aria-label="Coba suara"
              disabled={speaking || !canSpeak}
              onClick={handleSpeakSample}
              className={`${PRIMARY} min-h-9 px-4 text-xs`}
            >
              {speaking ? "Memutar sampel…" : "Coba suara"}
            </button>
            <button
              type="button"
              aria-label="Hentikan suara"
              disabled={!speaking}
              onClick={handleStopSpeak}
              className={`${SECONDARY} min-h-9 px-4 text-xs cursor-pointer`}
            >
              Hentikan
            </button>
            {!canSpeak && (
              <span className="text-xs text-warn">
                {!status?.piper
                  ? "Piper belum dipasang."
                  : "Pasang suara aktif terlebih dahulu untuk mencoba."}
              </span>
            )}
          </div>

          <div className="rounded-xl border border-line bg-surface-2/40 p-3">
            <p className="m-0 text-xs text-muted leading-relaxed">
              Suara asisten diproses sepenuhnya di laptop menggunakan model neural
              Piper yang alami. Anchoa tidak pernah menggunakan espeak.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
