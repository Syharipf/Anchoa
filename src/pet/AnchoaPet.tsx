import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { FRAMES, PET_LABELS, type PetStatus } from "./frames";

export type { PetStatus };
export { PET_LABELS };

export interface AnchoaPetProps {
  readonly status?: PetStatus;
  readonly mood?: 0 | 1 | 2;
  readonly motion?: "penuh" | "hemat" | "diam";
  readonly shadow?: boolean;
  readonly size?: number;
  readonly level?: number | null;
  readonly crop?: "full" | "head";
  readonly sleepAfter?: number;
  readonly paused?: boolean;
  readonly label?: string;
  readonly onPoke?: () => void;
  readonly className?: string;
}

const PET_STYLES = `
.ako { display: inline-block; padding: 0; border: 0; background: none; line-height: 0; color: inherit; }
button.ako { cursor: pointer; border-radius: 12px; }
.ako svg { display: block; width: 100%; height: 100%; overflow: visible; }
.ako.head svg { overflow: hidden; }
.ako.paused * { animation-play-state: paused !important; }
.ako.mini .ak-school,
.ako.tiny .ak-school,
.ako.tiny .ak-fx,
.ako.tiny:not(.head) .ak-hs { display: none; }
.ako.noshade .ak-shade { display: none; }
.ako.lipsync .ak-mo { animation: none !important; opacity: var(--ak-mo); }
.ako.lipsync .ak-mm { animation: none !important; opacity: var(--ak-mm); }
.ako.lipsync .ak-mc { animation: none !important; opacity: var(--ak-mc); }
`;

export function AnchoaPet({
  status = "idle",
  mood = 0,
  motion = "penuh",
  shadow = true,
  size = 240,
  level = null,
  crop = "full",
  sleepAfter = 120_000,
  paused = false,
  label = "Ako",
  onPoke,
  className = "",
}: Readonly<AnchoaPetProps>) {
  const rawId = useId();
  const uid = `ako_${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const hostRef = useRef<HTMLElement>(null);
  const [hidden, setHidden] = useState(false);
  const [reduce, setReduce] = useState(false);
  const [asleep, setAsleep] = useState(false);

  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    setHidden(document.hidden);
    const onMq = () => setReduce(mq.matches);
    const onVis = () => setHidden(document.hidden);
    mq.addEventListener("change", onMq);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      mq.removeEventListener("change", onMq);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    setAsleep(false);
    if (status !== "idle" || !sleepAfter) return;
    const timer = setTimeout(() => setAsleep(true), sleepAfter);
    return () => clearTimeout(timer);
  }, [status, sleepAfter]);

  const shown: PetStatus = status === "idle" && asleep ? "sleep" : status;
  const variant = size <= 48 ? "tiny" : size <= 96 || motion === "hemat" ? "mini" : "full";
  const still = motion === "diam" || reduce;
  const box = crop === "head" ? "118 48 122 104" : "0 0 240 200";
  const height = Math.round(size * (crop === "head" ? 104 / 122 : 200 / 240));

  const frameSvg = FRAMES[shown] ?? FRAMES.idle;
  const markup = frameSvg
    .replaceAll("__ID__", uid)
    .replace('viewBox="0 0 240 200"', `viewBox="${box}"`);

  const isPaused = hidden || paused || still;

  useEffect(() => {
    const svg = hostRef.current?.querySelector("svg") as (SVGSVGElement & { pauseAnimations?: () => void; unpauseAnimations?: () => void }) | null;
    if (!svg || typeof svg.pauseAnimations !== "function") return;
    if (isPaused) {
      svg.pauseAnimations();
    } else {
      svg.unpauseAnimations();
    }
  }, [isPaused, markup]);

  const lv = level === null ? null : Math.max(0, Math.min(1, level));
  const glow = [0, 0.5, 1][mood] ?? 0;

  const style: CSSProperties & Record<string, string | number> = {
    width: `${size}px`,
    height: `${height}px`,
    "--ak-glow": glow,
    "--ak-mo": lv === null ? 0 : lv > 0.5 ? 1 : 0,
    "--ak-mm": lv === null ? 0 : lv > 0.15 && lv <= 0.5 ? 1 : 0,
    "--ak-mc": lv === null ? 1 : lv <= 0.15 ? 1 : 0,
  };

  const isLipsync = lv !== null && shown === "speaking";
  const classList = [
    "ako",
    variant,
    crop === "head" ? "head" : "",
    !shadow ? "noshade" : "",
    isPaused ? "paused" : "",
    isLipsync ? "lipsync" : "",
    className,
  ].filter(Boolean).join(" ");

  const handlePoke = () => {
    setAsleep(false);
    onPoke?.();
  };

  const ariaText = `${label}: ${PET_LABELS[shown]}`;

  return (
    <>
      <style>{PET_STYLES}</style>
      {onPoke ? (
        <button
          ref={hostRef as React.RefObject<HTMLButtonElement>}
          type="button"
          className={classList}
          style={style}
          aria-label={ariaText}
          onClick={handlePoke}
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      ) : (
        <span
          ref={hostRef as React.RefObject<HTMLSpanElement>}
          className={classList}
          style={style}
          role="img"
          aria-label={ariaText}
          dangerouslySetInnerHTML={{ __html: markup }}
        />
      )}
    </>
  );
}
