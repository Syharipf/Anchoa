import { useEffect, useId, useState } from "react";
import { LAUT_INNER_SVG, LAUT_STYLE } from "./lautTemplate";

export interface LautAkoProps {
  readonly paused?: boolean;
  readonly className?: string;
}

export function LautAko({ paused = false, className = "" }: Readonly<LautAkoProps>) {
  const rawId = useId();
  const uid = `laut_${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    onVis();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const isPaused = paused || hidden;
  const markup = LAUT_INNER_SVG.replaceAll("{uid}", uid);

  return (
    <svg
      className={`laut ${isPaused ? "paused" : ""} ${className}`}
      viewBox="0 0 400 400"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
    >
      <style>{LAUT_STYLE}</style>
      <g dangerouslySetInnerHTML={{ __html: markup }} />
    </svg>
  );
}
