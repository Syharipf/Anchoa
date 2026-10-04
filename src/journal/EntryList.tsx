import { useEffect, useState } from "react";
import type { EntryKind, EntrySummary, Group, JournalFilter } from "../api";
import { KIND_META, MOODS, moodBars } from "./view";

const FILTERS: readonly { readonly id: EntryKind | undefined; readonly label: string }[] = [
  { id: undefined, label: "Semua" },
  { id: "idea", label: "Ide" },
  { id: "vent", label: "Curhat" },
  { id: "note", label: "Catatan" },
];

function moodLabel(mood: number | null): string {
  if (!mood) return "Suasana hati belum diisi";
  const label = MOODS[mood - 1];
  return `Suasana hati: ${label}`;
}

function EntryCard({
  entry,
  isSelected,
  onSelect,
}: Readonly<{
  entry: EntrySummary;
  isSelected: boolean;
  onSelect: (id: string) => void;
}>) {
  const meta = KIND_META[entry.kind];
  const isIdea = entry.kind === "idea";
  const iconColor = isIdea ? "text-accent" : "text-muted";
  const borderClass = isSelected ? "border-[#2E3440]" : "border-transparent";
  const bgClass = isSelected ? "bg-surface-2" : "bg-transparent";
  const bars = moodBars(entry.mood);

  return (
    <button
      type="button"
      aria-pressed={isSelected}
      onClick={() => onSelect(entry.id)}
      className={`flex w-full flex-col gap-1 rounded-[10px] border p-2.5 text-left transition-colors hover:bg-surface-2 ${borderClass} ${bgClass}`}
    >
      <span className="flex items-center gap-1.5 text-[11px] text-muted">
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
          className={`shrink-0 ${iconColor}`}
        >
          <path d={meta.icon} />
        </svg>
        <span>{meta.label}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono">{entry.time}</span>

        <span
          role="img"
          aria-label={moodLabel(entry.mood)}
          className="ml-auto flex h-2.5 items-end gap-0.5"
        >
          {bars.map((b, idx) => (
            <span
              key={idx}
              style={{ height: `${b.h}px`, backgroundColor: b.c }}
              className="w-[3px] rounded-xs"
            />
          ))}
        </span>
      </span>

      <span className="text-[13px] font-medium text-ink">
        {entry.title || "Tanpa judul"}
      </span>

      <span className="line-clamp-2 text-xs leading-relaxed text-muted">
        {entry.preview || "Belum ada isi."}
      </span>
    </button>
  );
}

export function EntryList({
  groups,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
}: Readonly<{
  groups: readonly Group[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: JournalFilter;
  onFilterChange: (patch: Partial<JournalFilter>) => void;
}>) {
  const query = filter.query ?? "";
  const [localQuery, setLocalQuery] = useState(query);

  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  // Debounce search input by 250ms
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (localQuery !== query) onFilterChange({ query: localQuery || undefined });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [localQuery, query, onFilterChange]);

  const totalEntries = groups.reduce((acc, g) => acc + g.entries.length, 0);
  const filtered = Boolean(filter.query || filter.kind || filter.tag || filter.mood || filter.date);
  return (
    <section
      aria-label="Daftar entri"
      className="flex min-h-0 flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-3"
    >
      {/* Search Input */}
      <label className="flex h-9 items-center gap-2 rounded-[9px] border border-line bg-canvas px-2.5 transition-colors focus-within:border-field-focus">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="shrink-0 text-muted"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
          aria-label="Cari di jurnal"
          placeholder="Cari di jurnal (di perangkat)…"
          className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none placeholder:text-muted focus:outline-none"
        />
      </label>

      {/* Filter jenis */}
      <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0">
        <legend className="sr-only">Saring jenis</legend>
        {FILTERS.map((f) => {
          const active = filter.kind === f.id;
          const bgClass = active ? "bg-surface-2 text-ink font-medium" : "text-muted hover:bg-surface-2";
          return (
            <button
              key={f.label}
              type="button"
              aria-pressed={active}
              onClick={() => onFilterChange({ kind: f.id })}
              className={`flex min-h-7 items-center rounded-md px-2.5 text-xs transition-colors ${bgClass}`}
            >
              {f.label}
            </button>
          );
        })}
      </fieldset>

      <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0">
        <legend className="sr-only">Saring suasana hati</legend>
        {MOODS.map((label, index) => {
          const mood = index + 1;
          const active = filter.mood === mood;
          const colors = active ? "bg-surface-2 text-ink font-medium" : "text-muted hover:bg-surface-2";
          return (
            <button
              key={mood}
              type="button"
              aria-pressed={active}
              onClick={() => onFilterChange({ mood: active ? undefined : mood })}
              className={`min-h-7 rounded-md px-2 text-xs transition-colors ${colors}`}
            >
              {label}
            </button>
          );
        })}
      </fieldset>

      {(filter.tag || filter.mood || filter.date) && (
        <div aria-label="Saringan aktif" className="flex flex-wrap gap-1.5">
          {filter.date && (
            <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">
              Tanggal: {filter.date}
              <button
                type="button"
                aria-label={`Hapus saringan tanggal ${filter.date}`}
                onClick={() => onFilterChange({ date: undefined })}
                className="ml-0.5 min-h-6 min-w-6 text-xs hover:text-ink"
              >
                ×
              </button>
            </span>
          )}
          {filter.tag && (
            <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted">
              #{filter.tag}
              <button
                type="button"
                aria-label={`Hapus saringan tag ${filter.tag}`}
                onClick={() => onFilterChange({ tag: undefined })}
                className="ml-0.5 min-h-6 min-w-6 text-xs hover:text-ink"
              >
                ×
              </button>
            </span>
          )}
          {filter.mood && (
            <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">
              Suasana {filter.mood}
              <button
                type="button"
                aria-label="Hapus saringan suasana hati"
                onClick={() => onFilterChange({ mood: undefined })}
                className="ml-0.5 min-h-6 min-w-6 hover:text-ink"
              >
                ×
              </button>
            </span>
          )}
        </div>
      )}

      {/* Groups & Entries */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-0.5">
        {totalEntries === 0 ? (
          <p className="p-3 text-xs leading-relaxed text-muted">
            {filtered
              ? "Tidak ada entri yang cocok dengan saringan."
              : "Belum ada entri. Mulai dari pemantik di kanan, atau tekan Tulis."}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-0.5">
              <span className="px-1.5 pt-2 pb-1 text-[11px] font-medium tracking-[0.08em] text-muted uppercase">
                {group.label}
              </span>
              {group.entries.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  isSelected={entry.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
