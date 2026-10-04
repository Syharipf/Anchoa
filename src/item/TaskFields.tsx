import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Priority, type ProjectSummary, type TaskDetail, type TaskPatch, type TaskStatus } from "../api";
import { dateInputToMs, msToDateInput } from "../format";
import { Segmented } from "../finance/fields";
import { FIELD } from "../shell/ui";

const AUTOSAVE_MS = 500;

const STATUS_OPTIONS: readonly { value: TaskStatus; label: string }[] = [
  { value: "plan", label: "Rencana" },
  { value: "doing", label: "Dikerjakan" },
  { value: "done", label: "Selesai" },
];

export function TaskFields({
  task,
  dueAt,
  onTaskChange,
  onDueChange,
  onSaveState,
}: Readonly<{
  task: TaskDetail;
  dueAt: number | null;
  onTaskChange: (task: TaskDetail) => void;
  onDueChange: (dueAt: number | null) => void;
  onSaveState: (state: "idle" | "saving" | "saved" | "failed") => void;
}>) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [tag, setTag] = useState(task.tag ?? "");
  const tagTimer = useRef<number | undefined>(undefined);
  const pendingTag = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    api.projectsOverview().then(
      (res) => {
        if (active) setProjects(res.projects);
      },
      () => {}
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setTag(task.tag ?? "");
  }, [task.tag]);

  const saveTaskPatch = useCallback(
    async (patch: TaskPatch) => {
      onSaveState("saving");
      try {
        const updated = await api.updateTask(task.id, patch);
        onTaskChange(updated);
        onSaveState("saved");
      } catch {
        onSaveState("failed");
      }
    },
    [task.id, onSaveState, onTaskChange]
  );

  const flushTag = useCallback(async () => {
    window.clearTimeout(tagTimer.current);
    if (pendingTag.current === null) return;
    const value = pendingTag.current;
    pendingTag.current = null;
    const trimmed = value.trim();
    await saveTaskPatch({ tag: trimmed.length > 0 ? trimmed : null });
  }, [saveTaskPatch]);

  useEffect(() => () => void flushTag(), [flushTag]);

  function handleTagChange(value: string) {
    setTag(value);
    pendingTag.current = value;
    window.clearTimeout(tagTimer.current);
    tagTimer.current = window.setTimeout(() => void flushTag(), AUTOSAVE_MS);
  }

  async function handleStatusChange(status: TaskStatus) {
    await saveTaskPatch({ status });
  }

  async function handleProjectChange(projectId: string) {
    const next = projectId === "" ? null : projectId;
    await saveTaskPatch({ projectId: next });
  }

  async function handleStartAtChange(ms: number | null) {
    await saveTaskPatch({ startAt: ms });
  }
  async function handlePriorityChange(priority: Priority | null) {
    await saveTaskPatch({ priority });
  }


  async function handleDueAtChange(ms: number | null) {
    onSaveState("saving");
    try {
      await api.updateItem(task.id, { dueAt: ms });
      onDueChange(ms);
      onSaveState("saved");
    } catch {
      onSaveState("failed");
    }
  }

  const isSubtask = task.parentId !== null;

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-surface/40 p-3.5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted">Status</span>
          <Segmented
            label="Status tugas"
            options={STATUS_OPTIONS}
            value={task.status}
            onChange={(s) => void handleStatusChange(s)}
          />
        </div>

        <div className="flex items-center gap-2 text-xs text-muted">
          <label htmlFor="task-project">Proyek</label>
          <select
            id="task-project"
            value={task.projectId ?? ""}
            disabled={isSubtask}
            onChange={(e) => void handleProjectChange(e.target.value)}
            className={`${FIELD} py-1 px-2.5 text-xs disabled:opacity-50`}
          >
            <option value="">Tugas lepas</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs">
        <div className="flex items-center gap-2">
          <label htmlFor="task-start" className="text-muted">
            Mulai
          </label>
          <input
            id="task-start"
            type="date"
            value={msToDateInput(task.startAt)}
            onChange={(e) => void handleStartAtChange(dateInputToMs(e.target.value))}
            className={`${FIELD} py-1 px-2 font-mono text-xs ${task.startAt === null ? "text-disabled" : ""}`}
          />
          {task.startAt !== null && (
            <button
              type="button"
              onClick={() => void handleStartAtChange(null)}
              className="text-muted hover:text-ink"
            >
              Hapus
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="task-due" className="text-muted">
            Tenggat
          </label>
          <input
            id="task-due"
            type="date"
            value={msToDateInput(dueAt)}
            onChange={(e) => void handleDueAtChange(dateInputToMs(e.target.value))}
            className={`${FIELD} py-1 px-2 font-mono text-xs ${dueAt === null ? "text-disabled" : ""}`}
          />
          {dueAt !== null && (
            <button
              type="button"
              onClick={() => void handleDueAtChange(null)}
              className="text-muted hover:text-ink"
            >
              Hapus
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="task-tag" className="text-muted">
            Tag
          </label>
          <input
            id="task-tag"
            type="text"
            placeholder="Tag…"
            value={tag}
            onChange={(e) => handleTagChange(e.target.value)}
            onBlur={() => void flushTag()}
            className={`${FIELD} py-1 px-2.5 text-xs`}
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="task-priority" className="text-muted">
            Prioritas
          </label>
          <select
            id="task-priority"
            value={task.priority ?? ""}
            onChange={(e) => void handlePriorityChange(e.target.value ? (Number(e.target.value) as Priority) : null)}
            className={`${FIELD} py-1 px-2.5 text-xs`}
          >
            <option value="">Tanpa prioritas</option>
            <option value="1">Tinggi</option>
            <option value="2">Sedang</option>
            <option value="3">Rendah</option>
          </select>
        </div>
      </div>
    </div>
  );
}
