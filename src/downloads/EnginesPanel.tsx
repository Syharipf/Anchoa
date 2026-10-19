import { useEffect, useState } from "react";
import { api, type EnginesInfo, type NativeHostStatus } from "../api";

/** Version on the right, or "Belum terpasang" (spec U1). A stale yt-dlp shows in warn colour. */
function EngineState({ version, stale = false }: Readonly<{ version?: string; stale?: boolean }>) {
  if (!version) return <span className="text-xs text-danger">Belum terpasang</span>;
  return <span className={`font-mono text-xs ${stale ? "text-warn" : "text-muted"}`}>{version}</span>;
}

export function EnginesPanel({
  engines,
  onOpenBrowserSetup,
}: Readonly<{
  engines: EnginesInfo | null;
  onOpenBrowserSetup?: () => void;
}>) {
  const [browserStatus, setBrowserStatus] = useState<NativeHostStatus | null>(null);

  useEffect(() => {
    let active = true;
    api.nativeHostStatus().then(
      (st) => {
        if (active) setBrowserStatus(st);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);

  const connectedBrowsers: string[] = [];
  if (browserStatus?.chromeInstalled) {
    connectedBrowsers.push("Chrome / Chromium / Helium");
  }
  if (browserStatus?.firefoxInstalled) {
    connectedBrowsers.push("Firefox");
  }
  return (
    <section
      aria-labelledby="mesin-unduhan-judul"
      className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-3.5"
    >
      <h2 id="mesin-unduhan-judul" className="mb-1 text-sm font-semibold font-display text-ink">
        Mesin unduhan
      </h2>

      <div className="flex items-center gap-2.5 py-1.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-xs font-semibold text-accent">
          yt
        </span>
        <div className="flex flex-1 min-w-0 flex-col">
          <span className="font-mono text-xs font-medium text-ink">yt-dlp</span>
          <span className="truncate text-[11px] text-muted">Video & audio dari ribuan situs</span>
        </div>
        <EngineState version={engines?.ytdlp?.version} stale={engines?.ytdlp?.stale} />
      </div>

      <div className="flex items-center gap-2.5 py-1.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-xs font-semibold text-muted">
          ff
        </span>
        <div className="flex flex-1 min-w-0 flex-col">
          <span className="font-mono text-xs font-medium text-ink">ffmpeg</span>
          <span className="truncate text-[11px] text-muted">Gabung & konversi format</span>
        </div>
        {/* "ffmpeg version 8.1.3 Copyright ..." → "8.1.3" */}
        <EngineState version={engines?.ffmpeg?.version.match(/version (\S+)/)?.[1] ?? engines?.ffmpeg?.version} />
      </div>

      <div className="flex items-center gap-2.5 py-1.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-xs font-semibold text-muted">
          fl
        </span>
        <div className="flex flex-1 min-w-0 flex-col">
          <span className="font-mono text-xs font-medium text-ink">File langsung</span>
          <span className="truncate text-[11px] text-muted">Satu koneksi, bisa dilanjut</span>
        </div>
        <span className="text-xs text-muted">Bawaan</span>
      </div>

      <div className="flex items-center gap-2.5 py-1.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-xs font-semibold text-accent">
          ar
        </span>
        <div className="flex flex-1 min-w-0 flex-col">
          <span className="font-mono text-xs font-medium text-ink">aria2c &amp; Torrent</span>
          <span className="truncate text-[11px] text-muted">Akselerator 8 koneksi &amp; magnet</span>
        </div>
        <span className="text-xs text-accent font-mono font-medium">Aktif</span>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line/50 mt-1 pt-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-xs font-semibold text-ink">
            🌐
          </span>
          <div className="flex flex-1 min-w-0 flex-col">
            <span className="font-mono text-xs font-medium text-ink">Ekstensi Browser</span>
            <span className="truncate text-[11px] text-muted">
              {connectedBrowsers.length > 0
                ? `Terkoneksi: ${connectedBrowsers.join(", ")}`
                : "Chrome, Brave, Helium, Firefox"}
            </span>
          </div>
          {onOpenBrowserSetup && (
            <button
              type="button"
              onClick={onOpenBrowserSetup}
              className={`rounded-md border px-2 py-0.5 text-xs transition-colors ${
                connectedBrowsers.length > 0
                  ? "border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
                  : "border-line bg-surface-2 text-muted hover:border-accent hover:text-accent"
              }`}
            >
              {connectedBrowsers.length > 0 ? "Kelola ›" : "Pasang ›"}
            </button>
          )}
        </div>
        {connectedBrowsers.length > 0 && (
          <div className="flex flex-wrap gap-1 pl-9">
            {connectedBrowsers.map((b) => (
              <span
                key={b}
                className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {b}
              </span>
            ))}
          </div>
        )}
      </div>
      {engines?.hint && <p className="select-text font-mono text-[11px] text-warn">{engines.hint}</p>}

    </section>
  );
}
