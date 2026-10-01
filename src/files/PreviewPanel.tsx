import { useEffect, useState, type ReactNode } from "react";
import {
  api,
  assetUrl,
  type FileEntry,
  type FileKind,
  type Listing,
  type TextPreview,
} from "../api";
import { PRIMARY } from "../shell/ui";
import { formatSize, KIND_ICONS, KIND_LABELS } from "./view";

function formatModDate(ms: number): string {
  if (!ms) return "-";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${dateStr}, ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}

function ImagePreview({ entry }: Readonly<{ entry: FileEntry }>) {
  return (
    <img
      src={assetUrl(entry.path)}
      alt={entry.name}
      className="h-full w-full object-contain"
    />
  );
}

function VideoPreview({ entry }: Readonly<{ entry: FileEntry }>) {
  return (
    <video
      controls
      preload="metadata"
      aria-label={`Video ${entry.name}`}
      src={assetUrl(entry.path)}
      className="h-full w-full object-contain"
    />
  );
}

function PdfPreview({ entry }: Readonly<{ entry: FileEntry }>) {
  return (
    <iframe
      title={entry.name}
      src={assetUrl(entry.path)}
      className="h-full w-full border-0"
    />
  );
}

function TextPreviewBody({ entry }: Readonly<{ entry: FileEntry }>) {
  const [data, setData] = useState<TextPreview | null>(null);

  useEffect(() => {
    setData(null);
    let active = true;
    api.readText(entry.path).then(
      (res) => {
        if (active) setData(res);
      },
      () => {
        if (active) setData(null);
      },
    );
    return () => {
      active = false;
    };
  }, [entry.path]);

  if (!data) {
    return (
      <div className="flex h-full w-full items-center justify-center p-3 text-xs text-muted">
        Memuat teks…
      </div>
    );
  }

  return (
    <pre className="h-full w-full overflow-auto p-3 font-mono text-[11px] leading-[1.55] text-[#c9ced8] whitespace-pre-wrap break-words">
      {data.text}
      {data.truncated ? "\n\n… dipotong" : ""}
    </pre>
  );
}

function FolderPreviewBody({ entry }: Readonly<{ entry: FileEntry }>) {
  const [listing, setListing] = useState<Listing | null>(null);

  useEffect(() => {
    setListing(null);
    let active = true;
    api.listDir(entry.path, false).then(
      (res) => {
        if (active) setListing(res);
      },
      () => {
        if (active) setListing(null);
      },
    );
    return () => {
      active = false;
    };
  }, [entry.path]);

  if (!listing) {
    return (
      <div className="flex h-full w-full items-center justify-center p-3 text-xs text-muted">
        Memuat folder…
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-1.5 overflow-y-auto p-3 text-xs text-[#c9ced8]">
      <span className="text-[11px] uppercase tracking-[0.08em] text-muted">
        Isi folder
      </span>
      {listing.entries.length === 0 ? (
        <span className="text-muted">Kosong</span>
      ) : (
        listing.entries.slice(0, 20).map((c) => (
          <span key={c.path} className="truncate">
            • {c.name}
          </span>
        ))
      )}
    </div>
  );
}

function OtherPreviewBody({ entry }: Readonly<{ entry: FileEntry }>) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted">
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={KIND_ICONS[entry.kind]} />
      </svg>
      <span>Pratinjau belum tersedia</span>
    </div>
  );
}

const PREVIEW_BODY: Record<FileKind, (entry: FileEntry) => ReactNode> = {
  image: (entry) => <ImagePreview entry={entry} />,
  video: (entry) => <VideoPreview entry={entry} />,
  pdf: (entry) => <PdfPreview entry={entry} />,
  text: (entry) => <TextPreviewBody entry={entry} />,
  folder: (entry) => <FolderPreviewBody entry={entry} />,
  other: (entry) => <OtherPreviewBody entry={entry} />,
};

export function PreviewPanel({
  entry,
  onClose,
  onOpen,
}: Readonly<{
  entry: FileEntry;
  onClose: () => void;
  onOpen: (entry: FileEntry) => void;
}>) {
  const sub =
    entry.kind === "folder" ? `${entry.size} item` : formatSize(entry.size);

  return (
    <aside
      data-anim
      style={{ animation: "anchoa-slide 0.18s ease-out" }}
      aria-label={`Pratinjau ${entry.name}`}
      className="flex w-[320px] shrink-0 flex-col gap-3.5 overflow-y-auto rounded-2xl border border-line bg-surface p-3.5"
    >
      <div className="flex items-center gap-2">
        <h2
          title={entry.name}
          className="m-0 min-w-0 flex-1 truncate font-display text-[15px] font-semibold text-ink"
        >
          {entry.name}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup pratinjau"
          title="Tutup pratinjau"
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="relative flex h-[212px] shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-line bg-sidebar">
        {PREVIEW_BODY[entry.kind](entry)}
      </div>

      <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-y-1.5 gap-x-2.5 text-xs">
        <dt className="text-muted">Jenis</dt>
        <dd className="m-0 break-words text-ink">{KIND_LABELS[entry.kind]}</dd>
        <dt className="text-muted">Ukuran</dt>
        <dd className="m-0 font-mono break-words text-ink">{sub}</dd>
        <dt className="text-muted">Diubah</dt>
        <dd className="m-0 font-mono break-words text-ink">
          {formatModDate(entry.modified)}
        </dd>
      </dl>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => onOpen(entry)}
          className={PRIMARY}
        >
          Buka
        </button>
        <button
          type="button"
          disabled
          className="flex min-h-9 items-center justify-center gap-2 rounded-[10px] border border-line text-xs text-muted disabled:opacity-50"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#c6f36b"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
          <span>Tanya asisten (hadir di Fase 5)</span>
        </button>
      </div>
    </aside>
  );
}
