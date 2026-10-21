import { FishProgress } from "../components/FishProgress";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  api,
  errorMessage,
  type Voice,
  type VoiceComponent,
  type VoiceInstallProgress,
  type VoiceParams,
  type VoiceStatus,
  type VoiceSettings,
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

  const [params, setParams] = useState<VoiceParams>({ lengthScale: 1, noiseScale: 0.667, noiseW: 0.8 });
  const { lengthScale, noiseScale, noiseW } = params;
  const mountedRef = useRef(true);
  const statusRequestRef = useRef(0);
  const settingsRequestRef = useRef(0);
  const savedSettingsRequestRef = useRef(0);
  const settingsRef = useRef<VoiceSettings | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const speechRequestRef = useRef(0);
  const speakingRef = useRef(false);
  const [micMode, setMicMode] = useState<"idle" | "starting" | "listening" | "transcribing">("idle");
  const micModeRef = useRef(micMode);
  const micRequestRef = useRef(0);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const applySettings = useCallback((settings: VoiceSettings) => {
    settingsRef.current = settings;
    setParams(settings.params);
    setStatus((prev) => prev ? {
      ...prev, settings,
      voices: prev.voices.map((voice) => voice.id === settings.id ? { ...voice, params: settings.params } : voice),
    } : prev);
  }, []);

  const loadStatus = useCallback(async () => {
    const request = ++statusRequestRef.current;
    const settingsRequest = settingsRequestRef.current;
    const settingsPending = savedSettingsRequestRef.current !== settingsRequest;
    try {
      const res = await api.voiceStatus();
      if (!mountedRef.current || request !== statusRequestRef.current) return null;
      const preserveSettings = settingsPending || settingsRequest !== settingsRequestRef.current ||
        savedSettingsRequestRef.current !== settingsRequestRef.current;
      const settings = preserveSettings && settingsRef.current ? settingsRef.current : res.settings;
      setStatus({ ...res, settings });
      applySettings(settings);
      return res;
    } catch {
      if (mountedRef.current && request === statusRequestRef.current &&
          settingsRequest === settingsRequestRef.current) setStatus((prev) => settingsRef.current ? prev : null);
      return null;
    } finally {
      if (mountedRef.current && request === statusRequestRef.current) setLoading(false);
    }
  }, [applySettings]);

  useEffect(() => {
    mountedRef.current = true;
    void loadStatus();
    return () => {
      mountedRef.current = false;
      statusRequestRef.current++;
      settingsRequestRef.current++;
      savedSettingsRequestRef.current = settingsRequestRef.current;
      speechRequestRef.current++;
      micRequestRef.current++;
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      if (speakingRef.current) void api.voiceStop().catch(() => {});
      if (micModeRef.current === "listening") void api.voiceRecordStop().catch(() => {});
    };
  }, [loadStatus]);

  const handleInstall = async (component: VoiceComponent) => {
    setInstallError(null);
    setInstalling((prev) => ({
      ...prev,
      [component]: { component, file: "", doneBytes: 0, totalBytes: null, stage: "downloading" },
    }));
    try {
      await api.voiceInstall(component, (progress) => {
        if (mountedRef.current) setInstalling((prev) => ({ ...prev, [component]: progress }));
      });
      if (!mountedRef.current) return;
      setInstalling((prev) => {
        const next = { ...prev };
        delete next[component];
        return next;
      });
      await loadStatus();
      if (!mountedRef.current) return;
      onChanged?.();
    } catch (e) {
      if (!mountedRef.current) return;
      setInstalling((prev) => {
        const next = { ...prev };
        delete next[component];
        return next;
      });
      setInstallError(errorMessage(e));
    }
  };

  const saveSettings = async (request: number, id: string, newParams?: VoiceParams) => {
    try {
      const updated = await (newParams ? api.setVoice(id, newParams) : api.setVoice(id));
      if (!mountedRef.current || request !== settingsRequestRef.current) return;
      savedSettingsRequestRef.current = request;
      applySettings(updated);
      onChanged?.();
    } catch (e) {
      if (mountedRef.current && request === settingsRequestRef.current) setInstallError(errorMessage(e));
    }
  };

  const handleSelectVoice = async (id: string) => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    const request = ++settingsRequestRef.current;
    const voice = status?.voices.find((v) => v.id === id);
    if (voice) applySettings({ id, params: voice.params });
    setInstallError(null);
    await saveSettings(request, id);
  };

  const handleParamChange = (key: keyof VoiceParams, value: number) => {
    if (!settingsRef.current) return;
    const settings = { ...settingsRef.current, params: { ...settingsRef.current.params, [key]: value } };
    const request = ++settingsRequestRef.current;
    applySettings(settings);
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void saveSettings(request, settings.id, settings.params);
    }, 300);
  };

  const handleImport = async () => {
    const settingsRequest = settingsRequestRef.current;
    setImportError(null);
    setImporting(true);
    try {
      const onnxPath = await api.pickVoiceModel();
      if (!mountedRef.current || !onnxPath) return;
      const importedId = await api.voiceImport(onnxPath);
      if (!mountedRef.current) return;
      const res = await loadStatus();
      if (!mountedRef.current) return;
      if (settingsRequest === settingsRequestRef.current && res?.voices.some((v) => v.id === importedId)) {
        await handleSelectVoice(importedId);
        if (!mountedRef.current) return;
      }
      onChanged?.();
    } catch (e) {
      if (mountedRef.current) setImportError(errorMessage(e));
    } finally {
      if (mountedRef.current) setImporting(false);
    }
  };

  const handleSpeakSample = async () => {
    if (micModeRef.current !== "idle" || speakingRef.current) return;
    const request = ++speechRequestRef.current;
    speakingRef.current = true;
    setSpeaking(true);
    try {
      await api.voiceSpeak(SAMPLE_TEXT);
    } catch {
      // Keep sample playback optional.
    } finally {
      if (mountedRef.current && request === speechRequestRef.current) {
        speakingRef.current = false;
        setSpeaking(false);
      }
    }
  };

  const handleStopSpeak = async () => {
    const request = ++speechRequestRef.current;
    try {
      await api.voiceStop();
    } catch {
      // The sample may already have finished.
    } finally {
      if (mountedRef.current && request === speechRequestRef.current) {
        speakingRef.current = false;
        setSpeaking(false);
      }
    }
  };

  const microphoneMissing = status ? [
    !status.pwRecord && "pw-record",
    !status.whisper && "whisper.cpp",
    !status.whisperModel && "Whisper Base model",
  ].filter(Boolean) : ["voice status"];

  const handleMicTest = async () => {
    if (!mountedRef.current || speakingRef.current || microphoneMissing.length > 0) return;
    if (micModeRef.current === "starting" || micModeRef.current === "transcribing") return;
    const request = ++micRequestRef.current;
    const current = () => mountedRef.current && request === micRequestRef.current;
    const setMode = (mode: typeof micMode) => {
      micModeRef.current = mode;
      setMicMode(mode);
    };
    setMicError(null);
    try {
      if (micModeRef.current === "listening") {
        setMode("transcribing");
        const text = await api.voiceRecordStop();
        if (!current()) return;
        setTranscript(text.trim() || "No speech detected. Try again.");
        setMode("idle");
      } else {
        setTranscript(null);
        setMode("starting");
        await api.voiceRecordStart();
        if (!current()) {
          await api.voiceRecordStop().catch(() => {});
          return;
        }
        setMode("listening");
      }
    } catch (e) {
      if (!current()) return;
      setMicError(errorMessage(e));
      setMode("idle");
    }
  };

  const activeVoiceId = status?.settings.id ?? "";
  const activeVoice = status?.voices.find((v) => v.id === activeVoiceId);
  const canSpeak = Boolean(status?.pwPlay && status.piper && activeVoice?.installed);

  const renderProgressBar = (progress: VoiceInstallProgress | null | undefined) => {
    if (!progress) return null;
    const percent =
      progress.totalBytes && progress.totalBytes > 0
        ? Math.min(100, Math.round((progress.doneBytes / progress.totalBytes) * 100))
        : null;

    const stageLabel =
      progress.stage === "downloading"
        ? `Downloading… ${percent !== null ? `(${percent}%)` : ""}`
        : progress.stage === "verified"
          ? "Verifying file…"
          : "Installing…";

    return (
      <div className="flex w-full flex-col gap-1 py-1">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{stageLabel}</span>
          {progress.totalBytes && progress.totalBytes > 0 && (
            <span className="font-mono">{percent}%</span>
          )}
        </div>
        <FishProgress
          value={percent ?? undefined}
          label={stageLabel}
          state="running"
          className="h-2 w-full"
        />
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <section className={PANEL}>
          <p className="m-0 text-sm text-muted">Loading voice settings…</p>
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
            aria-label="Close installation error message"
            onClick={() => setInstallError(null)}
            className="cursor-pointer font-semibold hover:underline"
          >
            Close
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
            aria-label="Close import error message"
            onClick={() => setImportError(null)}
            className="cursor-pointer font-semibold hover:underline"
          >
            Close
          </button>
        </div>
      )}

      {/* Status Komponen Suara */}
      <section aria-labelledby="heading-voice-status" className={PANEL}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 id="heading-voice-status" className={H2}>
              Voice Component Status
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
                    Audio Recorder (pw-record)
                  </span>
                </div>
                <span className="text-xs text-muted">
                  {status?.pwRecord ? "Available" : "Not found"}
                </span>
              </div>
              <span className="text-xs text-muted pl-4">
                PipeWire service to record 16 kHz mono audio from the microphone.
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
                  {status?.whisper ? "Installed" : "Not installed"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted pl-4">
                {status?.whisper ? (
                  <span>Detected on system ({status.whisper}).</span>
                ) : (
                  <span>Install whisper.cpp using your system package manager.</span>
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
                    Whisper Base Model (ggml-base.bin)
                  </span>
                </div>
                {status?.whisperModel ? (
                  <span className="text-xs text-muted">Installed</span>
                ) : (
                  !installing["whisper-model"] && (
                    <button
                      type="button"
                      aria-label="Install whisper base model"
                      onClick={() => handleInstall("whisper-model")}
                      className={`${PRIMARY} min-h-8 px-3 text-xs`}
                    >
                      Install
                    </button>
                  )
                )}
              </div>
              <span className="text-xs text-muted pl-4">
                148 MB speech recognition model for fast offline transcription on CPU.
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
                  <span className="text-xs text-muted">Installed</span>
                ) : (
                  !installing.piper && (
                    <button
                      type="button"
                      aria-label="Install Piper"
                      onClick={() => handleInstall("piper")}
                      className={`${PRIMARY} min-h-8 px-3 text-xs`}
                    >
                      Install
                    </button>
                  )
                )}
              </div>
              <span className="text-xs text-muted pl-4">
                Fast and natural local neural speech synthesis engine.
              </span>
              {renderProgressBar(installing.piper)}
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="heading-microphone-test" className={PANEL}>
        <div className="flex flex-col gap-3">
          <h2 id="heading-microphone-test" className={H2}>Microphone Test</h2>
          <p className="m-0 text-sm text-muted">
            Speak for a few seconds, then stop recording to see transcription.
          </p>
          {microphoneMissing.length > 0 && (
            <p className="m-0 text-xs text-warn">Microphone test requires: {microphoneMissing.join(", ")}.</p>
          )}
          <button
            type="button"
            aria-label={micMode === "listening" ? "Stop test recording" : "Test microphone"}
            disabled={microphoneMissing.length > 0 || speaking || micMode === "starting" || micMode === "transcribing"}
            onClick={handleMicTest}
            className={`${SECONDARY} self-start disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {micMode === "listening" ? "Stop test recording" : micMode === "starting" ? "Starting recording…" : micMode === "transcribing" ? "Transcribing…" : "Test microphone"}
          </button>
          {micMode === "listening" && <p className="m-0 text-xs text-danger" role="status">Listening…</p>}
          {transcript !== null && <p className="m-0 rounded-lg bg-surface-2 p-3 text-sm text-ink" role="status">{transcript}</p>}
          {micError && <p className="m-0 text-xs text-danger" role="alert">{micError}</p>}
        </div>
      </section>

      {/* Daftar Suara & Impor */}
      <section aria-labelledby="heading-voice-list" className={PANEL}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 id="heading-voice-list" className={H2}>
                Assistant Voice Choices
              </h2>
              <span className="text-xs text-muted">
                Select active voice or install from Piper catalog
              </span>
            </div>
            <button
              type="button"
              aria-label="Import voice"
              disabled={importing}
              onClick={handleImport}
              className={`${SECONDARY} min-h-8 px-3 text-xs cursor-pointer`}
            >
              {importing ? "Importing…" : "Import voice…"}
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
                          ? "Custom Model (Imported)"
                          : `${v.language} · quality ${v.quality}`}
                      </span>
                    </div>
                    {isActive && v.installed ? (
                      <span className="rounded-full bg-accent/20 px-2.5 py-0.5 text-xs font-semibold text-accent">
                        Active voice
                      </span>
                    ) : v.installed ? (
                      <button
                        type="button"
                        aria-label={`Select voice ${v.label}`}
                        onClick={() => handleSelectVoice(v.id)}
                        className={`${SECONDARY} min-h-7 px-2.5 text-xs cursor-pointer`}
                      >
                        Select
                      </button>
                    ) : (
                      !isVoiceInstalling && (
                        <button
                          type="button"
                          aria-label={`Install voice ${v.label}`}
                          onClick={() => handleInstall(`voice:${v.id}`)}
                          className={`${PRIMARY} min-h-7 px-2.5 text-xs`}
                        >
                          Install
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
              Active Voice Adjustment
            </h2>
            <span className="text-xs text-muted">
              Adjust speed, expression, and variation for voice {activeVoice?.label ?? "assistant"}
            </span>
          </div>

          <div className="flex flex-col gap-4">
            {/* Slider Kecepatan */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="slider-speed" className="font-medium text-ink">
                  Speed (length_scale)
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
                Note: higher values produce slower speech (0.8–1.3).
              </span>
            </div>

            {/* Slider Ekspresi */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="slider-expression" className="font-medium text-ink">
                  Expression (noise_scale)
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
                Level of voice intonation variation and expressiveness (0.3–0.9).
              </span>
            </div>

            {/* Slider Variasi */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="slider-variation" className="font-medium text-ink">
                  Variation (noise_w)
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
                Phoneme duration variation and pause rhythm (0.5–1.0).
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              aria-label="Test voice"
              disabled={speaking || !canSpeak}
              onClick={handleSpeakSample}
              className={`${PRIMARY} min-h-9 px-4 text-xs`}
            >
              {speaking ? "Playing sample…" : "Test voice"}
            </button>
            <button
              type="button"
              aria-label="Stop voice"
              disabled={!speaking}
              onClick={handleStopSpeak}
              className={`${SECONDARY} min-h-9 px-4 text-xs cursor-pointer`}
            >
              Stop
            </button>
            {!canSpeak && (
              <span className="text-xs text-warn">
                {!status?.piper
                  ? "Piper is not installed yet."
                  : "Install active voice first to try."}
              </span>
            )}
          </div>

          <div className="rounded-xl border border-line bg-surface-2/40 p-3">
            <p className="m-0 text-xs text-muted leading-relaxed">
              Assistant voice is processed entirely on the laptop using natural Piper neural models.
              Anchoa never uses espeak.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
