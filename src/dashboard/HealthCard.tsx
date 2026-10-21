import type { HealthToday } from "../api";
import type { PageId } from "../shell/nav";
import { formatDelta, formatValue } from "../health/view";

export function HealthCard({
  today,
  onSelect,
}: Readonly<{
  today?: HealthToday;
  onSelect: (page: PageId) => void;
}>) {
  if (!today) return null;

  const weight = today.fields.find((f) => f.kind === "weight_g");
  const sleep = today.fields.find((f) => f.kind === "sleep_min");
  const steps = today.fields.find((f) => f.kind === "steps");
  const rhr = today.fields.find((f) => f.kind === "resting_hr");

  // Hide card if all 4 values are null
  const allNull =
    (weight?.value === null || weight?.value === undefined) &&
    (sleep?.value === null || sleep?.value === undefined) &&
    (steps?.value === null || steps?.value === undefined) &&
    (rhr?.value === null || rhr?.value === undefined);

  if (allNull) return null;

  return (
    <button
      type="button"
      onClick={() => onSelect("health")}
      className="flex w-full flex-col items-start gap-2 overflow-hidden rounded-[14px] border border-line bg-surface p-3 px-3.5 text-left text-ink transition-colors hover:bg-surface-2"
    >
      <div className="flex w-full items-center gap-2">
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted"
          aria-hidden="true"
        >
          <path d="M3 12h4l2-6 4 12 2-6h6" />
        </svg>
        <span id="c-health" className="font-display text-sm font-semibold text-ink">
          Health
        </span>
        <span className="ml-auto text-xs text-accent">›</span>
      </div>

      <div className="grid w-full grid-cols-3 gap-2">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted">Weight</span>
          <span className="font-mono text-sm font-semibold text-ink">
            {formatValue("weight_g", weight?.value ?? null)}
            {weight?.value !== null && weight?.value !== undefined ? (
              <span className="ml-0.5 text-[10px] font-normal text-muted">kg</span>
            ) : null}
          </span>
          <span className="text-[10px] text-muted">
            {weight?.delta !== null && weight?.delta !== undefined
              ? formatDelta("weight_g", weight.delta)
              : "—"}
          </span>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted">Sleep</span>
          <span className="font-mono text-sm font-semibold text-ink">
            {formatValue("sleep_min", sleep?.value ?? null)}
          </span>
          <span className="text-[10px] text-muted">
            {sleep?.delta !== null && sleep?.delta !== undefined
              ? formatDelta("sleep_min", sleep.delta)
              : "—"}
          </span>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted">Steps</span>
          <span className="font-mono text-sm font-semibold text-ink">
            {formatValue("steps", steps?.value ?? null)}
          </span>
          <span className="text-[10px] text-muted">
            {steps?.delta !== null && steps?.delta !== undefined
              ? formatDelta("steps", steps.delta)
              : "—"}
          </span>
        </div>
      </div>
    </button>
  );
}
