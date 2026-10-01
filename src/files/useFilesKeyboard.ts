import { useEffect } from "react";
import type { FileEntry } from "../api";

export function shouldIgnoreKeydown(
  target: EventTarget | null,
  isDialogOpen: boolean,
): boolean {
  if (isDialogOpen) {
    return true;
  }
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") {
    return false;
  }
  if (el.closest('input, textarea, select, [role="dialog"]')) {
    return true;
  }
  const button = el.closest("button");
  return Boolean(button && !button.hasAttribute("data-file-entry"));
}

export function useFilesKeyboard({
  isDialogOpen,
  parentPath,
  selectedEntry,
  onGoParent,
  onOpenEntry,
}: Readonly<{
  isDialogOpen: boolean;
  parentPath?: string | null;
  selectedEntry: FileEntry | null;
  onGoParent: (path: string) => void;
  onOpenEntry: (entry: FileEntry) => void;
}>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreKeydown(e.target, isDialogOpen)) {
        return;
      }
      if (e.key === "Backspace" && parentPath) {
        e.preventDefault();
        onGoParent(parentPath);
      } else if (e.key === "Enter" && selectedEntry) {
        e.preventDefault();
        onOpenEntry(selectedEntry);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDialogOpen, parentPath, selectedEntry, onGoParent, onOpenEntry]);
}
