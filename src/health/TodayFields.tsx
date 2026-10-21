import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type HealthKind, type HealthToday } from "../api";
import { useToast } from "../shell/toast";
import {
  FIELD_LABEL,
  UNITS,
  deltaColor,
  formatDelta,
  formatInput,
  parseValue,
} from "./view";

const KINDS: HealthKind[] = ["weight_g", "sleep_min", "steps", "resting_hr"];

const GLYPHS: Record<HealthKind, string> = {
  weight_g: "◍",
  sleep_min: "☾",
  steps: "≡",
  resting_hr: "♥",
};

export interface TodayFieldsProps {
  today: HealthToday | null;
  onSaved: () => void;
}

export function TodayFields({ today, onSaved }: Readonly<TodayFieldsProps>) {
  const toast = useToast();

  const [drafts, setDrafts] = useState<Record<HealthKind, string>>(() => {
    const initial: Record<HealthKind, string> = {
      weight_g: "",
      sleep_min: "",
      steps: "",
      resting_hr: "",
    };
    if (today) {
      for (const k of KINDS) {
        const field = today.fields.find((f) => f.kind === k);
        initial[k] = field && field.value !== null ? formatInput(k, field.value) : "";
      }
    }
    return initial;
  });

  const getTodayField = useCallback(
    (k: HealthKind) => today?.fields.find((f) => f.kind === k),
    [today],
  );

  useEffect(() => {
    if (!today) return;
    const next: Record<HealthKind, string> = {
      weight_g: "",
      sleep_min: "",
      steps: "",
      resting_hr: "",
    };
    for (const k of KINDS) {
      const field = today.fields.find((f) => f.kind === k);
      next[k] = field && field.value !== null ? formatInput(k, field.value) : "";
    }
    setDrafts(next);
  }, [today]);

  const handleCommit = async (kind: HealthKind) => {
    if (!today) return;
    const currentField = getTodayField(kind);
    const draft = drafts[kind];
    const parsed = parseValue(kind, draft);

    // If both are empty or unchanged, noop
    if (parsed === null) {
      if (draft.trim() !== "") {
        toast(`Enter a valid ${FIELD_LABEL[kind].toLowerCase()}`, "error");
        setDrafts((prev) => ({
          ...prev,
          [kind]: currentField?.value !== null && currentField?.value !== undefined
            ? formatInput(kind, currentField.value)
            : "",
        }));
        return;
      }
      if (currentField?.value === null || currentField?.value === undefined) {
        return;
      }
      // If user cleared an existing value, delete metric
      try {
        await api.deleteHealthMetric(kind, today.date);
        onSaved();
      } catch (err) {
        toast(errorMessage(err), "error");
      }
      return;
    }

    if (currentField?.value === parsed) {
      return;
    }

    try {
      await api.saveHealthMetric(kind, today.date, parsed);
      onSaved();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  return (
    <section
      aria-labelledby="hl-today"
      className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-3.5 px-4"
    >
      <div className="flex items-baseline gap-2.5">
        <h2
          id="hl-today"
          className="m-0 font-display text-[15px] font-semibold text-ink"
        >
          Today
        </h2>
        <span className="text-[11px] text-muted">Saves on blur or Enter</span>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {KINDS.map((kind) => {
          const field = getTodayField(kind);
          const delta = field?.delta ?? null;
          const color = deltaColor(kind, delta);
          const deltaText = delta !== null ? `${formatDelta(kind, delta)} vs 7-day avg` : "—";

          return (
            <label
              key={kind}
              data-field
              className="flex flex-col gap-1 rounded-[10px] border border-line bg-surface-2 p-2 px-2.5 transition-colors focus-within:border-accent"
            >
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <span aria-hidden="true" className={color}>
                  {GLYPHS[kind]}
                </span>
                {FIELD_LABEL[kind]}
              </span>

              <span className="flex items-baseline gap-1.5">
                <input
                  type="text"
                  value={drafts[kind]}
                  aria-label={FIELD_LABEL[kind]}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [kind]: e.target.value }))
                  }
                  onBlur={() => void handleCommit(kind)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    }
                  }}
                  className="w-full min-w-0 border-0 bg-transparent font-mono text-[19px] text-ink outline-none"
                />
                <span className="text-[11px] text-muted">{UNITS[kind]}</span>
              </span>

              <span className={`text-[11px] ${color}`}>{deltaText}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
