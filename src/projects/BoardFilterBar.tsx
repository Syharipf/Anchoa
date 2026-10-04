import type { BoardFilter, DueFilter, Priority } from "../api";
import { FIELD } from "../shell/ui";
import { hasFilter } from "./view";

const SELECT = `${FIELD} py-1.5 px-2.5 text-xs`;

export function BoardFilterBar({
  filter,
  tags,
  onChange,
}: Readonly<{ filter: BoardFilter; tags: readonly string[]; onChange: (filter: BoardFilter) => void }>) {
  return (
    <div role="search" aria-label="Saring tugas" className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        aria-label="Cari tugas"
        placeholder="Cari tugas…"
        value={filter.query ?? ""}
        onChange={(e) => onChange({ ...filter, query: e.target.value || undefined })}
        className={`${FIELD} w-56 py-1.5 text-xs`}
      />
      <select
        aria-label="Saring tag"
        value={filter.tag ?? ""}
        className={SELECT}
        onChange={(e) => onChange({ ...filter, tag: e.target.value || undefined })}
      >
        <option value="">Semua tag</option>
        {tags.map((tag) => (
          <option key={tag} value={tag}>
            #{tag}
          </option>
        ))}
      </select>
      <select
        aria-label="Saring prioritas"
        value={filter.priority ?? ""}
        className={SELECT}
        onChange={(e) =>
          onChange({
            ...filter,
            priority: e.target.value ? (Number(e.target.value) as Priority) : undefined,
          })
        }
      >
        <option value="">Semua prioritas</option>
        <option value="1">Tinggi</option>
        <option value="2">Sedang</option>
        <option value="3">Rendah</option>
      </select>
      <select
        aria-label="Saring tenggat"
        value={filter.due ?? ""}
        className={SELECT}
        onChange={(e) =>
          onChange({ ...filter, due: (e.target.value || undefined) as DueFilter | undefined })
        }
      >
        <option value="">Semua tenggat</option>
        <option value="overdue">Terlambat</option>
        <option value="week">7 hari ke depan</option>
        <option value="none">Tanpa tenggat</option>
      </select>
      {hasFilter(filter) && (
        <button
          type="button"
          onClick={() => onChange({})}
          className="text-xs text-muted hover:text-ink transition-colors"
        >
          Reset
        </button>
      )}
    </div>
  );
}
