import { useEffect, useState, type FormEvent } from "react";
import { api, type Activity, type Columns, type LastActor, type TaskCard, type TaskStatus } from "../api";
import { relativeTime, shortDate } from "../format";
import { FIELD } from "../shell/ui";
import { anchorOf, useContextMenu, type MenuEntry } from "../shell/ContextMenu";
import { boardColumns, dropTarget, moveLabel, PRIORITY_LABELS, subLabel } from "./view";

interface CommitLine {
  label: string;
  createdAt: number;
}

type CommitState = "loading" | CommitLine | null;

/** Short ref out of a merge activity: PR number, release tag, or short hash. */
function commitLabel(activity: Pick<Activity, "title" | "body">): string | null {
  const text = `${activity.body}\n${activity.title}`;
  const pull = text.match(/\/pull\/(\d+)/);
  if (pull) return `#${pull[1]}`;
  const tag = text.match(/\/releases\/tag\/([^\s/]+)/);
  if (tag) return tag[1];
  const sha = text.match(/\b[0-9a-f]{7,40}\b/);
  return sha ? sha[0].slice(0, 7) : null;
}

/** Newest merged ref; status rows such as "memindahkan ke Selesai" carry no ref. */
function latestCommit(activities: readonly Activity[]): CommitLine | null {
  let best: CommitLine | null = null;
  for (const activity of activities) {
    if (activity.role !== "merge") continue;
    const label = commitLabel(activity);
    if (label && (!best || activity.createdAt > best.createdAt)) best = { label, createdAt: activity.createdAt };
  }
  return best;
}

/**
 * Latest merged ref for the linked repo, from the existing activity feed.
 * Silent on failure: a failed fetch must not break the card.
 */
function useLatestCommit(projectId: string | null | undefined, repoUrl: string | null | undefined): CommitState {
  const linked = projectId && repoUrl ? projectId : null;
  const [state, setState] = useState<CommitState>(linked ? "loading" : null);
  useEffect(() => {
    if (!linked || !repoUrl) {
      setState(null);
      return;
    }
    let active = true;
    setState("loading");
    api.projectActivities(linked).then(
      (list) => {
        if (active) setState(latestCommit(list));
      },
      () => {
        if (active) setState(null);
      },
    );
    return () => {
      active = false;
    };
  }, [linked, repoUrl]);
  return state;
}

function CardCommit({ commit }: Readonly<{ commit: CommitState }>) {
  if (commit === null) return null;
  if (commit === "loading") {
    return <span aria-hidden="true" className="block h-3 w-24 animate-pulse rounded bg-surface-2" />;
  }
  return (
    <span
      className="flex items-center gap-1 truncate font-mono text-[11px] font-normal text-muted"
      title={`${commit.label} · ${relativeTime(commit.createdAt, Date.now())}`}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="shrink-0"
      >
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="8" r="2.5" />
        <path d="M6 8.5v7M18 10.5c0 4-6 3-10.5 6" />
      </svg>
      <span className="truncate">
        {commit.label} · {relativeTime(commit.createdAt, Date.now())}
      </span>
    </span>
  );
}

function CardActor({ lastActor }: Readonly<{ lastActor: LastActor | null }>) {
  if (!lastActor) return null;
  return (
    <span className="block truncate text-[11px] font-normal text-muted" title={`${lastActor.actor} · ${lastActor.role}`}>
      {lastActor.actor} · {lastActor.role}
    </span>
  );
}

