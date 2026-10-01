import { useEffect, useState } from "react";

/** False while the window is hidden, so animations can pause (DESIGN.md §6.5). */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document !== "undefined" && document.visibilityState
      ? document.visibilityState === "visible"
      : true,
  );
  useEffect(() => {
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") {
      return;
    }
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
}
