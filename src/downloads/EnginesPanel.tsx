import type { EnginesInfo } from "../api";

/** Version on the right, or "Belum terpasang" (spec U1). A stale yt-dlp shows in warn colour. */
function EngineState({ version, stale = false }: Readonly<{ version?: string; stale?: boolean }>) {
  if (!version) return <span className="text-xs text-danger">Belum terpasang</span>;
  return <span className={`font-mono text-xs ${stale ? "text-warn" : "text-muted"}`}>{version}</span>;
}

export function EnginesPanel({
  engines,
}: Readonly<{
  engines: EnginesInfo | null;
}>) {
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

      {engines?.hint && <p className="select-text font-mono text-[11px] text-warn">{engines.hint}</p>}

    </section>
  );
}
