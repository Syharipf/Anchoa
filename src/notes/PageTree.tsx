import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { PageNode } from "../api";
import type { TreeNode } from "./view";

const STORAGE_KEY = "anchoa:notes:expanded";

function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((x): x is string => typeof x === "string"));
    }
  } catch {
    // Ignore storage errors
  }
  return new Set();
}

function saveExpanded(expanded: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...expanded]));
  } catch {
    // Ignore storage errors
  }
}

interface PageTreeProps {
  readonly tree: readonly TreeNode[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onCreateSubpage: (parentId: string) => void;
  readonly onStartRename: (node: PageNode) => void;
  readonly onStartMove: (node: PageNode) => void;
  readonly onStartDelete: (node: PageNode) => void;
  readonly renamingNodeId?: string | null;
  readonly onRename?: (id: string, newTitle: string) => void;
  readonly onCancelRename?: () => void;
}

export function PageTree({
  tree,
  selectedId,
  onSelect,
  onCreateSubpage,
  onStartRename,
  onStartMove,
  onStartDelete,
  renamingNodeId,
  onRename,
  onCancelRename,
}: Readonly<PageTreeProps>): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuNodeId) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuNodeId(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuNodeId(null);
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuNodeId]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveExpanded(next);
      return next;
    });
  }

  function handleCreateSubpage(parentId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(parentId);
      saveExpanded(next);
      return next;
    });
    onCreateSubpage(parentId);
  }

  function renderNode(node: TreeNode, depth: number): JSX.Element {
    const isExpanded = expanded.has(node.id);
    const hasChildren = node.children.length > 0;
    const isSelected = selectedId === node.id;
    const isRenaming = renamingNodeId === node.id;
    const isMenuOpen = menuNodeId === node.id;

    return (
      <li key={node.id} className="flex flex-col">
        <div
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
          className={`group relative flex min-h-8 items-center gap-1 rounded-lg pr-1 text-sm transition-colors ${
            isSelected
              ? "bg-surface-2 font-medium text-accent"
              : "text-ink hover:bg-surface-2/60"
          }`}
        >
          {/* Expand/collapse chevron */}
          {hasChildren ? (
            <button
              type="button"
              aria-label={isExpanded ? "Tutup subhalaman" : "Buka subhalaman"}
              onClick={() => toggleExpand(node.id)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:text-ink"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className={`transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          ) : (
            <span className="w-5 shrink-0" aria-hidden="true" />
          )}

          {/* Node title or inline rename input */}
          {isRenaming ? (
            <input
              type="text"
              autoFocus
              defaultValue={node.title}
              aria-label="Nama halaman"
              onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onRename?.(node.id, e.currentTarget.value);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onCancelRename?.();
                }
              }}
              onBlur={(e) => onRename?.(node.id, e.target.value)}
              className="min-w-0 flex-1 rounded border border-field-focus bg-surface px-1.5 py-0.5 text-xs text-ink outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => onSelect(node.id)}
              className="min-w-0 flex-1 truncate py-1 text-left"
              title={node.title}
            >
              {node.title}
            </button>
          )}

          {/* Menu button "⋯" */}
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label={`Menu ${node.title}`}
              aria-expanded={isMenuOpen}
              onClick={() => setMenuNodeId((prev) => (prev === node.id ? null : node.id))}
              className={`flex h-6 w-6 items-center justify-center rounded text-muted hover:text-ink ${
                isMenuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="19" cy="12" r="1.5" />
                <circle cx="5" cy="12" r="1.5" />
              </svg>
            </button>

            {/* Menu Popover */}
            {isMenuOpen && (
              <div
                ref={menuRef}
                role="menu"
                className="absolute right-0 top-full z-30 mt-1 flex w-44 flex-col rounded-xl border border-line bg-surface p-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuNodeId(null);
                    handleCreateSubpage(node.id);
                  }}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Subhalaman baru
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuNodeId(null);
                    onStartRename(node);
                  }}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                  Ganti nama
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuNodeId(null);
                    onStartMove(node);
                  }}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                  Pindahkan ke…
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuNodeId(null);
                    onStartDelete(node);
                  }}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-danger transition-colors hover:bg-danger-row"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Hapus
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Children sub-tree */}
        {hasChildren && isExpanded && (
          <ul className="flex flex-col">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <ul className="flex flex-col gap-0.5">
      {tree.map((rootNode) => renderNode(rootNode, 0))}
    </ul>
  );
}
