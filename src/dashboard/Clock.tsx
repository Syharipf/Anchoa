import { useEffect, useState } from "react";
import { clockLabel } from "../format";

/** "Rab 30 Sep · 00:48", refreshed every 15 seconds. */
export function Clock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return <span className="shrink-0 font-mono text-[13px] text-muted">{clockLabel(now)}</span>;
}
