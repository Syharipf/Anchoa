import { useState, type KeyboardEvent } from "react";
import {
  api,
  errorMessage,
  type NewDownload,
} from "../api";
import { useToast } from "../shell/toast";
import {
  addLabel,
  detect,
  detectionInfo,
  DOWNLOAD_EXAMPLES,
  extractHost,
} from "./view";

const VIDEO_QUALITIES = ["2160p", "1080p", "720p", "480p"] as const;
const AUDIO_QUALITIES = ["320 kbps", "192 kbps", "128 kbps"] as const;
const VIDEO_FORMATS = ["MP4", "MKV", "WEBM"] as const;
const AUDIO_FORMATS = ["MP3", "M4A", "OPUS"] as const;

export function AddDownload({
  onAdded,
}: Readonly<{
  onAdded?: () => void;
}>) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [forcedMedia, setForcedMedia] = useState(false);
  const [isVideo, setIsVideo] = useState(true);
  const [vq, setVq] = useState<string>("1080p");
  const [aq, setAq] = useState<string>("192 kbps");
  const [vf, setVf] = useState<string>("MP4");
  const [af, setAf] = useState<string>("MP3");
  const [subtitles, setSubtitles] = useState(false);
  const [adding, setAdding] = useState(false);

  const detected = detect(url);
  const host = extractHost(url);
  const effectiveKind = detected === "media" || forcedMedia ? "media" : detected;
  const isMedia = effectiveKind === "media";
  const info = detectionInfo(effectiveKind === "media" ? "media" : detected, host);

  const canAdd =
    url.trim().length > 0 &&
    (effectiveKind === "media" || effectiveKind === "file") &&
    detected !== "torrent" &&
    detected !== "invalid";

  const buttonLabel = addLabel(effectiveKind === "media" ? "media" : detected, {
    audioOnly: !isVideo,
    quality: isVideo ? vq : aq,
    format: isVideo ? vf : af,
  });

  const handleAdd = async () => {
    if (!canAdd || adding) return;
    setAdding(true);
    try {
      const input: NewDownload = {
        url: url.trim(),
        kind: effectiveKind === "media" ? "media" : "file",
        options: isMedia
          ? {
              audioOnly: !isVideo,
              quality: isVideo ? vq : aq,
              format: isVideo ? vf : af,
              subtitles: isVideo ? subtitles : false,
            }
          : null,
      };
      await api.addDownload(input);
      setUrl("");
      setForcedMedia(false);
      onAdded?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setAdding(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleAdd();
    }
  };

  return (
    <section
      aria-labelledby="tambah-unduhan-judul"
      className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3.5"
    >
      <h2 id="tambah-unduhan-judul" className="sr-only">
        Tambah unduhan
      </h2>
      <div className="flex items-center gap-2.5">
        <label className="flex h-11 flex-1 min-w-0 items-center gap-2.5 rounded-lg border border-line bg-canvas px-3 focus-within:border-field-focus">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-muted"
            aria-hidden="true"
          >
            <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
            <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
          </svg>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tempel tautan video, audio, atau file…"
            aria-label="Tautan unduhan"
            className="flex-1 min-w-0 border-0 bg-transparent font-mono text-sm text-ink outline-none placeholder:text-muted"
          />
          <button
            type="button"
            onClick={() => {
              if (detected === "file") setForcedMedia((prev) => !prev);
            }}
            disabled={detected !== "file"}
            title={
              detected === "file"
                ? forcedMedia
                  ? "Paksa Media aktif (klik untuk batal)"
                  : "Klik untuk paksa Media (yt-dlp)"
                : undefined
            }
            className={`flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium ${info.color} ${
              detected === "file"
                ? "cursor-pointer hover:border hover:border-field-focus"
                : "cursor-default"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                effectiveKind === "media" || effectiveKind === "file"
                  ? "bg-accent"
                  : effectiveKind === "torrent" || effectiveKind === "invalid"
                    ? "bg-danger"
                    : "bg-muted"
              }`}
            />
            {forcedMedia ? "Media (dipaksa)" : info.label}
          </button>
        </label>
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={!canAdd || adding}
          className="flex h-11 shrink-0 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-canvas transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:bg-disabled disabled:text-muted disabled:hover:scale-100"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 4v11M7 10l5 5 5-5" />
            <path d="M5 20h14" />
          </svg>
          {adding ? "Menambahkan…" : buttonLabel}
        </button>
      </div>

      {isMedia && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div
            role="group"
            aria-label="Jenis unduhan"
            className="flex gap-0.5 rounded-lg border border-line bg-canvas p-0.5"
          >
            <button
              type="button"
              onClick={() => setIsVideo(true)}
              aria-pressed={isVideo}
              className={`min-h-7 rounded-md px-3 transition-colors ${
                isVideo ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink"
              }`}
            >
              Video
            </button>
            <button
              type="button"
              onClick={() => setIsVideo(false)}
              aria-pressed={!isVideo}
              className={`min-h-7 rounded-md px-3 transition-colors ${
                !isVideo ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink"
              }`}
            >
              Audio saja
            </button>
          </div>
          <div role="group" aria-label="Kualitas" className="flex gap-1">
            {(isVideo ? VIDEO_QUALITIES : AUDIO_QUALITIES).map((q) => {
              const active = (isVideo ? vq : aq) === q;
              return (
                <button
                  type="button"
                  key={q}
                  onClick={() => (isVideo ? setVq(q) : setAq(q))}
                  aria-pressed={active}
                  className={`min-h-7 rounded-lg border font-mono text-xs transition-colors ${
                    active
                      ? "border-field-focus bg-surface-2 text-ink"
                      : "border-line text-muted hover:bg-surface-2 hover:text-ink"
                  } px-2.5`}
                >
                  {q}
                </button>
              );
            })}
          </div>
          <span aria-hidden="true" className="h-5 w-px bg-line" />
          <div role="group" aria-label="Format" className="flex gap-1">
            {(isVideo ? VIDEO_FORMATS : AUDIO_FORMATS).map((f) => {
              const active = (isVideo ? vf : af) === f;
              return (
                <button
                  type="button"
                  key={f}
                  onClick={() => (isVideo ? setVf(f) : setAf(f))}
                  aria-pressed={active}
                  className={`min-h-7 rounded-lg border font-mono text-xs transition-colors ${
                    active
                      ? "border-field-focus bg-surface-2 text-ink"
                      : "border-line text-muted hover:bg-surface-2 hover:text-ink"
                  } px-2.5`}
                >
                  {f}
                </button>
              );
            })}
          </div>
          {isVideo && (
            <label className="flex cursor-pointer items-center gap-2 text-muted hover:text-ink">
              <input
                type="checkbox"
                checked={subtitles}
                onChange={(e) => setSubtitles(e.target.checked)}
                className="h-4 w-4 rounded accent-accent"
              />
              Subtitle
            </label>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="flex-1 min-w-0 truncate">{info.hint}</span>
        <span className="shrink-0">Contoh:</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {DOWNLOAD_EXAMPLES.map((ex) => (
            <button
              type="button"
              key={ex.label}
              onClick={() => {
                setUrl(ex.url);
                setForcedMedia(false);
              }}
              className="min-h-[26px] rounded-md border border-dashed border-disabled px-2 text-muted transition-colors hover:border-muted hover:text-ink"
            >
              {ex.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
