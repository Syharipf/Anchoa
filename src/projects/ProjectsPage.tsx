import { useEffect, useRef, useState } from "react";
import type { OpenAssistant } from "../assistant/useAssistantRequest";
import {
  api,
  errorMessage,
  type BoardFilter,
  type Priority,
  type ProjectDetail,
  type ProjectsOverview,
  type ProjectSummary,
  type TaskCard,
  type TaskStatus,
} from "../api";
import { useToast } from "../shell/toast";
import { H1, HEADER_PRIMARY, HEADER_SECONDARY } from "../shell/ui";
import { type MenuEntry } from "../shell/ContextMenu";
import { AgentTab } from "./AgentTab";
import { AgentThread } from "./AgentThread";
import { BoardFilterBar } from "./BoardFilterBar";
import { Kanban } from "./Kanban";
import { ProjectForm } from "./ProjectForm";
import { ProjectHeader } from "./ProjectHeader";
import { ProjectList } from "./ProjectList";
import { UpcomingList } from "./UpcomingList";
import { useProjectBoard } from "./useProjectBoard";
import { boardColumns, hasFilter, nextStatus } from "./view";

export function ProjectsPage({
  onOpenItem,
  onChanged,
  onOpenAssistant,
}: Readonly<{
  onOpenItem: (id: string) => void;
  onChanged: () => void;
  onOpenAssistant: OpenAssistant;
}>) {
  const toast = useToast();
  const [overview, setOverview] = useState<ProjectsOverview | null>(null);
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [formOpen, setFormOpen] = useState<{ edit?: ProjectDetail | null } | null>(null);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<"kanban" | "agent">("kanban");
  const [filter, setFilter] = useState<BoardFilter>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [panel, setPanel] = useState<Readonly<{ projectId: string; taskId: string; log: boolean }> | null>(null);
  const selectedProject = useRef(selectedId);
  selectedProject.current = selectedId;
  const openTaskId = panel && panel.projectId === selectedId && !panel.log ? panel.taskId : null;
  const { board, lastActors, activities, running } = useProjectBoard(selectedId, version, openTaskId, filter);
  const agentProject = board?.project?.agent ? board.project : null;
  const activeTab = agentProject ? tab : "kanban";
  const cards = board ? Object.values(board.columns).flat() : [];
  const panelTask = agentProject && panel?.projectId === agentProject.id
    ? cards.find((card) => card.id === panel.taskId) : undefined;
  // Runs log per task: prefer the task this page last sent, then the newest task an agent touched
  // or was asked to (UUIDv7 IDs sort by creation). The user's own moves and notes ("Kamu") are skipped.
  const lastRequests = useRef(new Map<string, string>());
  const ranByAgent = (id: string) => {
    const last = lastActors[id];
    return last !== undefined && (last.actor !== "Kamu" || last.role === "request");
  };
  const latestTask = cards.filter((card) => ranByAgent(card.id))
    .reduce<TaskCard | null>((latest, card) => !latest || card.id > latest.id ? card : latest, null);
  const sentTaskId = agentProject ? lastRequests.current.get(agentProject.id) : undefined;
  const logTaskId = (sentTaskId && cards.some((card) => card.id === sentTaskId) ? sentTaskId : null)
    ?? latestTask?.id ?? panelTask?.id ?? null;

  useEffect(() => {
    let active = true;
    api.projectsOverview().then(
      (data) => {
        if (!active) return;
        setOverview(data);
        setSelectedId((prev) => {
          if (prev === undefined) {
            return data.projects.length > 0 ? data.projects[0].id : null;
          }
          if (prev !== null && !data.projects.some((p) => p.id === prev)) {
            return data.projects.length > 0 ? data.projects[0].id : null;
          }
          return prev;
        });
      },
      (e) => { if (active) toast(errorMessage(e), "error"); },
    );
    return () => { active = false; };
  }, [version, toast]);

  if (!overview) {
    return <h1 className={H1}>Proyek</h1>;
  }

  async function handleMoveCard(card: TaskCard) {
    try {
      await api.updateTask(card.id, { status: nextStatus(card.status, agentProject !== null) });
      setVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }
  async function handleDropCard(card: TaskCard, status: TaskStatus) {
    try {
      await api.updateTask(card.id, { status });
      setVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function handleDeleteTask(card: TaskCard) {
    try {
      await api.deleteTask(card.id);
      setVersion((v) => v + 1);
      onChanged();
      toast(`Tugas "${card.title || "Tanpa judul"}" dihapus.`, "info", {
        label: "Urungkan",
        run: () => {
          void api.restoreTask(card.id).then(() => {
            setVersion((v) => v + 1);
            onChanged();
          }).catch((e) => toast(errorMessage(e), "error"));
        },
      });
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function handleLaunchTask(taskId: string) {
    if (!board?.project) return;
    try {
      await api.agentLaunchTask(board.project.id, taskId);
      setVersion((v) => v + 1);
      onChanged();
      toast("Agen mulai menjalankan tugas.");
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function handleSetPriority(card: TaskCard, priority: Priority | null) {
    try {
      await api.updateTask(card.id, { priority });
      setVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  function taskMenu(card: TaskCard): readonly MenuEntry[] {
    const entries: MenuEntry[] = [
      { label: "Buka", onSelect: () => handleOpenCard(card.id) },
      { label: "Pindah status", onSelect: () => void handleMoveCard(card) },
      "separator",
      { label: "Prioritas: Tanpa prioritas", checked: card.priority === null, onSelect: () => void handleSetPriority(card, null) },
      { label: "Prioritas: Tinggi", checked: card.priority === 1, onSelect: () => void handleSetPriority(card, 1) },
      { label: "Prioritas: Sedang", checked: card.priority === 2, onSelect: () => void handleSetPriority(card, 2) },
      { label: "Prioritas: Rendah", checked: card.priority === 3, onSelect: () => void handleSetPriority(card, 3) },
    ];
    if (board?.project?.agent) {
      entries.push(
        "separator",
        { label: "Jalankan dengan agen", onSelect: () => void handleLaunchTask(card.id) },
      );
    }
    entries.push(
      "separator",
      { label: "Hapus", danger: true, onSelect: () => void handleDeleteTask(card) },
    );
    return entries;
  }

  function projectMenu(project: ProjectSummary): readonly MenuEntry[] {
    return [
      {
        label: "Ubah",
        onSelect: async () => {
          try {
            const b = await api.projectBoard(project.id);
            if (b.project) setFormOpen({ edit: b.project });
          } catch (e) {
            toast(errorMessage(e), "error");
          }
        },
      },
      {
        label: "Hapus",
        danger: true,
        onSelect: () => setDeleteConfirm({ id: project.id, name: project.name }),
      },
    ];
  }

  async function confirmDeleteProject() {
    if (!deleteConfirm) return;
    const { id } = deleteConfirm;
    setDeleteConfirm(null);
    try {
      await api.deleteProject(id);
      if (selectedId === id) setSelectedId(undefined);
      setVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function handleCreateTask(title: string, status: TaskStatus) {
    try {
      await api.createTask({
        title,
        projectId: selectedId ?? null,
        status,
      });
      setVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  function handleSaved(id?: string) {
    setFormOpen(null);
    if (id) {
      setSelectedId(id);
    } else {
      setSelectedId(undefined);
    }
    setVersion((v) => v + 1);
    onChanged();
  }

  function handleAgentChanged() {
    setVersion((v) => v + 1);
    onChanged();
  }

  function handleAgentRequested(task: TaskCard) {
    if (task.projectId) lastRequests.current.set(task.projectId, task.id);
    if (task.projectId && selectedProject.current === task.projectId) {
      setPanel({ projectId: task.projectId, taskId: task.id, log: false });
    }
  }

  function handleOpenCard(id: string) {
    if (agentProject) setPanel({ projectId: agentProject.id, taskId: id, log: false });
    else onOpenItem(id);
  }

  function handleShowLog() {
    if (agentProject && logTaskId) {
      setTab("kanban");
      setPanel({ projectId: agentProject.id, taskId: logTaskId, log: true });
    }
  }

  return (
    <>
      <div className="flex items-center gap-3.5">
        <h1 className={H1}>Proyek</h1>
        <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-xs text-muted">
          {overview.activeCount} aktif
        </span>
        <div className="ml-auto flex gap-2.5">
          <button
            type="button"
            onClick={() => onOpenAssistant({ kind: "voice" })}
            className={`${HEADER_SECONDARY} flex items-center gap-2`}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="text-accent"
            >
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <path d="M12 18v3" />
            </svg>
            Tambah lewat suara
          </button>
          <button
            type="button"
            onClick={() => setFormOpen({})}
            className={`${HEADER_PRIMARY} flex items-center gap-2`}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Proyek
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)] items-start gap-[18px]">
        <div className="flex flex-col gap-3.5">
          <ProjectList
            projects={overview.projects}
            looseCount={overview.loose}
            selectedId={selectedId ?? null}
            onSelect={(id) => setSelectedId(id)}
            onCreateProject={() => setFormOpen({})}
            projectMenu={projectMenu}
          />
          <UpcomingList tasks={overview.upcoming} onOpenItem={onOpenItem} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-col gap-3.5 self-stretch">
          <ProjectHeader
            project={board?.project ?? null}
            looseCount={overview.loose}
            onEdit={() => board?.project && setFormOpen({ edit: board.project })}
            tab={activeTab}
            onTabChange={(t) => setTab(t)}
            running={running}
          />
          {activeTab === "agent" && agentProject ? (
            <AgentTab
              key={agentProject.id}
              project={agentProject}
              running={running}
              version={version}
              logAvailable={logTaskId !== null}
              onRequested={handleAgentRequested}
              onRefresh={handleAgentChanged}
              onShowLog={handleShowLog}
              onOpenTaskInKanban={(taskId) => {
                setTab("kanban");
                setPanel({ projectId: agentProject.id, taskId, log: false });
              }}
              onOpenItem={onOpenItem}
              onEditProject={() => setFormOpen({ edit: agentProject })}
            />
          ) : board ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3.5">
              <BoardFilterBar
                filter={filter}
                tags={board.tags}
                onChange={setFilter}
              />
              <div className="flex min-h-0 flex-1 gap-3.5">
                <Kanban
                  key={selectedId ?? "loose"}
                  columns={board.columns}
                  agent={agentProject !== null}
                  lastActors={lastActors}
                  repoUrl={board.project?.repoUrl ?? null}
                  onOpenItem={handleOpenCard}
                  onMoveCard={handleMoveCard}
                  onDropCard={handleDropCard}
                  cardMenu={taskMenu}
                  filtered={hasFilter(filter)}
                  onCreateTask={handleCreateTask}
                />
                {panelTask && (
                  <AgentThread
                    key={panelTask.id}
                    task={panelTask}
                    activities={activities}
                    showLog={panel?.log}
                    onChanged={handleAgentChanged}
                    onClose={() => setPanel(null)}
                    onOpenItem={onOpenItem}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-3 gap-3.5">
              {boardColumns(false).map(({ status }) => <div key={status} className="rounded-[14px] border border-line bg-stage p-3" />)}
            </div>
          )}
        </div>
      </div>

      {formOpen !== null && (
        <ProjectForm
          edit={formOpen.edit}
          onClose={() => setFormOpen(null)}
          onSaved={handleSaved}
        />
      )}
      {deleteConfirm !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-labelledby="hapus-proyek-judul" className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <h2 id="hapus-proyek-judul" className="m-0 text-base font-semibold text-ink">
              Hapus proyek?
            </h2>
            <p className="m-0 text-xs text-muted">
              Hapus proyek &ldquo;{deleteConfirm.name}&rdquo;? Tugasnya pindah ke Tugas lepas.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-2 transition-colors"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteProject()}
                className="rounded-lg bg-danger px-3 py-1.5 text-xs text-white hover:bg-danger/80 transition-colors"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
