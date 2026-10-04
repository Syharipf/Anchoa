import { useId } from "react";

export type FishProgressState = "running" | "paused" | "done" | "error";
export type FishProgressTone = "accent" | "warning" | "danger";

export interface FishProgressProps {
  readonly value?: number;
  readonly label: string;
  readonly state?: FishProgressState;
  readonly className?: string;
  readonly tone?: FishProgressTone;
  readonly role?: "progressbar" | "meter";
}

/**
 * Anchovy silhouette from artboard Unduhan.dc.html (and assistant/School.tsx).
 * Origin at center, pointing right +X.
 */
const BODY = "M-7 0C-3-2.4 3-2.6 7 0C3 2.6-3 2.4-7 0ZM-6 0L-10.5-2.8L-9.2 0L-10.5 2.8Z";

/**
 * 7 anchovies in deterministic 72x12 tile from artboard Unduhan.dc.html (FB_IMG.run).
 * Guarantees uniform fish density across arbitrary track widths via repeat-x tile.
 */
interface TileFish {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly opacity: number;
}

const TILE_FISH: readonly TileFish[] = [
  { x: 6.0, y: 3.7, scale: 0.5, opacity: 0.75 },
  { x: 15.0, y: 8.3, scale: 0.64, opacity: 1.0 },
  { x: 25.5, y: 4.3, scale: 0.58, opacity: 0.9 },
  { x: 35.5, y: 8.6, scale: 0.5, opacity: 0.7 },
  { x: 45.0, y: 3.6, scale: 0.66, opacity: 1.0 },
  { x: 55.5, y: 8.0, scale: 0.56, opacity: 0.85 },
  { x: 65.5, y: 4.2, scale: 0.5, opacity: 0.75 },
] as const;

/**
 * Global anchovy-school progress bar & meter.
 * Matches Unduhan.dc.html artboard visual specification:
 * - 72x12px seamless repeat-x tile
 * - Linear translateX(-72px) to 0 loop animation
 * - Exact tint colors per state (run: lime, pause: gray, done: olive, error: coral track)
 *
 * ponytail: lead fish dot at track head omitted; add when canvas HUD particles are added
 */
export function FishProgress({
  value,
  label,
  state = "running",
  className = "",
  tone,
  role = "progressbar",
}: Readonly<FishProgressProps>) {
  const rawId = useId();
  const patternId = `fish-pat-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const clipId = `fish-clip-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const isDeterminate = typeof value === "number" && !Number.isNaN(value);
  const clamped = isDeterminate ? Math.max(0, Math.min(100, value!)) : 0;
  const isDone = state === "done";
  const isError = state === "error";

  // Visual parameters aligned with Unduhan.dc.html:289-299 fishBar()
  let pct = isDeterminate ? clamped : 100;
  let trackBg = "#1A1E25";
  let tintBg = "rgba(198,243,107,0.14)";
  let fishColor: string | null = "#C6F36B";
  let isAnimated = state === "running" && !isDone && !isError;

  if (isError) {
    pct = 0;
    trackBg = "rgba(255,138,122,0.12)";
    tintBg = "transparent";
    fishColor = null;
    isAnimated = false;
  } else if (isDone) {
    pct = 100;
    trackBg = "#1A1E25";
    tintBg = "rgba(78,106,38,0.16)";
    fishColor = "#4E6A26";
    isAnimated = false;
  } else if (state === "paused") {
    trackBg = "#1A1E25";
    tintBg = "rgba(91,100,117,0.16)";
    fishColor = "#5B6475";
    isAnimated = false;
  } else if (tone === "danger") {
    trackBg = "#1A1E25";
    tintBg = "rgba(255,138,122,0.16)";
    fishColor = "#FF8A7A";
    isAnimated = false;
  } else if (tone === "warning") {
    tintBg = "rgba(229,168,59,0.16)";
    fishColor = "#E5A83B";
  }

  const hasHeight = /\bh-\S+/.test(className);
  const heightClass = hasHeight ? "" : "h-3";

  return (
    <div
      role={role}
      aria-label={label}
      aria-valuemin={isDeterminate ? 0 : undefined}
      aria-valuemax={isDeterminate ? 100 : undefined}
      aria-valuenow={isDeterminate ? Math.round(clamped) : undefined}
      style={{ backgroundColor: trackBg }}
      className={`relative w-full overflow-hidden rounded-[6px] ${heightClass} ${className}`}
    >
      <svg
        data-anim
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
      >
        <defs>
          {fishColor ? (
            <pattern
              id={patternId}
              width="72"
              height="12"
              patternUnits="userSpaceOnUse"
            >
              {TILE_FISH.map((f, i) => (
                <g
                  key={i}
                  transform={`translate(${f.x.toFixed(2)} ${f.y.toFixed(2)}) scale(${f.scale.toFixed(2)} ${f.scale.toFixed(2)})`}
                >
                  <path
                    d={BODY}
                    fill={fishColor}
                    fillOpacity={f.opacity}
                  />
                </g>
              ))}
            </pattern>
          ) : null}
          <clipPath id={clipId}>
            <rect
              x="0"
              y="0"
              width={`${pct}%`}
              height="100%"
              rx="6"
            />
          </clipPath>
        </defs>

        {pct > 0 ? (
          <g clipPath={`url(#${clipId})`}>
            {/* Soft tinted bar fill */}
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill={tintBg}
            />

            {/* Anchovy tile with seamless 72px linear shift */}
            {fishColor ? (
              <rect
                data-anim
                className="anchoa-fish-school"
                y="0"
                width="calc(100% + 72px)"
                height="100%"
                fill={`url(#${patternId})`}
                style={{
                  animation: isAnimated ? "anchoa-swim 3.5s linear infinite" : "none",
                  animationPlayState: isAnimated ? "running" : "paused",
                }}
              />
            ) : null}
          </g>
        ) : null}
      </svg>
    </div>
  );
}
