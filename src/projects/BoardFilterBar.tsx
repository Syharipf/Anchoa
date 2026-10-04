import { useEffect, useRef, useState } from "react";
import type { BoardFilter, DueFilter, Priority } from "../api";
import { hasFilter } from "./view";

const PRIORITY_LABEL: Record<Priority, string> = {
  1: "Tinggi",
  2: "Sedang",
  3: "Rendah",
};

const DUE_LABEL: Record<DueFilter, string> = {
  overdue: "Terlambat",
  week: "7 hari ke depan",
  none: "Tanpa tenggat",
};

const PILL_BASE =
  "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-[10px] border px-2.5 py-1.5 text-xs transition-colors";

const PILL_IDLE = "border-line bg-surface text-muted hover:border-disabled hover:text-ink";

const PILL_ACTIVE = "border-accent/40 bg-surface-2 text-accent font-medium";

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

type MenuKind = "tag" | "priority" | "due" | null;

export function BoardFilterBar({
  filter,
  tags,
  onChange,
}: Readonly<{ filter: BoardFilter; tags: readonly string[]; onChange: (filter: BoardFilter) => void }>) {
  const [openMenu, setOpenMenu] = useState<MenuKind>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenMenu(null);
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  function selectNext(kind: "tag" | "priority" | "due") {
    setOpenMenu((current) => (current === kind ? null : kind));
  }

  function closeMenu() {
    setOpenMenu(null);
  }

  function clearQuery() {
    onChange({ ...filter, query: undefined });
  }

  function clearTag() {
    onChange({ ...filter, tag: undefined });
  }

  function clearPriority() {
    onChange({ ...filter, priority: undefined });
  }

  function clearDue() {
    onChange({ ...filter, due: undefined });
  }

  return (
    <div ref={barRef} role="search" aria-label="Saring tugas" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
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
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="search"
            aria-label="Cari tugas"
            placeholder="Cari tugas…"
            value={filter.query ?? ""}
            onChange={(e) => onChange({ ...filter, query: e.target.value || undefined })}
            className="min-h-8 w-56 rounded-[10px] border border-line bg-surface-2/60 py-1.5 pr-8 pl-8 text-xs text-ink outline-none placeholder:text-muted focus:border-field-focus"
          />
          {filter.query && (
            <button
              type="button"
              aria-label="Hapus pencarian"
              onClick={clearQuery}
              className="absolute top-1/2 right-1.5 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-xs text-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>
        <div className="relative">
          <button
            type="button"
            aria-label="Saring tag"
            aria-expanded={openMenu === "tag"}
            onClick={() => selectNext("tag")}
            className={`${PILL_BASE} ${filter.tag ? PILL_ACTIVE : PILL_IDLE}`}
          >
            {filter.tag ? `#${filter.tag}` : "Tag"}
            <Chevron />
          </button>
          {openMenu === "tag" && (
            <div role="menu" aria-label="Pilih tag" className="absolute top-full left-0 z-10 mt-1 min-w-44 overflow-hidden rounded-[10px] border border-line bg-surface p-1 shadow-lg">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  clearTag();
                  closeMenu();
                }}
                className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-2 ${!filter.tag ? "font-medium text-ink" : "text-muted"}`}
              >
                Semua tag
              </button>
              {tags.length === 0 ? (
                <p className="m-0 px-2.5 py-2 text-left text-[11px] italic text-muted">
                  Belum ada tag di proyek ini
                </p>
              ) : (
                tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onChange({ ...filter, tag });
                      closeMenu();
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left font-mono text-xs transition-colors hover:bg-surface-2 ${filter.tag === tag ? "font-medium text-accent" : "text-muted"}`}
                  >
                    #{tag}
                    {filter.tag === tag && <span aria-hidden="true">✓</span>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <div className="relative">
          <button
            type="button"
            aria-label="Saring prioritas"
            aria-expanded={openMenu === "priority"}
            onClick={() => selectNext("priority")}
            className={`${PILL_BASE} ${filter.priority ? PILL_ACTIVE : PILL_IDLE}`}
          >
            {filter.priority ? PRIORITY_LABEL[filter.priority] : "Prioritas"}
            <Chevron />
          </button>
          {openMenu === "priority" && (
            <div role="menu" aria-label="Pilih prioritas" className="absolute top-full left-0 z-10 mt-1 min-w-40 overflow-hidden rounded-[10px] border border-line bg-surface p-1 shadow-lg">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  clearPriority();
                  closeMenu();
                }}
                className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-2 ${!filter.priority ? "font-medium text-ink" : "text-muted"}`}
              >
                Semua prioritas
              </button>
              {([1, 2, 3] as Priority[]).map((priority) => (
                <button
                  key={priority}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onChange({ ...filter, priority });
                    closeMenu();
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-2 ${filter.priority === priority ? "font-medium text-accent" : "text-muted"}`}
                >
                  {PRIORITY_LABEL[priority]}
                  {filter.priority === priority && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <button
            type="button"
            aria-label="Saring tenggat"
            aria-expanded={openMenu === "due"}
            onClick={() => selectNext("due")}
            className={`${PILL_BASE} ${filter.due ? PILL_ACTIVE : PILL_IDLE}`}
          >
            {filter.due ? DUE_LABEL[filter.due] : "Tenggat"}
            <Chevron />
          </button>
          {openMenu === "due" && (
            <div role="menu" aria-label="Pilih tenggat" className="absolute top-full left-0 z-10 mt-1 min-w-44 overflow-hidden rounded-[10px] border border-line bg-surface p-1 shadow-lg">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  clearDue();
                  closeMenu();
                }}
                className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-2 ${!filter.due ? "font-medium text-ink" : "text-muted"}`}
              >
                Semua tenggat
              </button>
              {(Object.keys(DUE_LABEL) as DueFilter[]).map((due) => (
                <button
                  key={due}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onChange({ ...filter, due });
                    closeMenu();
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-surface-2 ${filter.due === due ? "font-medium text-accent" : "text-muted"}`}
                >
                  {DUE_LABEL[due]}
                  {filter.due === due && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {hasFilter(filter) && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="text-xs text-muted transition-colors hover:text-ink"
          >
            Reset
          </button>
        )}
      </div>
      {hasFilter(filter) && (
        <div className="flex flex-wrap items-center gap-1.5" aria-live="polite" aria-label="Saringan aktif">
          {filter.tag && (
            <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted">
              #{filter.tag}
              <button type="button" aria-label={`Hapus saringan tag ${filter.tag}`} onClick={clearTag} className="text-muted transition-colors hover:text-ink">
                ✕
              </button>
            </span>
          )}
          {filter.priority && (
            <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
              Prioritas {PRIORITY_LABEL[filter.priority]}
              <button type="button" aria-label={`Hapus saringan prioritas ${PRIORITY_LABEL[filter.priority]}`} onClick={clearPriority} className="text-muted transition-colors hover:text-ink">
                ✕
              </button>
            </span>
          )}
          {filter.due && (
            <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
              Tenggat {DUE_LABEL[filter.due]}
              <button type="button" aria-label={`Hapus saringan tenggat ${DUE_LABEL[filter.due]}`} onClick={clearDue} className="text-muted transition-colors hover:text-ink">
                ✕
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
