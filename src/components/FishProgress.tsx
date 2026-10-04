import { useId } from "react";

export type FishProgressState = "running" | "paused" | "done" | "error";
export type FishProgressTone = "accent" | "warning" | "danger";

export interface FishProgressProps {
  value?: number;
  label: string;
  state?: FishProgressState;
  className?: string;
  tone?: FishProgressTone;
  role?: "progressbar" | "meter";
}

/**
 * Deterministic anchovy silhouette from assistant/School.tsx (DESIGN.md §4).
 * Coordinates centered at origin, swim direction pointing +X (right).
 */
const BODY = "M-7 0C-3-2.4 3-2.6 7 0C3 2.6-3 2.4-7 0ZM-6 0L-10.5-2.8L-9.2 0L-10.5 2.8Z";

interface FishSpec {
  x: number;      // percent along track (0..100)
  y: number;      // percent of track height
  width: number;  // pixel width
  height: number; // pixel height
  opacity: number;
  delay: number;  // animation phase delay in seconds
}

/** 12 deterministic positions across the horizontal track. */
const FISH_SCHOOL: readonly FishSpec[] = [
  { x: 4,  y: 35, width: 15, height: 7, opacity: 0.8,  delay: 0.0 },
  { x: 12, y: 55, width: 17, height: 8, opacity: 0.85, delay: 0.2 },
  { x: 20, y: 30, width: 14, height: 7, opacity: 0.75, delay: 0.4 },
  { x: 29, y: 60, width: 18, height: 8, opacity: 0.9,  delay: 0.1 },
  { x: 38, y: 38, width: 16, height: 7, opacity: 0.8,  delay: 0.3 },
  { x: 47, y: 58, width: 17, height: 8, opacity: 0.85, delay: 0.5 },
  { x: 56, y: 32, width: 15, height: 7, opacity: 0.8,  delay: 0.15 },
  { x: 65, y: 62, width: 19, height: 9, opacity: 0.95, delay: 0.35 },
  { x: 74, y: 40, width: 16, height: 8, opacity: 0.85, delay: 0.05 },
  { x: 82, y: 56, width: 17, height: 8, opacity: 0.9,  delay: 0.25 },
  { x: 90, y: 34, width: 15, height: 7, opacity: 0.8,  delay: 0.45 },
  { x: 96, y: 52, width: 18, height: 8, opacity: 0.95, delay: 0.1 },
];

const TONE_CLASSES: Readonly<Record<FishProgressTone, string>> = {
  accent: "text-accent",
  warning: "text-warn",
  danger: "text-danger",
};

/**
 * Global anchovy-school linear progress bar & meter.
 * Uses native SVG + CSS transform animations (no React RAF timers).
 * Automatically obeys prefers-reduced-motion via [data-anim].
 */
function renderFishSchool(isRunning: boolean, animationSpec: string, fill: string, className?: string) {
  return (
    <g
      data-anim
      className="anchoa-fish-school"
      style={{
        animation: isRunning ? `${animationSpec} infinite` : "none",
        animationPlayState: isRunning ? "running" : "paused",
      }}
    >
      {FISH_SCHOOL.map((f, i) => (
        <svg
          key={i}
          x={`${f.x}%`}
          y={`${f.y}%`}
          width={f.width}
          height={f.height}
          viewBox="-10.5 -3.5 18 7"
          overflow="visible"
          aria-hidden="true"
          style={{ overflow: "visible" }}
        >
          <g
            data-anim
            style={{
              animation: isRunning ? `anchoa-fish-wiggle 1.2s ease-in-out ${f.delay}s infinite` : "none",
              animationPlayState: isRunning ? "running" : "paused",
              transformOrigin: "0 0",
            }}
          >
            <path d={BODY} fill={fill} fillOpacity={f.opacity} className={className} />
          </g>
        </svg>
      ))}
    </g>
  );
}

export function FishProgress({
  value,
  label,
  state = "running",
  className = "",
  tone,
  role = "progressbar",
}: Readonly<FishProgressProps>) {
  const rawId = useId();
  const clipId = `fish-clip-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const isDeterminate = typeof value === "number" && !Number.isNaN(value);
  const clamped = isDeterminate ? Math.max(0, Math.min(100, value!)) : 0;
  const isDone = state === "done" || (isDeterminate && clamped >= 100);
  const isRunning = state === "running" && !isDone;

  const resolvedTone: FishProgressTone =
    tone ?? (state === "error" ? "danger" : "accent");

  const toneClass =
    isDone && !tone ? "text-field-focus" : TONE_CLASSES[resolvedTone];

  const hasHeight = /\bh-\S+/.test(className);
  const heightClass = hasHeight ? "" : "h-2.5";

  return (
    <div
      role={role}
      aria-label={label}
      aria-valuemin={isDeterminate ? 0 : undefined}
      aria-valuemax={isDeterminate ? 100 : undefined}
      aria-valuenow={isDeterminate ? Math.round(clamped) : undefined}
      className={`relative w-full overflow-hidden rounded-full border border-line/60 bg-surface-2 ${heightClass} ${className}`}
    >
      <svg
        data-anim
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          <clipPath id={clipId}>
            <rect
              x="0"
              y="0"
              width={isDeterminate ? `${clamped}%` : "100%"}
              height="100%"
              rx="9999"
            />
          </clipPath>
        </defs>

        {isDeterminate ? (
          <g clipPath={`url(#${clipId})`}>
            {/* Filled bar track */}
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="currentColor"
              className={toneClass}
            />

            {/* Anchovy silhouettes swimming inside filled region */}
            {renderFishSchool(isRunning, "anchoa-swim 3.5s ease-in-out", "#0F1115")}
          </g>
        ) : (
          /* Indeterminate state: fish loop continuously across the track */
          <g>
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              rx="9999"
              fill="currentColor"
              opacity="0.12"
              className={toneClass}
            />
            {renderFishSchool(isRunning, "anchoa-swim-loop 3s linear", "currentColor", toneClass)}
          </g>
        )}
      </svg>
    </div>
  );
}
