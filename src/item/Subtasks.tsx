import { useState, type KeyboardEvent } from "react";
import { api, errorMessage, type TaskCard } from "../api";
import { toggleTaskStatus } from "../projects/view";
import { useToast } from "../shell/toast";
import { FIELD } from "../shell/ui";

export function Subtasks({
  parentId,
  subtasks,
  onOpenItem,
  onSubtasksChange,
}: Readonly<{
  parentId: string;
  subtasks: TaskCard[];
  onOpenItem: (id: string) => void;
  onSubtasksChange: (subtasks: TaskCard[]) => void;
}>) {
  const toast = useToast();
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);

  async function handleToggle(sub: TaskCard) {
    const next = toggleTaskStatus(sub.status);
    try {
      await api.updateTask(sub.id, { status: next });
      onSubtasksChange(
        subtasks.map((s) => (s.id === sub.id ? { ...s, status: next } : s))
      );
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function handleAdd() {
    const trimmed = newTitle.trim();
    if (!trimmed || adding) return;
    setAdding(true);
    try {
      const created = await api.createTask({
        title: trimmed,
        parentId,
        status: "plan",
      });
      onSubtasksChange([...subtasks, created]);
      setNewTitle("");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setAdding(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleAdd();
    }
  }

  const doneCount = subtasks.filter((s) => s.status === "done").length;

  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface/30 p-3.5">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
        <span>Sub-tugas</span>
        {subtasks.length > 0 && (
          <span className="font-mono text-[11px] font-normal lowercase tracking-normal">
            ({doneCount}/{subtasks.length})
          </span>
        )}
      </div>

      {subtasks.length > 0 && (
        <div className="flex flex-col gap-1">
          {subtasks.map((sub) => (
            <div
              key={sub.id}
              className="flex items-center gap-2.5 rounded-lg px-2 py-1 transition-colors hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={sub.status === "done"}
                onChange={() => void handleToggle(sub)}
                aria-label={`Tandai ${sub.status === "done" ? "belum selesai" : "selesai"}: ${sub.title}`}
                className="h-4 w-4 rounded border-line accent-accent cursor-pointer"
              />
              <button
                type="button"
                onClick={() => onOpenItem(sub.id)}
                className={`flex-1 text-left text-sm ${
                  sub.status === "done" ? "line-through text-muted" : "text-ink hover:text-accent"
                }`}
              >
                {sub.title}
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        type="text"
        placeholder="Tambah sub-tugas…"
        value={newTitle}
        disabled={adding}
        onChange={(e) => setNewTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Tambah sub-tugas"
        className={`${FIELD} py-1.5 px-3 text-sm`}
      />
    </div>
  );
}
