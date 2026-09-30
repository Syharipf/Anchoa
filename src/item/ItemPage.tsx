import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage, type Item, type ItemPatch, type TaskDetail } from "../api";
import { parentLabel } from "../projects/view";
import { useToast } from "../shell/toast";
import { FIELD } from "../shell/ui";
import { Subtasks } from "./Subtasks";
import { TaskFields } from "./TaskFields";

type SaveState = "idle" | "saving" | "saved" | "failed";
const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  saving: "Menyimpan…",
  saved: "Tersimpan",
  failed: "Gagal menyimpan",
};
const AUTOSAVE_MS = 500;

export function ItemPage({
  id,
  onBack,
  onOpenItem,
}: Readonly<{
  id: string;
  onBack: () => void;
  onOpenItem: (id: string) => void;
}>) {
  const toast = useToast();
  const [item, setItem] = useState<Item | null>(null);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pending = useRef<ItemPatch>({});
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let active = true;
    api.openItem(id).then(
      async (it) => {
        if (!active) return;
        setItem(it);
        if (it.type === "task") {
          try {
            const t = await api.getTask(id);
            if (active) setTask(t);
          } catch (e) {
            if (active) setLoadError(errorMessage(e));
          }
        }
      },
      (e) => {
        if (active) setLoadError(errorMessage(e));
      }
    );
    return () => {
      active = false;
    };
  }, [id]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    pending.current = {};
    setSave("saving");
    try {
      await api.updateItem(id, patch);
      setSave("saved");
    } catch {
      // Keep the edit (newer edits win) so the next change retries it.
      pending.current = { ...patch, ...pending.current };
      setSave("failed");
    }
  }, [id]);

  // Save anything still pending when the page closes.
  useEffect(() => () => void flush(), [flush]);

  function change(patch: ItemPatch) {
    setItem((current) => (current ? { ...current, ...patch } : current));
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  }

  async function handleConvertToTask() {
    await flush();
    try {
      const detail = await api.convertToTask(id);
      const updated = await api.openItem(id);
      setItem(updated);
      setTask(detail);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function remove() {
    window.clearTimeout(timer.current);
    pending.current = {};
    try {
      if (item?.type === "task") {
        await api.deleteTask(id);
      } else {
        await api.deleteItem(id);
      }
      onBack();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  if (loadError) {
    return (
      <div className="flex max-w-3xl flex-col items-start gap-4">
        <p>{loadError}</p>
        <button onClick={onBack} className="text-sm text-accent hover:text-accent-hover">
          ← Kembali
        </button>
      </div>
    );
  }
  if (!item) return null;

  const isTask = item.type === "task";

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-3 text-sm">
        <button onClick={onBack} className="text-accent hover:text-accent-hover">
          ← Kembali
        </button>
        {isTask && task?.parentId && (
          <button
            type="button"
            onClick={() => onOpenItem(task.parentId!)}
            className="text-accent hover:text-accent-hover"
          >
            {parentLabel(task.parentTitle)}
          </button>
        )}
        {!isTask && (
          <button
            type="button"
            onClick={() => void handleConvertToTask()}
            className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink hover:bg-surface-2"
          >
            Jadikan tugas
          </button>
        )}
        <span aria-live="polite" className={`ml-auto ${save === "failed" ? "text-danger" : "text-muted"}`}>
          {SAVE_LABEL[save]}
        </span>
        {confirmDelete ? (
          <>
            <span>Hapus item ini?</span>
            <button onClick={() => void remove()} className="rounded-lg bg-danger px-2.5 py-1 font-semibold text-canvas">
              Ya, hapus
            </button>
            <button onClick={() => setConfirmDelete(false)}>Batal</button>
          </>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="text-danger">
            Hapus
          </button>
        )}
      </div>

      <input
        value={item.title}
        onChange={(e) => change({ title: e.target.value })}
        onBlur={() => void flush()}
        placeholder="Tanpa judul"
        aria-label="Judul"
        className="bg-transparent font-display text-[28px] font-semibold tracking-[-0.01em] outline-none placeholder:text-muted"
      />

      {isTask && task && (
        <TaskFields
          task={task}
          dueAt={item.dueAt}
          onTaskChange={setTask}
          onDueChange={(dueAt) => setItem((cur) => (cur ? { ...cur, dueAt } : cur))}
          onSaveState={setSave}
        />
      )}

      {isTask && task && !task.parentId && (
        <Subtasks
          parentId={id}
          subtasks={task.subtasks}
          onOpenItem={onOpenItem}
          onSubtasksChange={(subtasks) =>
            setTask((cur) => (cur ? { ...cur, subtasks } : cur))
          }
        />
      )}

      <textarea
        value={item.body}
        onChange={(e) => change({ body: e.target.value })}
        onBlur={() => void flush()}
        placeholder="Tulis dalam Markdown…"
        aria-label="Isi"
        className={`${FIELD} min-h-[50vh] resize-none p-4 font-mono placeholder:text-muted`}
      />
    </div>
  );
}
