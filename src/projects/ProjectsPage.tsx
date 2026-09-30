import { useEffect, useState } from "react";
import {
  api,
  errorMessage,
  type Board,
  type ProjectDetail,
  type ProjectsOverview,
  type TaskCard,
  type TaskStatus,
} from "../api";
import { useToast } from "../shell/toast";
import { H1, PRIMARY, SECONDARY } from "../shell/ui";
import { Kanban } from "./Kanban";
import { ProjectForm } from "./ProjectForm";
import { ProjectHeader } from "./ProjectHeader";
import { ProjectList } from "./ProjectList";
import { UpcomingList } from "./UpcomingList";
import { nextStatus } from "./view";

export function ProjectsPage({
  onOpenItem,
  onChanged,
}: Readonly<{
  onOpenItem: (id: string) => void;
  onChanged: () => void;
}>) {
  const toast = useToast();
  const [overview, setOverview] = useState<ProjectsOverview | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [formOpen, setFormOpen] = useState<{ edit?: ProjectDetail | null } | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    api.projectsOverview().then(
      (data) => {
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
      (e) => toast(errorMessage(e), "error"),
    );
  }, [version, toast]);

  useEffect(() => {
    if (selectedId === undefined) return;
    api.projectBoard(selectedId).then(
      (data) => setBoard(data),
      (e) => toast(errorMessage(e), "error"),
    );
  }, [selectedId, version, toast]);

  if (!overview) {
    return <h1 className={H1}>Proyek</h1>;
  }

  async function handleMoveCard(card: TaskCard) {
    try {
      await api.updateTask(card.id, { status: nextStatus(card.status) });
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

  function handleSaved() {
    setFormOpen(null);
    setVersion((v) => v + 1);
    onChanged();
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

        <div className="flex min-h-0 flex-col gap-3.5 self-stretch">
          <ProjectHeader
            project={board?.project ?? null}
            looseCount={overview.loose}
            onEdit={() => board?.project && setFormOpen({ edit: board.project })}
          />
          {board ? (
            <Kanban
              columns={board.columns}
              onOpenItem={onOpenItem}
              onMoveCard={handleMoveCard}
              onCreateTask={handleCreateTask}
            />
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-3 gap-3.5">
              <div className="rounded-[14px] border border-line bg-stage p-3" />
              <div className="rounded-[14px] border border-line bg-stage p-3" />
              <div className="rounded-[14px] border border-line bg-stage p-3" />
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
