import { useEffect, useRef, useState } from "react";
import { detect } from "./view";

export function isValidDownloadUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const kind = detect(trimmed);
  return kind === "media" || kind === "file" || kind === "torrent";
}

export function useClipboardCatch(enabled = true) {
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const lastDismissed = useRef<string | null>(null);

  async function checkClipboard() {
    if (!enabled || typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      const trimmed = text.trim();
      if (
        isValidDownloadUrl(trimmed) &&
        trimmed !== lastDismissed.current &&
        trimmed !== detectedUrl
      ) {
        setDetectedUrl(trimmed);
      }
    } catch {
      // Ignore clipboard permission or empty errors
    }
  }

  function dismiss() {
    if (detectedUrl) {
      lastDismissed.current = detectedUrl;
      setDetectedUrl(null);
    }
  }

  function clear() {
    setDetectedUrl(null);
  }

  useEffect(() => {
    if (!enabled) return;

    void checkClipboard();

    const handleFocus = () => void checkClipboard();
    window.addEventListener("focus", handleFocus);
    const interval = setInterval(() => void checkClipboard(), 3000);

    return () => {
      window.removeEventListener("focus", handleFocus);
      clearInterval(interval);
    };
  }, [enabled]);

  return { detectedUrl, dismiss, clear, checkClipboard };
}
