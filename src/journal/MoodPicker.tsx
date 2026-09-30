import { MOODS } from "./view";

export function MoodPicker({
  mood,
  onChange,
  disabled = false,
}: Readonly<{
  mood: number | null;
  onChange: (mood: number | null) => void;
  disabled?: boolean;
}>) {
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend id="j-mood" className="text-xs text-muted">
        Suasana hati
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {MOODS.map((label, idx) => {
          const level = idx + 1;
          const active = mood === level;
          const barHeight = 4 + level * 2.4;
          const borderClass = active ? "border-[#4E6A26]" : "border-line";
          const bgClass = active ? "bg-surface-2" : "bg-transparent";
          const textClass = active ? "text-ink" : "text-muted hover:border-disabled";
          const barBg = active ? "bg-accent" : "bg-[#5B6475]";

          return (
            <button
              key={level}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onChange(active ? null : level)}
              className={`flex min-h-[34px] items-center gap-1.5 rounded-[9px] border px-2.5 text-xs transition-colors ${borderClass} ${bgClass} ${textClass}`}
            >
              <span
                aria-hidden="true"
                style={{ height: `${barHeight}px` }}
                className={`w-1 rounded-sm ${barBg}`}
              />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
