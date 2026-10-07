import { useEffect, useState } from "react";
import {
  api,
  errorMessage,
  type FileEntry,
  type FolderMeta,
  type FolderSummary,
} from "../api";
import { useToast } from "../shell/toast";
import { LABEL } from "../shell/ui";
import { isRemotePath } from "./remotes";
import { formatSize, KIND_LABELS } from "./view";

const MARKER_EMOJIS = ["📁", "⭐", "📷", "🎵", "🎬", "📚", "💼", "🔒"] as const;
const MARKER_COLORS = ["#c6f36b", "#7cc4ff", "#ffb547", "#ff6b6b", "#c79bff", "#5fd3a5"] as const;

const CHIP =
  "flex h-8 min-w-8 items-center justify-center rounded-lg border text-sm transition-colors";
const ACTION =
  "flex min-h-9 items-center justify-center rounded-[10px] border border-line px-3 text-xs text-ink transition-colors hover:bg-surface-2 disabled:opacity-50";

function SummaryView({ summary }: Readonly<{ summary: FolderSummary }>) {
  const prefix = summary.truncated ? "≥ " : "";
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-sidebar p-2.5 text-xs text-[#c9ced8]">
      <span>
        {prefix}
        {summary.files} berkas · {summary.folders} folder ·{" "}
        <span className="font-mono">{formatSize(summary.totalBytes)}</span>
      </span>
      {summary.byKind.map((k) => (
        <span key={k.kind} className="flex justify-between gap-2">
          <span>{KIND_LABELS[k.kind]}</span>
          <span className="font-mono text-muted">
            {k.count} · {formatSize(k.bytes)}
          </span>
        </span>
      ))}
      {summary.largest[0] && (
        <span className="truncate" title={summary.largest[0].path}>
          Terbesar: {summary.largest[0].name} ({formatSize(summary.largest[0].bytes)})
        </span>
      )}
      <span className={summary.duplicates.length > 0 ? "text-[#ffb547]" : "text-muted"}>
        {summary.duplicates.length > 0
          ? `${summary.duplicates.length} kelompok berkas kembar`
          : "Tidak ada berkas kembar"}
      </span>
    </div>
  );
}

/** Folder-only actions in the preview panel: marker, bookmark, summary, new tab. */
export function FolderTools({
  entry,
  meta,
  onMetaChange,
  onOpenTab,
}: Readonly<{
  entry: FileEntry;
  meta: FolderMeta | undefined;
  onMetaChange: (path: string, meta: FolderMeta | null) => void;
  onOpenTab: (path: string) => void;
}>) {
  const toast = useToast();
  const [summary, setSummary] = useState<FolderSummary | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const emoji = meta?.emoji ?? "";
  const color = meta?.color ?? "";
  const remote = isRemotePath(entry.path);

  useEffect(() => {
    setSummary(null);
  }, [entry.path]);

  function save(change: Promise<FolderMeta | null>) {
    change.then(
      (next) => onMetaChange(entry.path, next),
      (e) => toast(errorMessage(e), "error"),
    );
  }

  function setMarker(next: { emoji: string; color: string }) {
    save(api.folderMetaSet(entry.path, next));
  }

  function summarize() {
    setSummarizing(true);
    api.folderSummary(entry.path).then(
      (res) => {
        setSummary(res);
        setSummarizing(false);
      },
      (e) => {
        toast(errorMessage(e), "error");
        setSummarizing(false);
      },
    );
  }

  return (
    <section aria-label="Penanda folder" className="flex flex-col gap-2.5">
      <span className={LABEL}>Penanda</span>
      <div className="flex flex-wrap gap-1.5">
        {MARKER_EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            aria-label={`Penanda ${e}`}
            aria-pressed={emoji === e}
            onClick={() => setMarker({ emoji: emoji === e ? "" : e, color })}
            className={`${CHIP} ${emoji === e ? "border-field-focus bg-surface-2" : "border-line hover:bg-surface-2"}`}
          >
            {e}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {MARKER_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Warna ${c}`}
            aria-pressed={color === c}
            onClick={() => setMarker({ emoji, color: color === c ? "" : c })}
            className={`${CHIP} ${color === c ? "border-ink" : "border-line"}`}
          >
            <span aria-hidden="true" className="h-4 w-4 rounded-full" style={{ background: c }} />
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => save(api.folderMetaPin(entry.path, !meta?.pinned))}
          className={ACTION}
        >
          {meta?.pinned ? "Hapus dari Markah" : "Tambah ke Markah"}
        </button>
        <button
          type="button"
          disabled={!emoji && !color}
          onClick={() => save(api.folderMetaClear(entry.path))}
          className={ACTION}
        >
          Hapus penanda
        </button>
        <button type="button" onClick={() => onOpenTab(entry.path)} className={ACTION}>
          Buka di tab baru
        </button>
        {!remote && (
          <button type="button" disabled={summarizing} onClick={summarize} className={ACTION}>
            {summarizing ? "Menghitung…" : "Ringkasan folder"}
          </button>
        )}
      </div>
      {summary && <SummaryView summary={summary} />}
    </section>
  );
}
