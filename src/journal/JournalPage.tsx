import { useCallback, useEffect, useState } from "react";
import type { OpenAssistant } from "../assistant/useAssistantRequest";
import {
  api,
  errorMessage,
  type Entry,
  type EntryKind,
  type Group,
  type Side as JournalSideData,
} from "../api";
import { useToast } from "../shell/toast";
import { EntryEditor } from "./EntryEditor";
import { EntryList } from "./EntryList";
import { JournalSide } from "./JournalSide";

export function JournalPage({
  onOpenItem,
  onChanged,
  onOpenAssistant,
}: Readonly<{
  onOpenItem: (id: string) => void;
  onChanged?: () => void;
  onOpenAssistant: OpenAssistant;
}>) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<EntryKind | undefined>(undefined);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentEntry, setCurrentEntry] = useState<Entry | null>(null);
  const [side, setSide] = useState<JournalSideData | null>(null);

  const loadList = useCallback(
    async (q: string, kind?: EntryKind) => {
      try {
        const res = await api.journalList(q || undefined, kind);
        setGroups(res.groups);
        return res.groups;
      } catch (e) {
        toast(errorMessage(e), "error");
        return [];
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

  // Load list and side data when query or filter changes
  useEffect(() => {
    let active = true;
    void loadList(query, kindFilter).then((newGroups) => {
      if (!active) return;
      const allEntries = newGroups.flatMap((g) => g.entries);
      if (allEntries.length === 0) {
        setSelectedId(null);
        setCurrentEntry(null);
      } else {
        const stillSelected = allEntries.some((e) => e.id === selectedId);
        if (!stillSelected) {
          setSelectedId(allEntries[0].id);
        }
      }
    });
    void loadSide();
    return () => {
      active = false;
    };
  }, [query, kindFilter, loadList, loadSide, selectedId]);

  // Load selected entry details
  useEffect(() => {
    if (!selectedId) {
      setCurrentEntry(null);
      return;
    }
    let active = true;
    api.journalEntry(selectedId).then(
      (entry) => {
        if (active) setCurrentEntry(entry);
      },
      (e) => {
        if (active) toast(errorMessage(e), "error");
      },
    );
    return () => {
      active = false;
    };
  }, [selectedId, toast]);

  async function handleNewEntry() {
    const kind = kindFilter ?? "note";
    try {
      const created = await api.createEntry(kind, "");
      setSelectedId(created.id);
      setCurrentEntry(created);
      await loadList(query, kindFilter);
      await loadSide();
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  async function handlePromptSelect(promptText: string) {
    try {
      const created = await api.createEntry("note", promptText);
      setSelectedId(created.id);
      setCurrentEntry(created);
      await loadList(query, kindFilter);
      await loadSide();
      onChanged?.();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  function handleIdeaSelect(id: string) {
    setKindFilter(undefined);
    setSelectedId(id);
  }

  function handleEntryChanged(updated: Entry) {
    setCurrentEntry(updated);
    void loadList(query, kindFilter);
    void loadSide();
    onChanged?.();
  }

  function handleAfterSaved() {
    void loadList(query, kindFilter);
    void loadSide();
    onChanged?.();
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
              stroke="currentColor"
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
            onClick={() => void handleNewEntry()}
            className="flex min-h-10 items-center gap-2 rounded-[10px] bg-accent px-4 font-display text-sm font-semibold text-canvas transition-transform hover:scale-105 active:scale-95"
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
        </div>
      </header>

      {/* Three columns: 296px | 1fr | 272px */}
      <div className="grid min-h-0 flex-1 grid-cols-[296px_minmax(0,1fr)_272px] gap-4">
        <EntryList
          groups={groups}
          selectedId={selectedId}
          onSelect={setSelectedId}
          query={query}
          onQueryChange={setQuery}
          kindFilter={kindFilter}
          onKindFilterChange={setKindFilter}
        />

        {currentEntry ? (
          <EntryEditor
            onOpenAssistant={onOpenAssistant}
            entry={currentEntry}
            onEntryChanged={handleEntryChanged}
            onOpenTask={onOpenItem}
            onAfterSaved={handleAfterSaved}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-[14px] border border-line bg-surface p-6 text-center text-sm text-muted">
            Belum ada entri. Mulai dari pemantik di kanan, atau tekan Tulis.
          </div>
        )}

        <JournalSide
          side={side}
          onSelectPrompt={handlePromptSelect}
          onSelectIdea={handleIdeaSelect}
        />
      </div>
    </div>
  );
}
