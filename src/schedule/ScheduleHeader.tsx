import type { ItemKind } from "../api";
import type { OpenAssistant } from "../assistant/useAssistantRequest";
import { H1, HEADER_SECONDARY } from "../shell/ui";
import { ALL_KINDS, KIND_COLORS, KIND_LABELS } from "./layout";

export function ScheduleHeader({
  view,
  onViewChange,
  periodLabel,
  onPrev,
  onNext,
  onToday,
  off,
  onToggleKind,
  counts,
  onOpenAssistant,
}: Readonly<{
  view: "calendar" | "timeline";
  onViewChange: (v: "calendar" | "timeline") => void;
  periodLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  off: ReadonlySet<ItemKind>;
  onToggleKind: (kind: ItemKind) => void;
  counts: Readonly<Record<ItemKind, number>>;
  onOpenAssistant: OpenAssistant;
}>) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center gap-3.5">
        <h1 className={H1}>Jadwal</h1>
        <fieldset className="m-0 flex gap-0.5 rounded-[10px] border border-line bg-surface p-[3px]">
          <legend className="sr-only">Tampilan</legend>
          <button
            type="button"
            onClick={() => onViewChange("calendar")}
            aria-pressed={view === "calendar"}
            className={`flex min-h-8 items-center gap-1.5 rounded-[7px] px-3 text-[13px] transition-colors ${
              view === "calendar"
                ? "bg-surface-2 text-ink font-medium"
                : "text-muted hover:text-ink"
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
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
            Kalender
          </button>
          <button
            type="button"
            onClick={() => onViewChange("timeline")}
            aria-pressed={view === "timeline"}
            className={`flex min-h-8 items-center gap-1.5 rounded-[7px] px-3 text-[13px] transition-colors ${
              view === "timeline"
                ? "bg-surface-2 text-ink font-medium"
                : "text-muted hover:text-ink"
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
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 6h9M8 12h12M4 18h7" />
            </svg>
            Timeline
          </button>
        </fieldset>

        <div className="flex items-center gap-0.5 rounded-[10px] border border-line bg-surface p-0.5">
          <button
            type="button"
            aria-label="Sebelumnya"
            onClick={onPrev}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink transition-colors hover:bg-surface-2"
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
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <span
            aria-live="polite"
            className="min-w-[150px] text-center font-mono text-[13px] text-ink"
          >
            {periodLabel}
          </span>
          <button
            type="button"
            aria-label="Berikutnya"
            onClick={onNext}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ink transition-colors hover:bg-surface-2"
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
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        <button
          type="button"
          onClick={onToday}
          className="min-h-9 rounded-[10px] border border-line bg-transparent px-3 font-display text-[13px] font-medium text-ink transition-colors hover:bg-surface-2"
        >
          Hari ini
        </button>

        <div className="ml-auto flex gap-2.5">
          <button
            type="button"
            onClick={() => onOpenAssistant({ kind: "voice" })}
            className={HEADER_SECONDARY}
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
            <span>Tambah tugas lewat suara</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="mr-1 text-xs text-muted">Tampilkan</span>
        {ALL_KINDS.map((kind) => {
          const active = !off.has(kind);
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onToggleKind(kind)}
              aria-pressed={active}
              className={`flex min-h-[30px] items-center gap-2 rounded-full border px-3 text-xs transition-colors ${
                active
                  ? "border-line bg-surface text-ink hover:bg-surface-2"
                  : "border-line/40 bg-transparent text-muted/50 hover:bg-surface/50"
              }`}
            >
              <span
                className="h-2.5 w-2.5 rounded-[3px]"
                style={{
                  backgroundColor: active ? KIND_COLORS[kind] : "transparent",
                  border: active ? "none" : "1px solid currentColor",
                }}
              />
              {KIND_LABELS[kind]}
              <span className="font-mono text-muted">{counts[kind] ?? 0}</span>
            </button>
          );
        })}
        <div
          aria-hidden="true"
          className="ml-auto flex items-center gap-3.5 text-xs text-muted"
        >
          {view === "timeline" && (
            <>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-[3px] bg-muted" />
                Dikerjakan
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-4 rounded-[3px] border border-muted" />
                Rencana
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rotate-45 bg-muted" />
                Tenggat
              </span>
            </>
          )}
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px] border-[1.5px] border-danger" />
            {' '}Terlambat
          </span>
        </div>
      </div>
    </div>
  );
}
