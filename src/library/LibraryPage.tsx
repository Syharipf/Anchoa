import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  errorMessage,
  type LibraryCounts,
  type MediaInput,
  type MediaKind,
  type MediaRow,
  type MediaStatus,
} from "../api";
import { useToast } from "../shell/toast";
import { MediaCard } from "./MediaCard";
import { MediaDialog } from "./MediaDialog";
import { KIND_LABEL } from "./view";

const KINDS_FILTER: readonly (MediaKind | "all")[] = ["all", "film", "series", "anime", "book", "manga"];

export function LibraryPage({
  initialId,
}: Readonly<{
  initialId?: string;
}>) {
  const toast = useToast();
  const [items, setItems] = useState<MediaRow[]>([]);
  const [counts, setCounts] = useState<LibraryCounts>({ all: 0, want: 0, active: 0, finished: 0, dropped: 0 });
  const [kindFilter, setKindFilter] = useState<MediaKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<MediaStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [editing, setEditing] = useState<MediaRow | null | "new">(null);
  const [loading, setLoading] = useState(true);

  // Debounce query 200 ms
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const load = useCallback(() => {
    const filter = {
      kind: kindFilter === "all" ? undefined : kindFilter,
      status: statusFilter === "all" ? undefined : statusFilter,
      query: debouncedQuery || undefined,
    };
    return api
      .libraryList(filter)
      .then((res) => {
        setItems(res.items);
        setCounts(res.counts);
        return res.items;
      })
      .catch((e) => {
        toast(errorMessage(e), "error");
        return [] as MediaRow[];
      })
      .finally(() => setLoading(false));
  }, [kindFilter, statusFilter, debouncedQuery, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Open detail dialog if initialId is given
  const openedInitialRef = useRef(false);
  useEffect(() => {
    if (!initialId || openedInitialRef.current) return;
    load().then((loadedItems) => {
      const target = loadedItems.find((i) => i.id === initialId);
      if (target) {
        setEditing(target);
        openedInitialRef.current = true;
      }
    });
  }, [initialId, load]);

  function cycleKind() {
    const curIdx = KINDS_FILTER.indexOf(kindFilter);
    const next = KINDS_FILTER[(curIdx + 1) % KINDS_FILTER.length];
    setKindFilter(next);
  }

  async function handleSave(input: MediaInput) {
    try {
      await api.saveMedia(input);
      setEditing(null);
      await load();
      toast("Saved", "info");
    } catch (e) {
      toast(errorMessage(e), "error");
      throw e;
    }
  }

  async function handleDelete(id: string) {
    try {
      await api.deleteMedia(id);
      setEditing(null);
      await load();
      toast("Media deleted", "info", {
        label: "Undo",
        run: () => {
          api
            .restoreMedia(id)
            .then(load)
            .then(() => toast("Restored", "info"))
            .catch((e) => toast(errorMessage(e), "error"));
        },
      });
    } catch (e) {
      toast(errorMessage(e), "error");
      throw e;
    }
  }

  const kindButtonLabel = kindFilter === "all" ? "All kinds" : KIND_LABEL[kindFilter];

  const statusChips = [
    { key: "all" as const, label: "All", count: counts.all },
    { key: "want" as const, label: "Want", count: counts.want },
    { key: "active" as const, label: "Watching / Reading", count: counts.active },
    { key: "finished" as const, label: "Finished", count: counts.finished },
    { key: "dropped" as const, label: "Dropped", count: counts.dropped },
  ];

  return (
    <div className="flex flex-1 flex-col gap-3.5 overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="m-0 font-display text-[28px] font-semibold tracking-[-0.01em]">Library</h1>
          <span className="text-[13px] text-muted">Films, series, anime, books, and manga</span>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex h-[38px] w-60 items-center gap-2 rounded-[10px] border border-line bg-[#131820] px-3 text-muted focus-within:border-field-focus">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              type="text"
              aria-label="Search media"
              placeholder="Search media…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full border-none bg-transparent text-[13px] text-ink outline-none"
            />
          </label>

          <button
            type="button"
            onClick={cycleKind}
            className="flex h-[38px] items-center gap-2 rounded-[10px] border border-line bg-surface px-3 text-[13px] text-[#C9CED8] transition-colors hover:bg-surface-2"
          >
            {kindButtonLabel}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => setEditing("new")}
            className="h-[38px] rounded-[10px] bg-accent px-4 font-display text-[13px] font-semibold text-canvas transition-transform hover:scale-105 active:scale-95"
          >
            + Add
          </button>
        </div>
      </div>

      <div role="group" aria-label="Filter by status" className="flex flex-wrap items-center gap-2">
        {statusChips.map((chip) => {
          const active = statusFilter === chip.key;
          return (
            <button
              key={chip.key}
              type="button"
              aria-pressed={active}
              onClick={() => setStatusFilter(chip.key)}
              className={`flex h-[30px] items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors ${
                active
                  ? "border-field-focus bg-[#1D2129] font-medium text-ink"
                  : "border-line bg-transparent text-muted hover:border-[#31474E] hover:text-ink"
              }`}
            >
              <span>{chip.label}</span>
              <span className="font-mono text-[11px] text-muted">{chip.count}</span>
            </button>
          );
        })}
        <span className="flex-1" />
        <span className="text-xs text-muted">Sorted by last activity</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {items.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <p className="text-sm text-muted">No media found.</p>
            {query || kindFilter !== "all" || statusFilter !== "all" ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setDebouncedQuery("");
                  setKindFilter("all");
                  setStatusFilter("all");
                }}
                className="rounded-full border border-line bg-surface px-4 py-1.5 text-xs text-ink transition-colors hover:bg-surface-2"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <div className="grid auto-rows-[184px] grid-cols-1 content-start gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {items.map((media) => (
              <MediaCard key={media.id} media={media} onOpen={(m) => setEditing(m)} />
            ))}
          </div>
        )}
      </div>

      {editing ? (
        <MediaDialog
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={editing === "new" ? undefined : handleDelete}
        />
      ) : null}
    </div>
  );
}
