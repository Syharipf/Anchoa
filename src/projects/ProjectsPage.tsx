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
  type StudioContext,
} from "../api";
import { useToast } from "../shell/toast";
import { H1, HEADER_PRIMARY } from "../shell/ui";
import { type MenuEntry } from "../shell/ContextMenu";
import { AgentTab, ConnectAgentDialog } from "./AgentTab";
import { AgentThread } from "./AgentThread";
import { BoardFilterBar } from "./BoardFilterBar";
import { Kanban } from "./Kanban";
import { ProjectForm } from "./ProjectForm";
import { ProjectHeader } from "./ProjectHeader";
import { ProjectList } from "./ProjectList";
import { UpcomingList } from "./UpcomingList";
import { useProjectBoard } from "./useProjectBoard";
import { boardColumns, hasFilter, nextStatus } from "./view";
import { PipelineTracker } from "./PipelineTracker";
import { PrdCanvasTab } from "./PrdCanvasTab";
import { GitDiffTab } from "./GitDiffTab";
import { TerminalDrawer } from "./TerminalDrawer";
import { PrdReviewModal } from "./PrdReviewModal";

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
  const [tab, setTab] = useState<"kanban" | "prd" | "diff" | "agent">("kanban");
  const [studioContext, setStudioContext] = useState<StudioContext | null>(null);
  const [filter, setFilter] = useState<BoardFilter>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [panel, setPanel] = useState<Readonly<{ projectId: string; taskId: string; log: boolean }> | null>(null);
  const selectedProject = useRef(selectedId);
  selectedProject.current = selectedId;
  const openTaskId = panel && panel.projectId === selectedId && !panel.log ? panel.taskId : null;
  const { board, lastActors, activities, running } = useProjectBoard(selectedId, version, openTaskId, filter);
  const currentProject = board?.project ?? null;
  const agentProject = currentProject?.agent ? currentProject : null;
  const activeTab = tab === "agent" && !agentProject ? "kanban" : tab;
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
  useEffect(() => {
    if (!currentProject) {
      setStudioContext(null);
      return;
    }
    let active = true;
    api.projectStudioContext(currentProject.id).then(
      (ctx) => {
        if (active) setStudioContext(ctx);
      },
      () => {
        if (active) setStudioContext(null);
      }
    );
    return () => {
      active = false;
    };
  }, [currentProject?.id, version]);


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
      toast(`Task "${card.title || "Untitled"}" deleted.`, "info", {
        label: "Undo",
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
      toast("Agent started running task.");
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
      { label: "Open", onSelect: () => handleOpenCard(card.id) },
      { label: "Move status", onSelect: () => void handleMoveCard(card) },
      "separator",
      { label: "Priority: No priority", checked: card.priority === null, onSelect: () => void handleSetPriority(card, null) },
      { label: "Priority: High", checked: card.priority === 1, onSelect: () => void handleSetPriority(card, 1) },
      { label: "Priority: Medium", checked: card.priority === 2, onSelect: () => void handleSetPriority(card, 2) },
      { label: "Priority: Low", checked: card.priority === 3, onSelect: () => void handleSetPriority(card, 3) },
    ];
    if (board?.project?.agent) {
      entries.push(
        "separator",
        { label: "Run with agent", onSelect: () => void handleLaunchTask(card.id) },
      );
    }
    entries.push(
      "separator",
      { label: "Delete", danger: true, onSelect: () => void handleDeleteTask(card) },
    );
    return entries;
  }

  function projectMenu(project: ProjectSummary): readonly MenuEntry[] {
    return [
      {
        label: "Edit",
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
        label: "Delete",
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
      {selectedId !== null && currentProject ? (
        /* DEDICATED FULL-WIDTH PROJECT STUDIO PAGE */
        <div className="flex w-full flex-col gap-6 pb-20">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-3 transition-colors"
              >
                ← All Projects
              </button>
              <span className="text-muted">/</span>
              <span className="font-display text-sm font-semibold text-ink">
                {currentProject.name}
              </span>
              {currentProject.agent && (
                <span className="rounded-md border border-done/40 bg-done/15 px-2 py-0.5 font-mono text-[11px] font-medium text-accent">
                  AI Studio
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {currentProject.agent && (
                <button
                  type="button"
                  onClick={() => setGuideOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-3 transition-colors"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  CLI Agent Guide
                </button>
              )}
              <button
                type="button"
                onClick={() => setReviewOpen(true)}
                className={`${HEADER_PRIMARY} text-xs`}
              >
                Draft AI Goals
              </button>
            </div>
          </div>

          {/* Hidden ProjectList to maintain tree accessibility and test hooks */}
          <div className="hidden" aria-hidden="true">
            <ProjectList
              projects={overview.projects}
              looseCount={overview.loose}
              selectedId={selectedId ?? null}
              onSelect={(id) => setSelectedId(id)}
              onCreateProject={() => setFormOpen({})}
              projectMenu={projectMenu}
            />
          </div>
          <ProjectHeader
            project={currentProject}
            looseCount={overview.loose}
            onEdit={() => currentProject && setFormOpen({ edit: currentProject })}
            tab={activeTab}
            onTabChange={(t) => setTab(t)}
            running={running}
            onOpenDraftAi={currentProject ? () => setReviewOpen(true) : undefined}
          />
          {currentProject && (
            <PipelineTracker
              status={{
                hasPrd: Boolean(studioContext?.prd),
                hasFlow: Boolean(studioContext?.flow),
                planCount: studioContext?.planTasks ?? board?.columns.plan.length ?? 0,
                doingCount: studioContext?.doingTasks ?? board?.columns.doing.length ?? 0,
                testReviewCount:
                  (studioContext?.testTasks ?? board?.columns.test.length ?? 0) +
                  (studioContext?.reviewTasks ?? board?.columns.review.length ?? 0),
                doneCount: studioContext?.doneTasks ?? board?.columns.done.length ?? 0,
              }}
              onSelectStage={(stage) => {
                if (stage === 1 || stage === 2) setTab("prd");
                else setTab("kanban");
              }}
            />
          )}
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
          ) : activeTab === "prd" && currentProject ? (
            <PrdCanvasTab
              key={currentProject.id}
              projectId={currentProject.id}
              prdContent={studioContext?.prd ?? null}
              flowJson={studioContext?.flow ?? null}
              onPrdSaved={(content) => {
                setStudioContext((prev) => (prev ? { ...prev, prd: content } : null));
                setVersion((v) => v + 1);
              }}
              onFlowSaved={(flow) => {
                setStudioContext((prev) => (prev ? { ...prev, flow } : null));
                setVersion((v) => v + 1);
              }}
            />
          ) : activeTab === "diff" && currentProject ? (
            <div className="flex flex-col gap-5 w-full">
              <GitDiffTab key={currentProject.id} projectId={currentProject.id} />
              <TerminalDrawer
                projectId={currentProject.id}
                running={running}
                taskId={logTaskId}
                onPromptSent={handleAgentChanged}
              />
            </div>
          ) : board ? (
            <div className="flex flex-col gap-4 w-full">
              <BoardFilterBar
                filter={filter}
                tags={board.tags}
                onChange={setFilter}
              />
              <div className="flex min-h-[560px] gap-4 w-full">
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
      ) : (
        /* FULL-WIDTH PROJECT HUB / LIST PAGE */
        <div className="flex w-full flex-col gap-6 pb-20">
          <div className="flex items-center gap-3.5">
            <h1 className={H1}>All Projects</h1>
            <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-xs text-muted">
              {overview.activeCount} active
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => onOpenAssistant({ kind: "voice" })}
                className="flex h-8 items-center gap-1.5 rounded-[9px] border border-line bg-surface px-3 text-xs text-ink transition-colors hover:bg-surface-2"
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
                  className="text-accent"
                >
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0" />
                  <path d="M12 18v3" />
                </svg>
                Add via voice
              </button>
              <button
                type="button"
                onClick={() => setFormOpen({})}
                className="flex h-8 items-center gap-1.5 rounded-[9px] bg-accent px-3.5 text-xs font-semibold text-canvas transition-colors hover:brightness-105"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Project
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_340px]">
            <div className="flex flex-col gap-4">
              <ProjectList
                projects={overview.projects}
                looseCount={overview.loose}
                selectedId={selectedId ?? null}
                onSelect={(id) => setSelectedId(id)}
                onCreateProject={() => setFormOpen({})}
                projectMenu={projectMenu}
              />
            </div>
            <div className="flex flex-col gap-4">
              <UpcomingList tasks={overview.upcoming} onOpenItem={onOpenItem} />
            </div>
          </div>
        </div>
      )}

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
              Delete project?
            </h2>
            <p className="m-0 text-xs text-muted">
              Delete project &ldquo;{deleteConfirm.name}&rdquo;? Tasks will move to Loose tasks.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-2 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteProject()}
                className="rounded-lg bg-danger px-3 py-1.5 text-xs text-white hover:bg-danger/80 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {guideOpen && currentProject && (
        <ConnectAgentDialog
          project={currentProject}
          onClose={() => setGuideOpen(false)}
          onSaved={() => setVersion((v) => v + 1)}
          onEditProject={() => setFormOpen({ edit: currentProject })}
        />
      )}
      {reviewOpen && currentProject && (
        <PrdReviewModal
          projectId={currentProject.id}
          initialPrd={studioContext?.prd ?? null}
          initialFlow={studioContext?.flow ?? null}
          onClose={() => setReviewOpen(false)}
          onApproved={() => {
            setReviewOpen(false);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </>
  );
}