export function Kanban({
  columns,
  agent = false,
  lastActors = {},
  repoUrl = null,
  onOpenItem,
  onMoveCard,
  onDropCard,
  onDeleteCard,
  cardMenu,
  onCreateTask,
  filtered = false,
}: Readonly<{
  columns: Columns;
  agent?: boolean;
  lastActors?: Readonly<Record<string, LastActor>>;
  repoUrl?: string | null;
  onOpenItem: (id: string) => void;
  onMoveCard: (card: TaskCard) => void;
  onDropCard?: (card: TaskCard, status: TaskStatus) => void;
  onDeleteCard?: (card: TaskCard) => void;
  cardMenu?: (card: TaskCard) => readonly MenuEntry[];
  onCreateTask: (title: string, status: TaskStatus) => Promise<void>;
  filtered?: boolean;
}>) {
  const [addingCol, setAddingCol] = useState<TaskStatus | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [overCol, setOverCol] = useState<TaskStatus | null>(null);
  const { menu, open } = useContextMenu();
  const commit = useLatestCommit(
    Object.values(columns).flat().find((card) => card.projectId)?.projectId ?? null,
    repoUrl,
  );
  async function submitNewTask(e: FormEvent, status: TaskStatus) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle("");
    await onCreateTask(title, status);
  }

  return (
    <div className={agent ? "grid min-h-0 flex-1 grid-cols-[repeat(5,minmax(150px,1fr))] gap-3.5 overflow-x-auto" : "grid min-h-0 flex-1 grid-cols-3 gap-3.5"}>
      {boardColumns(agent).map((col) => {
        const cards = columns[col.status];
        const isAdding = addingCol === col.status;

        return (
          <section
            key={col.status}
            aria-label={col.title}
            onDragOver={(e) => {
              e.preventDefault();
              setOverCol(col.status);
            }}
            onDragLeave={() => setOverCol((current) => (current === col.status ? null : current))}
            onDrop={(e) => {
              e.preventDefault();
              setOverCol(null);
              const card = dropTarget(columns, e.dataTransfer.getData("text/plain"), col.status);
              if (card && onDropCard) onDropCard(card, col.status);
            }}
            className={`flex min-h-0 flex-col gap-2 overflow-y-auto rounded-[14px] border bg-stage p-3 transition-colors ${
              overCol === col.status ? "border-accent ring-1 ring-accent" : "border-line"
            }`}
          >
            <div className="flex items-center gap-2 px-1 py-0.5">
              <span className={`h-2 w-2 rounded-full ${col.dot}`} />
              <h3 className="m-0 text-[13px] font-semibold text-ink">{col.title}</h3>
              <span className="ml-auto font-mono text-xs text-muted">{cards.length}</span>
            </div>

            {isAdding ? (
              <form onSubmit={(e) => void submitNewTask(e, col.status)}>
                <input
                  autoFocus
                  type="text"
                  value={newTitle}
                  placeholder="Judul tugas…"
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setAddingCol(null);
                      setNewTitle("");
                    }
                  }}
                  onBlur={() => {
                    if (!newTitle.trim()) {
                      setAddingCol(null);
                      setNewTitle("");
                    }
                  }}
                  className={`w-full py-1.5 ${FIELD}`}
                />
              </form>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAddingCol(col.status);
                  setNewTitle("");
                }}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-left text-xs text-muted transition-colors hover:border-muted hover:text-ink"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Tugas
              </button>
            )}

            {cards.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-line p-4 text-center text-xs text-muted">
                {filtered ? "Tidak ada yang cocok" : "Kosong"}
              </div>
            ) : (
              cards.map((c) => {
                const sub = subLabel(c);
                const isDone = c.status === "done";
                const actor = agent ? lastActors[c.id] ?? null : null;

                if (isDone) {
                  return (
                    <article
                      key={c.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", c.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onContextMenu={(e) => {
                        if (cardMenu) {
                          e.preventDefault();
                          open(anchorOf(e), cardMenu(c));
                        }
                      }}
                      className="group relative flex items-center gap-2.5 rounded-[10px] border border-[#1F242D] bg-[#151920] px-2.5 py-2 transition-colors hover:border-muted"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className="shrink-0 text-accent"
                      >
                        <path d="M5 12l5 5 9-10" />
                      </svg>
                      <button
                        type="button"
                        onClick={() => onOpenItem(c.id)}
                        className={
                          agent
                            ? "min-w-0 flex-1 text-left text-[13px] text-done hover:text-ink before:absolute before:inset-0"
                            : "flex-1 truncate text-left text-[13px] text-done hover:text-ink before:absolute before:inset-0"
                        }
                      >
                        <span className="block truncate">{c.title || "Tanpa judul"}</span>
                        <CardCommit commit={commit} />
                        <CardActor lastActor={actor} />
                      </button>
                      {cardMenu ? (
                        <button
                          type="button"
                          aria-label="Menu tugas"
                          title="Menu tugas"
                          onClick={(e) => open(anchorOf(e), cardMenu(c))}
                          className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /><circle cx="5" cy="12" r="1.5" />
                          </svg>
                        </button>
                      ) : onDeleteCard ? (
                        <button
                          type="button"
                          onClick={() => onDeleteCard(c)}
                          aria-label="Hapus tugas"
                          title="Hapus tugas"
                          className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-danger"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                          </svg>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onMoveCard(c)}
                        aria-label={moveLabel(c.status, agent)}
                        title="Buka lagi"
                        className="relative z-10 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M9 14L4 9l5-5" />
                          <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
                        </svg>
                      </button>
                    </article>
                  );
                }

                return (
                  <article
                    key={c.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", c.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onContextMenu={(e) => {
                      if (cardMenu) {
                        e.preventDefault();
                        open(anchorOf(e), cardMenu(c));
                      }
                    }}
                    className="group relative flex flex-col gap-2.5 rounded-[10px] border border-line bg-surface p-3 transition-colors hover:border-muted"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenItem(c.id)}
                      className="text-left text-sm leading-[1.4] text-ink hover:text-accent transition-colors before:absolute before:inset-0"
                    >
                      {c.title || "Tanpa judul"}
                    </button>
                    <CardCommit commit={commit} />
                    <CardActor lastActor={actor} />
                    <div className="flex items-center gap-2">
                      {c.priority !== null && (
                        <span className={`rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold ${PRIORITY_LABELS[c.priority].className}`}>
                          {PRIORITY_LABELS[c.priority].label}
                        </span>
                      )}
                      {c.tag && (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
                          {c.tag}
                        </span>
                      )}
                      {sub && (
                        <span className="flex items-center gap-1 font-mono text-[11px] text-muted">
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M4 7l2 2 4-4M4 17l2 2 4-4M13 7h7M13 17h7" />
                          </svg>
                          {sub}
                        </span>
                      )}
                      {c.dueAt !== null && (
                        <span
                          className={`font-mono text-[11px] ${
                            c.overdue ? "text-danger" : "text-muted"
                          }`}
                        >
                          {shortDate(c.dueAt)}
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-1">
                        {cardMenu ? (
                          <button
                            type="button"
                            aria-label="Menu tugas"
                            title="Menu tugas"
                            onClick={(e) => open(anchorOf(e), cardMenu(c))}
                            className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted opacity-0 transition-opacity hover:bg-surface-2 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                              <circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /><circle cx="5" cy="12" r="1.5" />
                            </svg>
                          </button>
                        ) : onDeleteCard ? (
                          <button
                            type="button"
                            onClick={() => onDeleteCard(c)}
                            aria-label="Hapus tugas"
                            title="Hapus tugas"
                            className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-danger"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
                            </svg>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onMoveCard(c)}
                          aria-label={moveLabel(c.status, agent)}
                          title={moveLabel(c.status, agent)}
                          className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-accent transition-transform hover:scale-105 active:scale-95"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M5 12h14M13 6l6 6-6 6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </section>
        );
      })}
      {menu}
    </div>
  );
}
