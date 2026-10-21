import { useEffect, useState, type ReactNode } from "react";
import type { OpenAssistant } from "../assistant/useAssistantRequest";
import {
  api,
  assetUrl,
  type FileEntry,
  type FileKind,
  type Listing,
  type TextPreview,
} from "../api";
import { isRemotePath, listFolder } from "./remotes";
import { formatSize, KIND_ICONS, KIND_LABELS } from "./view";

function formatModDate(ms: number): string {
  if (!ms) return "-";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = d.toLocaleDateString("en-US", {
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

export function isArchive(name: string): boolean {
  return /\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i.test(name);
}

export function isAudio(name: string): boolean {
  return /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(name);
}

function AudioPreview({ entry }: Readonly<{ entry: FileEntry }>) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
      <svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-accent"
        aria-hidden="true"
      >
        <path d="M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0" />
      </svg>
      <audio controls src={assetUrl(entry.path)} className="w-full max-w-[260px]" />
    </div>
  );
}

function ArchivePreview({
  entry,
  onExtract,
}: Readonly<{ entry: FileEntry; onExtract?: (path: string) => void }>) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
      <svg
        width="38"
        height="38"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-accent"
        aria-hidden="true"
      >
        <path d="M4 4h16v16H4zM4 9h16M10 4v5" />
      </svg>
      <span className="font-medium text-xs text-ink">Archive File</span>
      <span className="text-[11px] text-muted">Can be extracted directly to folder</span>
      {onExtract && (
        <button
          type="button"
          onClick={() => onExtract(entry.path)}
          className="mt-1 flex h-7 items-center rounded-md bg-accent px-3 text-xs font-semibold text-canvas transition-colors hover:brightness-105"
        >
          Extract here
        </button>
      )}
    </div>
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
        Loading text…
      </div>
    );
  }

  return (
    <pre className="h-full w-full overflow-auto p-3 font-mono text-[11px] leading-[1.55] text-[#c9ced8] whitespace-pre-wrap break-words">
      {data.text}
      {data.truncated ? "\n\n… truncated" : ""}
    </pre>
  );
}

function FolderPreviewBody({ entry }: Readonly<{ entry: FileEntry }>) {
  const [listing, setListing] = useState<Listing | null>(null);

  useEffect(() => {
    setListing(null);
    let active = true;
    listFolder(entry.path, false).then(
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
        Loading folder…
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-1.5 overflow-y-auto p-3 text-xs text-[#c9ced8]">
      <span className="text-[11px] uppercase tracking-[0.08em] text-muted">
        Folder contents
      </span>
      {listing.entries.length === 0 ? (
        <span className="text-muted">Empty</span>
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
      <span>Preview not available</span>
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
  onOpenAssistant,
  children,
  onExtract,
}: Readonly<{
  entry: FileEntry;
  onClose: () => void;
  onOpen: (entry: FileEntry) => void;
  onOpenAssistant: OpenAssistant;
  /** Extra actions for this entry, e.g. folder markers. */
  children?: ReactNode;
  onExtract?: (path: string) => void;
}>) {
  const sub =
    entry.kind === "folder" ? `${entry.size} item` : formatSize(entry.size);

  return (
    <aside
      data-anim
      style={{ animation: "anchoa-slide 0.18s ease-out" }}
      aria-label={`Preview ${entry.name}`}
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
          aria-label="Close preview"
          title="Close preview"
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
        {isRemotePath(entry.path) && entry.kind !== "folder" ? (
          <OtherPreviewBody entry={entry} />
        ) : isAudio(entry.name) ? (
          <AudioPreview entry={entry} />
        ) : isArchive(entry.name) ? (
          <ArchivePreview entry={entry} onExtract={onExtract} />
        ) : (
          PREVIEW_BODY[entry.kind](entry)
        )}
      </div>
      <dl className="m-0 grid grid-cols-[88px_minmax(0,1fr)] gap-y-1.5 gap-x-2.5 text-xs">
        <dt className="text-muted">Kind</dt>
        <dd className="m-0 break-words text-ink">{KIND_LABELS[entry.kind]}</dd>
        <dt className="text-muted">Size</dt>
        <dd className="m-0 font-mono break-words text-ink">{sub}</dd>
        <dt className="text-muted">Modified</dt>
        <dd className="m-0 font-mono break-words text-ink">
          {formatModDate(entry.modified)}
        </dd>
      </dl>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => onOpen(entry)}
          className="flex h-8 items-center justify-center rounded-[9px] bg-accent px-4 text-xs font-semibold text-canvas transition-colors hover:brightness-105"
        >
          Open
        </button>
        {isArchive(entry.name) && onExtract && (
          <button
            type="button"
            onClick={() => onExtract(entry.path)}
            className="flex h-8 items-center justify-center rounded-[9px] border border-accent bg-accent/10 px-4 text-xs font-semibold text-accent transition-colors hover:bg-accent/20"
          >
            Extract Archive
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpenAssistant({ kind: "compose", text: `Help explain this file based on the following metadata:\nName: ${entry.name}\nLocation: ${entry.path}\nKind: ${KIND_LABELS[entry.kind]}\nSize: ${sub}\nModified: ${formatModDate(entry.modified)}` })}
          className="flex min-h-9 items-center justify-center gap-2 rounded-[10px] border border-line text-xs text-ink transition-colors hover:bg-surface-2"
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
          <span>Ask assistant</span>
        </button>
      </div>

      {children}
    </aside>
  );
}
