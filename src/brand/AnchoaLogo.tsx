import {
  useEffect,
  useId,
  useState,
  type AnimationEvent,
  type CSSProperties,
} from "react";
import { LOGO_G } from "./logoData";

export type LogoVariant = "static" | "intro" | "loading" | "idle";

export interface AnchoaLogoProps {
  readonly variant?: LogoVariant;
  readonly tile?: boolean;
  readonly size?: number;
  readonly label?: string;
  readonly paused?: boolean;
  readonly onIntroEnd?: () => void;
  readonly className?: string;
}

const LOGO_STYLES = `
.anchoa-logo { display: block; overflow: visible; }
.anchoa-logo.paused, .anchoa-logo.paused * { animation-play-state: paused !important; }
.anchoa-logo .ring { opacity: 0; }

.anchoa-logo.intro .bf { animation: al-swim-in 1.1s cubic-bezier(.2, .8, .2, 1) both; animation-delay: var(--d); }
.anchoa-logo.intro .sf { animation: al-school-in 0.9s cubic-bezier(.2, .8, .2, 1) both; animation-delay: calc(0.55s + var(--i) * 0.07s); }
.anchoa-logo.intro .dot { transform-box: fill-box; transform-origin: center; animation: al-pop 0.5s cubic-bezier(.3, 1.6, .5, 1) 1.55s both; }
.anchoa-logo.intro .ring { transform-box: fill-box; transform-origin: center; animation: al-ring 0.9s ease-out 1.75s both; }

.anchoa-logo.loading .bf, .anchoa-logo.idle .bf { transform-box: fill-box; transform-origin: 85% 50%; animation: al-sway 2.8s ease-in-out infinite; animation-delay: calc(var(--i) * -0.4s); }
.anchoa-logo.loading .sf { opacity: 0; animation: al-stream 2.4s linear infinite; animation-delay: calc(var(--i) * -0.31s); }
.anchoa-logo.loading .dot { transform-box: fill-box; transform-origin: center; animation: al-breathe 2.4s ease-in-out infinite; }
.anchoa-logo.loading .ring { transform-box: fill-box; transform-origin: center; animation: al-ring 2.4s ease-out infinite; }

.anchoa-logo.idle .bf { animation-duration: 3.6s; animation-name: al-sway-soft; }
.anchoa-logo.idle .dot { transform-box: fill-box; transform-origin: center; animation: al-breathe-soft 3.6s ease-in-out infinite; }

@keyframes al-swim-in { 0% { transform: translateX(-260px); opacity: 0; } 60% { opacity: 1; } 100% { transform: none; opacity: 1; } }
@keyframes al-school-in { 0% { transform: translateX(-160px); opacity: 0; } 100% { transform: none; opacity: 1; } }
@keyframes al-pop { 0% { transform: scale(0); } 100% { transform: scale(1); } }
@keyframes al-ring { 0% { transform: scale(1); opacity: 0; } 8% { opacity: 0.6; } 100% { transform: scale(2.8); opacity: 0; } }
@keyframes al-sway { 0%, 100% { transform: translateX(0) skewY(0); } 50% { transform: translateX(10px) skewY(-1.2deg); } }
@keyframes al-sway-soft { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(6px); } }
@keyframes al-stream {
  0% { transform: translate(calc(var(--ux) * -90px), calc(var(--uy) * -90px)); opacity: 0; }
  25%, 75% { opacity: 1; }
  100% { transform: translate(calc(var(--ux) * 70px), calc(var(--uy) * 70px)); opacity: 0; }
}
@keyframes al-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }
@keyframes al-breathe-soft { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.12); } }

@media (prefers-reduced-motion: reduce) {
  .anchoa-logo * { animation: none !important; opacity: 1 !important; }
  .anchoa-logo .ring { opacity: 0 !important; }
}
`;

const BIG_DELAYS = ["0.15s", "0s", "0.3s"];

export function AnchoaLogo({
  variant = "static",
  tile = false,
  size = 160,
  label = "Anchoa",
  paused = false,
  onIntroEnd,
  className = "",
}: Readonly<AnchoaLogoProps>) {
  const rawId = useId();
  const uid = `al_${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const tiny = size <= 32;
  const viewBox = tile ? "0 0 1024 1024" : "58 200 800 624";
  const height = tile ? size : Math.round((size * 624) / 800);
  const isPaused = paused || hidden;

  const handleAnimationEnd = (e: AnimationEvent<SVGSVGElement>) => {
    if (variant === "intro" && (e.target as Element).classList?.contains("dot")) {
      onIntroEnd?.();
    }
  };

  return (
    <>
      <style>{LOGO_STYLES}</style>
      <svg
        className={`anchoa-logo ${variant} ${isPaused ? "paused" : ""} ${className}`}
        width={size}
        height={height}
        viewBox={viewBox}
        role="img"
        aria-label={label}
        onAnimationEnd={handleAnimationEnd}
      >
        <defs>
          {LOGO_G.small.map((f, i) => (
            <linearGradient
              key={`grad-${f.x1}-${f.y1}`}
              id={`${uid}-s${i}`}
              gradientUnits="userSpaceOnUse"
              x1={f.x1}
              y1={f.y1}
              x2={f.x2}
              y2={f.y2}
            >
              <stop offset="0" stopColor="#CFE3EA" stopOpacity={0.05} />
              <stop offset="0.5" stopColor="#CBEBAB" stopOpacity={0.58} />
              <stop offset="1" stopColor="#C6F36B" />
            </linearGradient>
          ))}
        </defs>
        {tile && <rect width="1024" height="1024" rx="224" fill="#10303A" />}
        <g
          transform={
            tiny && tile
              ? "translate(512 512) scale(1.12) translate(-512 -512)"
              : undefined
          }
        >
          {variant !== "static" && (
            <circle
              className="ring"
              cx={LOGO_G.dot.cx}
              cy={LOGO_G.dot.cy}
              r={LOGO_G.dot.r}
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="5"
            />
          )}
          {!tiny &&
            LOGO_G.small.map((f, i) => (
              <path
                key={`sf-${f.d.slice(0, 20)}`}
                className="sf"
                style={
                  {
                    "--ux": f.ux,
                    "--uy": f.uy,
                    "--i": i,
                  } as CSSProperties & Record<string, string | number>
                }
                d={f.d}
                fill={`url(#${uid}-s${i})`}
              />
            ))}
          {LOGO_G.big.map((d, i) => (
            <path
              key={`bf-${d.slice(0, 20)}`}
              className="bf"
              style={
                {
                  "--i": i,
                  "--d": BIG_DELAYS[i] ?? "0s",
                } as CSSProperties & Record<string, string | number>
              }
              d={d}
              fill="#C6F36B"
            />
          ))}
          <circle
            className="dot"
            cx={LOGO_G.dot.cx}
            cy={LOGO_G.dot.cy}
            r={LOGO_G.dot.r}
            fill="#FFFFFF"
          />
        </g>
      </svg>
    </>
  );
}
