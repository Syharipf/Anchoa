import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenAssistant } from "../assistant/useAssistantRequest";
import { api, errorMessage, type Entry, type EntryKind } from "../api";
import { useToast } from "../shell/toast";
import { MoodPicker } from "./MoodPicker";
import { TagInput } from "./TagInput";
import { KIND_META, tagsToText } from "./view";

const KINDS: readonly EntryKind[] = ["idea", "vent", "note"];
const AUTOSAVE_MS = 500;

type SaveState = "idle" | "saving" | "saved" | "failed";

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
}: Readonly<{
  entry: Entry;
  onEntryChanged: (updated: Entry) => void;
  onOpenTask: (taskId: string) => void;
  onAfterSaved?: () => void;
  onOpenAssistant: OpenAssistant;
}>) {
  const toast = useToast();
  const [title, setTitle] = useState(entry.title);
  const [body, setBody] = useState(entry.body);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [converting, setConverting] = useState(false);

  const pending = useRef<{ title?: string; body?: string }>({});
  const timer = useRef<number | undefined>(undefined);
  const currentId = useRef(entry.id);

  // When entry ID changes, flush previous edits and reset local inputs
  useEffect(() => {
    if (currentId.current !== entry.id) {
      currentId.current = entry.id;
      setTitle(entry.title);
      setBody(entry.body);
      setSaveState("idle");
      pending.current = {};
    }
  }, [entry.id, entry.title, entry.body]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    pending.current = {};
    setSaveState("saving");
    try {
      await api.updateItem(entry.id, patch);
      setSaveState("saved");
      onAfterSaved?.();
    } catch {
      pending.current = { ...patch, ...pending.current };
      setSaveState("failed");
    }
  }, [entry.id, onAfterSaved]);

  // Flush on unmount
  useEffect(() => () => void flush(), [flush]);

  function handleTitleChange(val: string) {
    setTitle(val);
    pending.current = { ...pending.current, title: val };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  }

  function handleBodyChange(val: string) {
    setBody(val);
    pending.current = { ...pending.current, body: val };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  }

  async function handleKindChange(kind: EntryKind) {
    await flush();
    try {
      const updated = await api.updateEntry(entry.id, { kind });
      onEntryChanged(updated);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function handleMoodChange(mood: number | null) {
    await flush();
    try {
      const updated = await api.updateEntry(entry.id, { mood });
      onEntryChanged(updated);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function handleTagsChange(newTags: string[]) {
    await flush();
    try {
      const updated = await api.updateEntry(entry.id, { tags: tagsToText(newTags) });
      onEntryChanged(updated);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function handleConvertToTask() {
    await flush();
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
                aria-pressed={active}
                onClick={() => void handleKindChange(k)}
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

        <span className="font-mono text-xs text-muted">{entry.when}</span>
      </div>

      {/* Title */}
      <input
        value={title}
        onChange={(e) => handleTitleChange(e.target.value)}
        onBlur={() => void flush()}
        placeholder="Judul (boleh kosong)"
        aria-label="Judul entri"
        className="border-0 bg-transparent p-0 font-display text-[22px] font-semibold text-ink outline-none placeholder:text-muted focus:outline-none"
      />

      {/* Body */}
      <textarea
        value={body}
        onChange={(e) => handleBodyChange(e.target.value)}
        onBlur={() => void flush()}
        placeholder="Tulis apa saja — ide yang lewat, hal yang bikin kesal, atau sekadar catatan. Tidak ada yang menilai."
        aria-label="Isi entri"
        className="min-h-[220px] flex-1 resize-none border-0 bg-transparent p-0 text-[15px] leading-[1.7] text-ink outline-none placeholder:text-muted focus:outline-none"
      />

      {/* Tags */}
      <TagInput tags={entry.tags} onChange={handleTagsChange} />

      {/* Mood Picker */}
      <MoodPicker mood={entry.mood} onChange={handleMoodChange} />

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
              disabled={converting}
              onClick={() => void handleConvertToTask()}
              className="min-h-[34px] rounded-lg border border-line bg-transparent px-3 text-[13px] text-ink transition-colors hover:bg-surface-2 disabled:text-disabled"
            >
              Jadikan tugas
            </button>
          )
        )}

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
