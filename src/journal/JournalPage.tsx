import { useCallback, useEffect, useRef, useState } from "react";
import type { OpenAssistant } from "../assistant/useAssistantRequest";
import {
  api,
  errorMessage,
  type Entry,
  type Group,
  type JournalFilter,
  type Side as JournalSideData,
} from "../api";
import type { SettingsSection } from "../settings/view";
import { useToast } from "../shell/toast";
import { EntryEditor } from "./EntryEditor";
import { EntryList } from "./EntryList";
import { JournalSide } from "./JournalSide";
import { JOURNAL_TEMPLATES, KIND_META, type JournalTemplate } from "./view";

export function JournalPage({
  onOpenItem,
  onChanged,
  onOpenAssistant,
  onOpenSettings,
}: Readonly<{
  onOpenItem: (id: string) => void;
  onChanged?: () => void;
  onOpenAssistant: OpenAssistant;
  onOpenSettings?: (section?: SettingsSection) => void;
}>) {
  const toast = useToast();
  const [filter, setFilter] = useState<JournalFilter>({});
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentEntry, setCurrentEntry] = useState<Entry | null>(null);
  const [side, setSide] = useState<JournalSideData | null>(null);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const listRequest = useRef(0);
  const deletedEntries = useRef(new Set<string>());
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !menuButtonRef.current?.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);
  const handleFilterChange = useCallback((patch: Partial<JournalFilter>) => {
    setFilter((current) => ({ ...current, ...patch }));
  }, []);

  const handleDateSelect = useCallback((date: string) => {
    setFilter((current) => ({
      ...current,
      date: current.date === date ? undefined : date,
    }));
  }, []);
  const loadList = useCallback(
    async (f: JournalFilter) => {
      const request = ++listRequest.current;
      try {
        const res = await api.journalList(f);
        if (request !== listRequest.current) return null;
        setGroups(res.groups);
        const entries = res.groups.flatMap((group) => group.entries);
        setSelectedId((current) => entries.some((entry) => entry.id === current)
          ? current : entries[0]?.id ?? null);
        setCurrentEntry((current) => current && entries.some((entry) => entry.id === current.id) ? current : null);
        return res.groups;
      } catch (e) {
        if (request === listRequest.current) toast(errorMessage(e), "error");
        return null;
      }
    },
    [toast],
  );

  const loadSide = useCallback(async () => {
    try {
      const res = await api.journalSide();
      setSide(res);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [toast]);

  // Ignore old responses when the filters change or the page unmounts.
  useEffect(() => {
    void loadList(filter);
    return () => {
      listRequest.current++;
    };
  }, [filter, loadList]);

  useEffect(() => {
    void loadSide();
  }, [loadSide]);

  // Load selected entry details
  useEffect(() => {
    setCurrentEntry(null);
    if (!selectedId) {
      return;
    }
    let active = true;
    api.journalEntry(selectedId).then(
      (entry) => {
        if (active && !deletedEntries.current.has(entry.id)) setCurrentEntry(entry);
      },
      (e) => {
        if (active && !deletedEntries.current.has(selectedId)) toast(errorMessage(e), "error");
      },
    );
    return () => {
      active = false;
    };
  }, [selectedId, toast]);

  // A new entry has no tags, mood or matching text yet: drop the filters that
  // would hide it, keeping only the kind it was created with.
  async function openCreated(created: Entry) {
    const next: JournalFilter = filterRef.current.kind === created.kind ? { kind: created.kind } : {};
    filterRef.current = next;
    setFilter(next);
    setSelectedId(created.id);
    setCurrentEntry(created);
    await loadList(next);
    await loadSide();
    onChanged?.();
  }

  async function handleNewEntry() {
    const kind = filter.kind ?? "note";
    try {
      await openCreated(await api.createEntry(kind, ""));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function handleExportAll() {
    if (exporting) return;
    const dir = await api.pickDirectory();
    if (!dir) return;
    setExporting(true);
    try {
      const res = await api.journalExport(dir);
      toast(`Diekspor ${res.count} entri ke ${res.dir}`, "info");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setExporting(false);
    }
  }

  async function handleApplyTemplate(template: JournalTemplate) {
    setMenuOpen(false);
    try {
      const created = await api.createEntry(template.kind, template.title);
      await api.updateItem(created.id, { body: template.body });
      created.body = template.body;
      await openCreated(created);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function handlePromptSelect(promptText: string) {
    try {
      await openCreated(await api.createEntry("note", promptText));
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  function handleIdeaSelect(id: string) {
    setFilter({});
    setSelectedId(id);
  }

  function handleEntryChanged(updated: Entry) {
    if (deletedEntries.current.has(updated.id)) return;
    setCurrentEntry((current) => current?.id === updated.id ? updated : current);
    void loadList(filterRef.current);
    void loadSide();
    onChanged?.();
  }

  const handleAfterSaved = useCallback(() => {
    void loadList(filterRef.current);
    void loadSide();
    onChanged?.();
  }, [loadList, loadSide, onChanged]);

  async function handleDelete(id: string): Promise<boolean> {
    try {
      await api.deleteEntry(id);
      deletedEntries.current.add(id);
      listRequest.current++;
      setSelectedId((current) => current === id ? null : current);
      setCurrentEntry((current) => current?.id === id ? null : current);
      setGroups((current) => current.map((group) => ({
        ...group, entries: group.entries.filter((entry) => entry.id !== id),
      })).filter((group) => group.entries.length > 0));
      onChanged?.();
      toast("Entri dihapus", "info", {
        label: "Urungkan",
        run: () => {
          void handleRestore(id);
        },
      });
      await loadList(filterRef.current);
      void loadSide();
      return true;
    } catch (e) {
      toast(errorMessage(e), "error");
      return false;
    }
  }

  async function handleRestore(id: string) {
    try {
      await api.restoreEntry(id);
      deletedEntries.current.delete(id);
      const restoredGroups = await loadList(filterRef.current);
      if (restoredGroups?.some((group) => group.entries.some((entry) => entry.id === id))) {
        setSelectedId(id);
      }
      void loadSide();
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3.5">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 font-display text-[28px] font-semibold tracking-[-0.01em] text-ink">
          Jurnal
        </h1>
        <span className="text-[13px] text-muted">
          Ide, keluh kesah, dan catatan — tanpa dinilai
        </span>

        <span
          title="Isi jurnal disimpan secara lokal di perangkat"
          className="flex items-center gap-1.5 rounded-full border border-[#4E6A26] px-2.5 py-1 text-xs text-accent"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          Privat · di perangkat
        </span>

        <div className="ml-auto flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onOpenAssistant({ kind: "voice" })}
            className="flex min-h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-sm text-ink transition-colors hover:bg-surface-2"
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
            Catat lewat suara
          </button>
          <button
            type="button"
            onClick={() => void handleExportAll()}
            disabled={exporting}
            className="flex min-h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-4 text-sm text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
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
            >
              <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
              <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            Ekspor Semua
          </button>

          <div className="relative inline-flex items-center">
            <button
              type="button"
              onClick={() => void handleNewEntry()}
              className="flex min-h-10 items-center gap-2 rounded-l-[10px] bg-accent px-4 font-display text-sm font-semibold text-canvas transition-opacity hover:opacity-90 active:opacity-80"
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
              Tulis
            </button>
            <button
              ref={menuButtonRef}
              type="button"
              aria-label="Entri baru ▾"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="flex min-h-10 items-center justify-center rounded-r-[10px] border-l border-canvas/20 bg-accent px-2.5 text-canvas transition-opacity hover:opacity-90 active:opacity-80"
            >
              <span className="sr-only">Entri baru</span>
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
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>

            {menuOpen && (
              <div
                ref={menuRef}
                role="menu"
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setMenuOpen(false);
                    menuButtonRef.current?.focus();
                  }
                }}
                className="absolute right-0 top-full z-30 mt-1.5 flex w-72 flex-col rounded-xl border border-line bg-surface p-1.5 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void handleNewEntry();
                  }}
                  className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-2"
                >
                  <span className="text-xs font-semibold text-ink">Entri kosong</span>
                  <span className="text-[11px] text-muted">Mulai menulis dari halaman kosong</span>
                </button>

                <div className="my-1 h-px bg-line" role="separator" />

                {JOURNAL_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    role="menuitem"
                    onClick={() => void handleApplyTemplate(tmpl)}
                    className="flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-2"
                  >
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-xs font-semibold text-ink">{tmpl.label}</span>
                      <span className="truncate text-[11px] text-muted">{tmpl.description}</span>
                    </div>
                    <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                      {KIND_META[tmpl.kind].label}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Three columns: 296px | 1fr | 272px */}
      <div className="grid min-h-0 flex-1 grid-cols-[296px_minmax(0,1fr)_272px] gap-4">
        <EntryList
          groups={groups}
          selectedId={selectedId}
          onSelect={setSelectedId}
          filter={filter}
          onFilterChange={handleFilterChange}
        />

        {currentEntry ? (
          <EntryEditor
            key={currentEntry.id}
            onOpenAssistant={onOpenAssistant}
            entry={currentEntry}
            onEntryChanged={handleEntryChanged}
            onOpenTask={onOpenItem}
            onAfterSaved={handleAfterSaved}
            onDelete={handleDelete}
            onTagClick={(tag) => handleFilterChange({ tag })}
            onOpenSettings={onOpenSettings}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-[14px] border border-line bg-surface p-6 text-center text-sm text-muted">
            Belum ada entri. Mulai dari pemantik di kanan, atau tekan Tulis.
          </div>
        )}

        <JournalSide
          side={side}
          selectedDate={filter.date}
          onSelectDate={handleDateSelect}
          onSelectPrompt={handlePromptSelect}
          onPromptSelect={handlePromptSelect}
          onSelectIdea={handleIdeaSelect}
          onIdeaSelect={handleIdeaSelect}
          onSelectEntry={(id) => setSelectedId(id)}
          onSummaryCreated={(entry) => void openCreated(entry)}
        />
      </div>
    </div>
  );
}
