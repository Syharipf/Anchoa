import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OpenAssistant } from "../assistant/useAssistantRequest";
import { api, errorMessage, type Entry, type EntryKind, type EntryPatch } from "../api";
import type { SettingsSection } from "../settings/view";
import { useToast } from "../shell/toast";
import { MoodPicker } from "./MoodPicker";
import { TagInput } from "./TagInput";
import { KIND_META, tagsToText } from "./view";

const KINDS: readonly EntryKind[] = ["idea", "vent", "note"];
const AUTOSAVE_MS = 500;

type SaveState = "idle" | "saving" | "saved" | "failed";
type MicMode = "idle" | "recording" | "transcribing";
type TextPatch = { title?: string; body?: string };
type SaveQueue = {
  pending: TextPatch;
  timer?: number;
  saving?: Promise<boolean>;
  deleting: boolean;
};

function computeSaveText(saveState: SaveState, body: string): string {
  if (saveState === "saving") return "Menyimpan…";
  if (saveState === "failed") return "Gagal menyimpan";
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return `Tersimpan · ${words} kata`;
}

export function EntryEditor({
  entry,
  onEntryChanged,
  onOpenTask,
  onAfterSaved,
  onOpenAssistant,
  onDelete,
  onTagClick,
  onOpenSettings,
}: Readonly<{
  entry: Entry;
  onEntryChanged: (updated: Entry) => void;
  onOpenTask: (taskId: string) => void;
  onAfterSaved?: () => void;
  onOpenAssistant: OpenAssistant;
  onDelete: (id: string) => Promise<boolean | void> | boolean | void;
  onTagClick: (tag: string) => void;
  onOpenSettings?: (section?: SettingsSection) => void;
}>) {
  const toast = useToast();
  const [title, setTitle] = useState(entry.title);
  const [body, setBody] = useState(entry.body);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [converting, setConverting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [micMode, setMicMode] = useState<MicMode>("idle");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const queue = useMemo<SaveQueue>(() => ({ pending: {}, deleting: false }), [entry.id]);
  const currentId = useRef(entry.id);
  const afterSaved = useRef(onAfterSaved);
  afterSaved.current = onAfterSaved;

  // Each entry keeps its own save queue, including during navigation.
  useEffect(() => {
    if (currentId.current !== entry.id) {
      currentId.current = entry.id;
      setTitle(entry.title);
      setBody(entry.body);
      setSaveState("idle");
      setDeleting(false);
      if (micMode === "recording") {
        api.voiceRecordStop().catch(() => {});
        setMicMode("idle");
      }
    }
  }, [entry.id, entry.title, entry.body]);

  const flush = useCallback(async () => {
    window.clearTimeout(queue.timer);
    if (queue.saving) return queue.saving;
    if (Object.keys(queue.pending).length === 0) return true;
    queue.saving = (async () => {
      while (Object.keys(queue.pending).length > 0) {
        const patch = queue.pending;
        queue.pending = {};
        if (currentId.current === entry.id) setSaveState("saving");
        try {
          await api.updateItem(entry.id, patch);
        } catch {
          queue.pending = { ...patch, ...queue.pending };
          if (currentId.current === entry.id) setSaveState("failed");
          return false;
        }
      }
      if (currentId.current === entry.id) setSaveState("saved");
      afterSaved.current?.();
      return true;
    })().finally(() => { queue.saving = undefined; });
    return queue.saving;
  }, [entry.id, queue]);

  // Flush on unmount
  useEffect(() => () => void flush(), [flush]);

  // Stop recording on unmount
  useEffect(() => () => {
    if (micMode === "recording") api.voiceRecordStop().catch(() => {});
  }, [micMode]);

  function insertTranscript(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const textarea = textareaRef.current;
    if (!textarea) {
      handleBodyChange(body ? `${body} ${trimmed}` : trimmed);
      return;
    }
    const start = textarea.selectionStart ?? body.length;
    const end = textarea.selectionEnd ?? body.length;
    const before = body.slice(0, start);
    const after = body.slice(end);
    const separatorBefore = before && !before.endsWith(" ") && !before.endsWith("\n") ? " " : "";
    const separatorAfter = after && !after.startsWith(" ") && !after.startsWith("\n") ? " " : "";
    const newBody = `${before}${separatorBefore}${trimmed}${separatorAfter}${after}`;
    handleBodyChange(newBody);
  }

  async function handleToggleDictation() {
    if (micMode === "recording") {
      setMicMode("transcribing");
      try {
        const transcript = await api.voiceRecordStop();
        insertTranscript(transcript);
      } catch (e) {
        toast(errorMessage(e), "error");
      }
      setMicMode("idle");
      return;
    }
    if (micMode !== "idle") return;
    try {
      const status = await api.voiceStatus();
      if (!status.whisper || !status.whisperModel) {
        toast("Model Whisper belum terpasang", "error", { label: "Pengaturan", run: () => onOpenSettings?.("suara") });
        return;
      }
      await api.voiceRecordStart();
      setMicMode("recording");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  function handleTitleChange(val: string) {
    if (queue.deleting) return;
    setTitle(val);
    queue.pending = { ...queue.pending, title: val };
    window.clearTimeout(queue.timer);
    queue.timer = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  }

  function handleBodyChange(val: string) {
    if (queue.deleting) return;
    setBody(val);
    queue.pending = { ...queue.pending, body: val };
    window.clearTimeout(queue.timer);
    queue.timer = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  }

  async function handleEntryPatch(patch: EntryPatch) {
    if (queue.deleting) return;
    const saved = await flush();
    if (!saved || queue.deleting) return;
    try {
      const updated = await api.updateEntry(entry.id, patch);
      onEntryChanged(updated);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function handleConvertToTask() {
    if (queue.deleting) return;
    const saved = await flush();
    if (!saved || queue.deleting) return;
    setConverting(true);
    try {
      const updated = await api.entryToTask(entry.id);
      onEntryChanged(updated);
      toast("Tugas dibuat", "info", {
        label: "Buka",
        run: () => {
          if (updated.taskId) onOpenTask(updated.taskId);
        },
      });
      onAfterSaved?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setConverting(false);
    }
  }

  async function handleDelete() {
    if (queue.deleting) return;
    queue.deleting = true;
    setDeleting(true);
    let success = false;
    try {
      if (!await flush()) {
        toast("Entri belum dihapus karena perubahan gagal disimpan.", "error");
        return;
      }
      const ok = await onDelete(entry.id);
      success = ok !== false;
    } catch {
      success = false;
    } finally {
      if (!success) {
        queue.deleting = false;
        setDeleting(false);
      }
    }
  }

  const isIdea = entry.kind === "idea";
  const saveLabel = computeSaveText(saveState, body);

  return (
    <article
      aria-label="Editor entri"
      className="flex min-h-0 flex-1 flex-col gap-3.5 rounded-[14px] border border-line bg-surface p-5 overflow-y-auto"
    >
      {/* Kinds Segmented & Time */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <fieldset className="m-0 flex gap-1 rounded-[10px] bg-canvas p-1 border-0">
          <legend className="sr-only">Jenis entri</legend>
          {KINDS.map((k) => {
            const active = entry.kind === k;
            const meta = KIND_META[k];
            const bgClass = active ? "bg-surface-2 text-ink" : "text-muted hover:text-ink";
            return (
              <button
                key={k}
                type="button"
                disabled={deleting}
                aria-pressed={active}
                onClick={() => void handleEntryPatch({ kind: k })}
                className={`flex min-h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs transition-colors ${bgClass}`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={meta.icon} />
                </svg>
                <span>{meta.label}</span>
              </button>
            );
          })}
        </fieldset>

        <div className="flex items-center gap-1">
          <span className="mr-1 font-mono text-xs text-muted">{entry.when}</span>
          <button
            type="button"
            disabled={deleting}
            aria-pressed={entry.pinned}
            aria-label={entry.pinned ? "Lepas sematan" : "Sematkan"}
            title={entry.pinned ? "Lepas sematan" : "Sematkan"}
            onClick={() => void handleEntryPatch({ pinned: !entry.pinned })}
            className={`flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-surface-2 disabled:text-disabled ${entry.pinned ? "text-accent" : "text-muted hover:text-ink"}`}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill={entry.pinned ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
            </svg>
          </button>
          <button
            type="button"
            disabled={deleting || converting}
            aria-label="Hapus entri"
            title="Hapus entri"
            onClick={() => void handleDelete()}
            className="flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-danger disabled:text-disabled"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Title */}
      <input
        disabled={deleting}
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        onBlur={() => void flush()}
        placeholder="Judul (boleh kosong)"
        aria-label="Judul entri"
        className="border-0 bg-transparent p-0 font-display text-[22px] font-semibold text-ink outline-none placeholder:text-muted focus:outline-none"
      />

      {/* Body */}
      <textarea
        ref={textareaRef}
        disabled={deleting}
        value={body}
        onChange={(e) => handleBodyChange(e.target.value)}
        onBlur={() => void flush()}
        placeholder="Tulis apa saja — ide yang lewat, hal yang bikin kesal, atau sekadar catatan. Tidak ada yang menilai."
        aria-label="Isi entri"
        className="min-h-[220px] flex-1 resize-none border-0 bg-transparent p-0 text-[15px] leading-[1.7] text-ink outline-none placeholder:text-muted focus:outline-none"
      />

      {/* Tags */}
      <TagInput
        tags={entry.tags}
        disabled={deleting}
        onChange={(tags) => void handleEntryPatch({ tags: tagsToText(tags) })}
        onTagClick={onTagClick}
      />

      {/* Mood Picker */}
      <MoodPicker mood={entry.mood} disabled={deleting} onChange={(mood) => void handleEntryPatch({ mood })} />

      {/* Footer */}
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <span
          aria-live="polite"
          className={`min-w-0 flex-1 truncate text-xs ${
            saveState === "failed" ? "text-danger" : "text-muted"
          }`}
        >
          {saveLabel}
        </span>

        {isIdea && (
          entry.taskId ? (
            <button
              type="button"
              onClick={() => onOpenTask(entry.taskId!)}
              className="min-h-[34px] rounded-lg border border-[#4E6A26] bg-transparent px-3 text-[13px] text-accent transition-colors hover:bg-surface-2"
            >
              Buka tugas
            </button>
          ) : (
            <button
              type="button"
              disabled={converting || deleting}
              onClick={() => void handleConvertToTask()}
              className="min-h-[34px] rounded-lg border border-line bg-transparent px-3 text-[13px] text-ink transition-colors hover:bg-surface-2 disabled:text-disabled"
            >
              Jadikan tugas
            </button>
          )
        )}

        <button
          type="button"
          disabled={deleting || micMode === "transcribing"}
          aria-label={micMode === "recording" ? "Hentikan rekaman dikte" : undefined}
          onClick={() => void handleToggleDictation()}
          className={
            micMode === "recording"
              ? "flex min-h-[34px] items-center gap-1.5 rounded-lg border border-danger bg-transparent px-3 text-[13px] text-danger animate-pulse transition-colors hover:bg-danger-row"
              : "flex min-h-[34px] items-center gap-1.5 rounded-lg border border-line bg-transparent px-3 text-[13px] text-ink transition-colors hover:bg-surface-2 disabled:text-disabled"
          }
        >
          {micMode === "idle" && (
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
          )}
          {micMode === "idle" && "Dikte"}
          {micMode === "recording" && "Merekam…"}
          {micMode === "transcribing" && "Memproses…"}
        </button>

        <button
          type="button"
          disabled={!title.trim() && !body.trim()}
          onClick={() => onOpenAssistant({ kind: "speak", text: [title, body].filter((text) => text.trim()).join(". ") })}
          className="min-h-[34px] rounded-lg border border-line bg-transparent px-3 text-[13px] text-ink transition-colors hover:bg-surface-2 disabled:text-disabled"
        >
          Bacakan
        </button>

        <button
          type="button"
          onClick={() => onOpenAssistant({ kind: "compose", text: `Berikan tanggapan yang suportif untuk entri jurnal ini:\n\n${title || "Tanpa judul"}\n${body}` })}
          className="min-h-[34px] rounded-lg border border-[#4E6A26] bg-transparent px-3 text-[13px] text-accent transition-colors hover:bg-surface-2"
        >
          Minta tanggapan
        </button>
      </div>
    </article>
  );
}
