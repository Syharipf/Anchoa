import { useEffect, useRef, useState } from "react";
import { detect } from "./view";

export function isValidDownloadUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const kind = detect(trimmed);
  return kind === "media" || kind === "file" || kind === "torrent";
}
const CLIPBOARD_WATCH_KEY = "anchoa.downloads.watch_clipboard";

export function isClipboardWatchEnabled(): boolean {
  try {
    const val = localStorage.getItem(CLIPBOARD_WATCH_KEY);
    return val === null ? true : val === "true";
  } catch {
    return true;
  }
}

export function setClipboardWatchEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(CLIPBOARD_WATCH_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore storage errors
  }
}

export function useClipboardCatch(explicitEnabled?: boolean) {
  const [watchEnabled] = useState(() =>
    explicitEnabled !== undefined ? explicitEnabled : isClipboardWatchEnabled()
  );
  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const lastDismissed = useRef<string | null>(null);

  const enabled = explicitEnabled !== undefined ? explicitEnabled : watchEnabled;

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
