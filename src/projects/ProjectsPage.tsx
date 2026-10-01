import { useEffect, useRef, useState } from "react";
import {
  api,
  errorMessage,
  type ProjectDetail,
  type ProjectsOverview,
  type TaskCard,
  type TaskStatus,
} from "../api";
import { useToast } from "../shell/toast";
import { H1, PRIMARY, SECONDARY } from "../shell/ui";
import { AgentTab } from "./AgentTab";
import { AgentThread } from "./AgentThread";
import { Kanban } from "./Kanban";
import { ProjectForm } from "./ProjectForm";
import { ProjectHeader } from "./ProjectHeader";
import { ProjectList } from "./ProjectList";
import { UpcomingList } from "./UpcomingList";
import { useProjectBoard } from "./useProjectBoard";
import { boardColumns, nextStatus } from "./view";

export function ProjectsPage({
  onOpenItem,
  onChanged,
}: Readonly<{
  onOpenItem: (id: string) => void;
  onChanged: () => void;
}>) {
  const toast = useToast();
  const [overview, setOverview] = useState<ProjectsOverview | null>(null);
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [formOpen, setFormOpen] = useState<{ edit?: ProjectDetail | null } | null>(null);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<"kanban" | "agent">("kanban");
  const [panel, setPanel] = useState<Readonly<{ projectId: string; taskId: string; log: boolean }> | null>(null);
  const selectedProject = useRef(selectedId);
  selectedProject.current = selectedId;
  const openTaskId = panel && panel.projectId === selectedId && !panel.log ? panel.taskId : null;
  const { board, lastActors, activities, running } = useProjectBoard(selectedId, version, openTaskId);
  const agentProject = board?.project?.agent ? board.project : null;
  const activeTab = agentProject ? tab : "kanban";
  const cards = board ? Object.values(board.columns).flat() : [];
  const panelTask = agentProject && panel?.projectId === agentProject.id
    ? cards.find((card) => card.id === panel.taskId) : undefined;
  // UUIDv7 task IDs sort by creation, so the log shortcut needs no thread history reads.
  const latestTask = cards.filter((card) => lastActors[card.id]).reduce<TaskCard | null>(
    (latest, card) => !latest || card.id > latest.id ? card : latest, null,
  );
  const logTaskId = latestTask?.id ?? panelTask?.id ?? null;

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
            disabled
            title="Hadir di Fase 5"
            className={`${SECONDARY} flex items-center gap-2 disabled:cursor-not-allowed disabled:text-disabled disabled:hover:bg-transparent`}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#C6F36B"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
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
            className={`${PRIMARY} flex items-center gap-2`}
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

      <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)] items-start gap-4">
        <div className="flex flex-col gap-3.5">
          <ProjectList
            projects={overview.projects}
            looseCount={overview.loose}
            selectedId={selectedId ?? null}
            onSelect={(id) => setSelectedId(id)}
            onCreateProject={() => setFormOpen({})}
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
            <div className="flex min-h-0 flex-1 gap-3.5">
              <Kanban
                key={selectedId ?? "loose"}
                columns={board.columns}
                agent={agentProject !== null}
                lastActors={lastActors}
                onOpenItem={handleOpenCard}
                onMoveCard={handleMoveCard}
                onCreateTask={handleCreateTask}
              />
              {panelTask && <AgentThread key={panelTask.id} task={panelTask} activities={activities}
                showLog={panel?.log} onChanged={handleAgentChanged} onClose={() => setPanel(null)} onOpenItem={onOpenItem} />}
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
    </>
  );
}
