import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import {
  api,
  errorMessage,
  type ItemSummary,
  type PageNode,
  type SearchHit,
  type TrashEntry,
} from "../api";
import { relativeTime } from "../format";
import { Dialog } from "../shell/Dialog";
import { useToast } from "../shell/toast";
import { PRIMARY, SECONDARY } from "../shell/ui";
import { Backlinks } from "./Backlinks";
import { BlockEditor } from "./BlockEditor";
import { MoveDialog } from "./MoveDialog";
import { PageTree } from "./PageTree";
import { TrashDialog } from "./TrashDialog";
import {
  breadcrumb,
  buildTree,
  descendantIds,
  snippetParts,
  type TreeNode,
} from "./view";

interface LoadedPage {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly updatedAt: number;
}

export function NotesPage({
  initialId,
  onOpenItem,
  onReveal,
  onChanged,
}: Readonly<{
  initialId?: string;
  onOpenItem: (id: string) => void;
  onReveal?: (path: string) => void;
  onChanged?: () => void;
}>): JSX.Element {
  const toast = useToast();

  const [nodes, setNodes] = useState<PageNode[]>([]);
  const [trashEntries, setTrashEntries] = useState<TrashEntry[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(initialId ?? null);

  const [loadedPage, setLoadedPage] = useState<LoadedPage | null>(null);
  const [isBodyLoading, setIsBodyLoading] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [backlinks, setBacklinks] = useState<ItemSummary[]>([]);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Dialogs
  const [showTrash, setShowTrash] = useState(false);
  const [movingPage, setMovingPage] = useState<PageNode | null>(null);
  const [deletingPage, setDeletingPage] = useState<PageNode | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);

  // Autosave refs
  const pendingBody = useRef<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const activeIdRef = useRef<string | null>(activePageId);
  activeIdRef.current = activePageId;

  const loadTree = useCallback(async () => {
    try {
      const treeNodes = await api.pagesTree();
      setNodes(treeNodes);
      return treeNodes;
    } catch (e) {
      toast(errorMessage(e), "error");
      return [];
    }
  }, [toast]);

  const loadTrash = useCallback(async () => {
    try {
      const entries = await api.pagesTrash();
      setTrashEntries(entries);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [toast]);

  const loadBacklinks = useCallback(
    async (id: string) => {
      try {
        const links = await api.pageBacklinks(id);
        setBacklinks(links);
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [toast],
  );

  // Initial load of tree and trash
  useEffect(() => {
    void loadTree();
    void loadTrash();
  }, [loadTree, loadTrash]);

  // Flush pending body changes
  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const bodyToSave = pendingBody.current;
    const idToSave = activeIdRef.current;
    if (bodyToSave === null || !idToSave) return;
    pendingBody.current = null;
    try {
      await api.savePageBody(idToSave, bodyToSave);
      await loadBacklinks(idToSave);
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [toast, loadBacklinks, onChanged]);

  // Flush on unmount and window blur
  useEffect(() => {
    const onWindowBlur = () => {
      void flush();
    };
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("blur", onWindowBlur);
      void flush();
    };
  }, [flush]);

  // Switch active page
  const handleSelectPage = useCallback(
    async (id: string | null) => {
      if (id === activePageId) return;
      await flush();
      setActivePageId(id);
    },
    [activePageId, flush],
  );

  // Load active page body and backlinks when activePageId changes
  useEffect(() => {
    if (!activePageId) {
      setLoadedPage(null);
      setIsBodyLoading(false);
      setBacklinks([]);
      return;
    }

    let active = true;
    setIsBodyLoading(true);

    api.openItem(activePageId).then(
      (item) => {
        if (!active) return;
        setLoadedPage({
          id: item.id,
          title: item.title,
          body: item.body,
          updatedAt: item.updatedAt,
        });
        setTitleDraft(item.title);
        setIsBodyLoading(false);
      },
      (e) => {
        if (!active) return;
        toast(errorMessage(e), "error");
        setIsBodyLoading(false);
      },
    );

    void loadBacklinks(activePageId);

    return () => {
      active = false;
    };
  }, [activePageId, toast, loadBacklinks]);

  // Autosave body changes with 600ms debounce
  const handleBodyChange = useCallback(
    (newBody: string) => {
      pendingBody.current = newBody;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        void flush();
      }, 600);
    },
    [flush],
  );

  // Rename active page
  async function handleRenameActivePage(newTitle: string) {
    if (!activePageId) return;
    const trimmed = newTitle.trim();
    const finalTitle = trimmed || "Tanpa judul";
    if (loadedPage && finalTitle === loadedPage.title) return;
    try {
      const updated = await api.renamePage(activePageId, finalTitle);
      setLoadedPage((prev) =>
        prev
          ? {
              ...prev,
              title: updated.title,
              updatedAt: updated.updatedAt,
            }
          : null,
      );
      setTitleDraft(updated.title);
      await loadTree();
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  // Rename from PageTree
  async function handleRenameNode(id: string, newTitle: string) {
    setRenamingNodeId(null);
    const trimmed = newTitle.trim();
    const finalTitle = trimmed || "Tanpa judul";
    try {
      const updated = await api.renamePage(id, finalTitle);
      if (activePageId === id) {
        setLoadedPage((prev) =>
          prev
            ? {
                ...prev,
                title: updated.title,
                updatedAt: updated.updatedAt,
              }
            : null,
        );
        setTitleDraft(updated.title);
      }
      await loadTree();
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  // Create page
  async function handleCreatePage(parentId: string | null, customTitle?: string) {
    await flush();
    try {
      const created = await api.createPage(parentId, customTitle ?? "");
      await loadTree();
      await handleSelectPage(created.id);
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  // Wikilink open
  const handleOpenLink = useCallback(
    async (title: string) => {
      await flush();
      try {
        const target = await api.resolveLink(title);
        if (target) {
          onOpenItem(target.id);
        } else {
          const created = await api.createPage(null, title);
          await loadTree();
          await handleSelectPage(created.id);
          onChanged?.();
        }
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [flush, onOpenItem, loadTree, handleSelectPage, onChanged, toast],
  );

  const handleOpenUrl = useCallback(
    (href: string) => {
      api.openLink(href).catch((e) => toast(errorMessage(e), "error"));
    },
    [toast],
  );

  const handleCreatePageFromEditor = useCallback(
    async (title: string) => {
      try {
        await api.createPage(null, title);
        await loadTree();
        onChanged?.();
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [loadTree, onChanged, toast],
  );

  // Confirm delete
  async function handleConfirmDelete() {
    if (!deletingPage) return;
    setIsDeleting(true);
    try {
      const descendants = descendantIds(nodes, deletingPage.id);
      await api.deletePage(deletingPage.id);
      if (activePageId === deletingPage.id || (activePageId && descendants.has(activePageId))) {
        await handleSelectPage(null);
      }
      setDeletingPage(null);
      await loadTree();
      await loadTrash();
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setIsDeleting(false);
    }
  }

  // Confirm move
  async function handleConfirmMove(targetParentId: string | null) {
    if (!movingPage) return;
    try {
      await api.movePage(movingPage.id, targetParentId);
      setMovingPage(null);
      await loadTree();
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  // Restore page from trash
  async function handleRestorePage(id: string) {
    try {
      const restored = await api.restorePage(id);
      await loadTree();
      await loadTrash();
      await handleSelectPage(restored.id);
      toast("Halaman dipulihkan", "info");
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  // Export markdown
  async function handleExport() {
    try {
      const exportPath = await api.exportPages();
      toast(
        `Diekspor ke ${exportPath}`,
        "info",
        onReveal
          ? {
              label: "Buka di Berkas",
              run: () => onReveal(exportPath),
            }
          : undefined,
      );
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  // Search debounce
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    let active = true;
    const timer = setTimeout(() => {
      api.searchItems(q, true, 20).then(
        (results) => {
          if (!active) return;
          setSearchResults(results);
          setIsSearching(false);
        },
        (e) => {
          if (!active) return;
          toast(errorMessage(e), "error");
          setIsSearching(false);
        },
      );
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, toast]);

  const tree: TreeNode[] = useMemo(() => buildTree(nodes), [nodes]);
  const titles = useMemo(() => nodes.map((n) => n.title), [nodes]);
  const crumbs = useMemo(
    () => (activePageId ? breadcrumb(nodes, activePageId) : []),
    [nodes, activePageId],
  );

  const recentPages = useMemo(() => {
    return [...nodes].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  }, [nodes]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3.5">
      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_280px] gap-4">
        {/* Kolom Kiri (260px) */}
        <section
          aria-label="Daftar catatan"
          className="flex min-h-0 flex-col rounded-[14px] border border-line bg-surface p-3"
        >
          {/* Kotak cari */}
          <div className="relative mb-2.5">
            <input
              type="search"
              placeholder="Cari halaman…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-[10px] border border-line bg-surface-2/60 px-3 py-1.5 text-xs text-ink outline-none placeholder:text-muted focus:border-field-focus"
            />
          </div>

          {/* Tombol + Halaman baru */}
          <button
            type="button"
            onClick={() => void handleCreatePage(null)}
            className="mb-3 flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-surface-2 px-3 text-xs font-semibold text-accent transition-colors hover:bg-surface-2/80"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            + Halaman baru
          </button>

          {/* Pohon atau Hasil Pencarian */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {searchQuery.trim() ? (
              <div className="flex flex-col gap-1">
                {isSearching ? (
                  <div className="p-2 text-xs text-muted">Mencari…</div>
                ) : searchResults.length === 0 ? (
                  <div className="p-2 text-xs text-muted">
                    Tidak ada halaman yang cocok.
                  </div>
                ) : (
                  searchResults.map((hit) => {
                    const parts = snippetParts(hit.snippet);
                    return (
                      <button
                        key={hit.id}
                        type="button"
                        onClick={() => void handleSelectPage(hit.id)}
                        className={`flex flex-col gap-1 rounded-lg p-2 text-left transition-colors hover:bg-surface-2 ${
                          activePageId === hit.id
                            ? "bg-surface-2 font-medium text-accent"
                            : "text-ink"
                        }`}
                      >
                        <span className="truncate text-xs font-medium">
                          {hit.title}
                        </span>
                        {parts.length > 0 && (
                          <span className="line-clamp-2 text-[11px] leading-tight text-muted">
                            {parts.map((part, idx) =>
                              part.mark ? (
                                <mark
                                  key={idx}
                                  className="rounded bg-accent/20 px-0.5 font-medium text-accent"
                                >
                                  {part.text}
                                </mark>
                              ) : (
                                <span key={idx}>{part.text}</span>
                              ),
                            )}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            ) : (
              <PageTree
                tree={tree}
                selectedId={activePageId}
                onSelect={(id) => void handleSelectPage(id)}
                onCreateSubpage={(parentId) => void handleCreatePage(parentId)}
                onStartRename={(node) => setRenamingNodeId(node.id)}
                onStartMove={(node) => setMovingPage(node)}
                onStartDelete={(node) => setDeletingPage(node)}
                renamingNodeId={renamingNodeId}
                onRename={(id, title) => void handleRenameNode(id, title)}
                onCancelRename={() => setRenamingNodeId(null)}
              />
            )}
          </div>

          {/* Di bawah: Sampah (n) dan Ekspor Markdown */}
          <div className="mt-auto flex items-center justify-between border-t border-line pt-2.5 text-xs">
            <button
              type="button"
              onClick={() => setShowTrash(true)}
              className="flex items-center gap-1.5 text-muted transition-colors hover:text-ink"
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
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Sampah ({trashEntries.length})
            </button>

            <button
              type="button"
              onClick={() => void handleExport()}
              className="flex items-center gap-1.5 text-muted transition-colors hover:text-accent"
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
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Ekspor Markdown
            </button>
          </div>
        </section>

        {/* Tengah */}
        <section
          aria-label="Editor catatan"
          className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[14px] border border-line bg-surface p-6"
        >
          {activePageId ? (
            loadedPage && loadedPage.id === activePageId ? (
              <div className="flex min-h-0 flex-1 flex-col gap-4">
                {/* Breadcrumb induk */}
                <nav
                  aria-label="Breadcrumb"
                  className="flex flex-wrap items-center gap-1.5 text-xs text-muted"
                >
                  {crumbs.map((crumb, idx) => {
                    const isLast = idx === crumbs.length - 1;
                    return (
                      <span key={crumb.id} className="flex items-center gap-1.5">
                        {idx > 0 && (
                          <span aria-hidden="true" className="text-disabled">
                            /
                          </span>
                        )}
                        {isLast ? (
                          <span className="font-medium text-ink">
                            {crumb.title}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleSelectPage(crumb.id)}
                            className="transition-colors hover:text-ink"
                          >
                            {crumb.title}
                          </button>
                        )}
                      </span>
                    );
                  })}
                </nav>

                {/* Judul yang bisa diedit (H1) */}
                <h1 className="m-0">
                  <input
                    type="text"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onBlur={() => void handleRenameActivePage(titleDraft)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleRenameActivePage(titleDraft);
                        const firstBlock = document.querySelector<HTMLElement>(
                          '[role="button"][tabindex="0"], textarea',
                        );
                        firstBlock?.focus();
                      }
                    }}
                    placeholder="Tanpa judul"
                    aria-label="Judul halaman"
                    className="w-full border-0 bg-transparent p-0 font-display text-[28px] font-semibold text-ink outline-none placeholder:text-muted focus:outline-none"
                  />
                </h1>

                {/* Waktu Diperbarui */}
                <div className="text-xs text-muted">
                  Diperbarui {relativeTime(loadedPage.updatedAt, Date.now())}
                </div>

                {/* Editor Blok */}
                <div className="min-h-0 flex-1">
                  <BlockEditor
                    key={loadedPage.id}
                    pageId={loadedPage.id}
                    body={loadedPage.body}
                    titles={titles}
                    onChange={handleBodyChange}
                    onOpenLink={(title) => void handleOpenLink(title)}
                    onOpenUrl={handleOpenUrl}
                    onCreatePage={handleCreatePageFromEditor}
                  />
                </div>
              </div>
            ) : isBodyLoading ? (
              <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted">
                Memuat catatan…
              </div>
            ) : null
          ) : (
            /* Tanpa halaman terpilih */
            nodes.length === 0 ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
                <h2 className="m-0 font-display text-lg font-semibold text-ink">
                  Belum ada halaman
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Buat catatan baru untuk mulai menulis dan mengorganisasi ide.
                </p>
                <button
                  type="button"
                  onClick={() => void handleCreatePage(null)}
                  className={`${PRIMARY} mt-4`}
                >
                  Buat halaman pertama
                </button>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <h2 className="m-0 font-display text-base font-semibold text-ink">
                  Halaman terbaru
                </h2>
                <div className="mt-4 flex flex-col gap-2">
                  {recentPages.map((page) => (
                    <button
                      key={page.id}
                      type="button"
                      onClick={() => void handleSelectPage(page.id)}
                      className="flex items-center justify-between rounded-lg p-3 text-left transition-colors hover:bg-surface-2"
                    >
                      <span className="font-medium text-ink">{page.title}</span>
                      <span className="text-xs text-muted">
                        Diperbarui {relativeTime(page.updatedAt, Date.now())}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )
          )}
        </section>

        {/* Kolom Kanan (280px) */}
        <Backlinks items={backlinks} onOpenItem={onOpenItem} />
      </div>

      {/* Move Dialog */}
      {movingPage && (
        <MoveDialog
          nodes={nodes}
          page={movingPage}
          onClose={() => setMovingPage(null)}
          onMove={handleConfirmMove}
        />
      )}

      {/* Trash Dialog */}
      {showTrash && (
        <TrashDialog
          entries={trashEntries}
          onClose={() => setShowTrash(false)}
          onRestore={handleRestorePage}
        />
      )}

      {/* Hapus Confirmation Dialog */}
      {deletingPage && (
        <Dialog
          title={
            descendantIds(nodes, deletingPage.id).size > 0
              ? `Hapus "${deletingPage.title}" dan ${descendantIds(nodes, deletingPage.id).size} subhalaman?`
              : `Hapus "${deletingPage.title}"?`
          }
          onClose={() => setDeletingPage(null)}
        >
          <p className="m-0 text-sm text-muted">
            Halaman dan seluruh subhalamannya akan dipindahkan ke Sampah dan
            dapat dipulihkan kapan saja.
          </p>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeletingPage(null)}
              className={SECONDARY}
            >
              Batal
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => void handleConfirmDelete()}
              className="min-h-10 rounded-full border border-danger px-4 text-[13px] font-semibold text-danger transition-colors hover:bg-danger-row"
            >
              {isDeleting ? "Menghapus…" : "Hapus"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
