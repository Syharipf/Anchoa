import { useState, type FormEvent } from "react";
import type { Columns, LastActor, TaskCard, TaskStatus } from "../api";
import { shortDate } from "../format";
import { FIELD } from "../shell/ui";
import { anchorOf, useContextMenu, type MenuEntry } from "../shell/ContextMenu";
import { boardColumns, dropTarget, moveLabel, PRIORITY_LABELS, subLabel } from "./view";

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
                      className="group relative flex items-center gap-2.5 rounded-[10px] border border-line bg-[#151920] px-2.5 py-2 transition-colors hover:border-muted"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#C6F36B"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className="shrink-0"
                      >
                        <path d="M5 12l5 5 9-10" />
                      </svg>
                      <button
                        type="button"
                        onClick={() => onOpenItem(c.id)}
                        className={agent ? "min-w-0 flex-1 text-left text-[13px] text-done hover:text-ink before:absolute before:inset-0" : "flex-1 truncate text-left text-[13px] text-done line-through hover:text-ink before:absolute before:inset-0"}
                      >
                        {agent ? <span className="block truncate line-through">{c.title || "Tanpa judul"}</span> : c.title || "Tanpa judul"}
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
                        className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink"
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
