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
  onTogglePreview,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onSelectAll,
  onNewTab,
  onCloseTab,
}: Readonly<{
  isDialogOpen: boolean;
  parentPath?: string | null;
  selectedEntry: FileEntry | null;
  onGoParent: (path: string) => void;
  onOpenEntry: (entry: FileEntry) => void;
  onTogglePreview?: () => void;
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  onDelete?: () => void;
  onSelectAll?: () => void;
  onNewTab?: () => void;
  onCloseTab?: () => void;
}>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreKeydown(e.target, isDialogOpen)) {
        return;
      }
      const isMod = e.ctrlKey || e.metaKey;

      if (isMod && e.key.toLowerCase() === "t" && onNewTab) {
        e.preventDefault();
        onNewTab();
      } else if (isMod && e.key.toLowerCase() === "w" && onCloseTab) {
        e.preventDefault();
        onCloseTab();
      } else if (isMod && e.key.toLowerCase() === "c" && onCopy) {
        e.preventDefault();
        onCopy();
      } else if (isMod && e.key.toLowerCase() === "x" && onCut) {
        e.preventDefault();
        onCut();
      } else if (isMod && e.key.toLowerCase() === "v" && onPaste) {
        e.preventDefault();
        onPaste();
      } else if (isMod && e.key.toLowerCase() === "a" && onSelectAll) {
        e.preventDefault();
        onSelectAll();
      } else if (e.key === " " && onTogglePreview && selectedEntry) {
        e.preventDefault();
        onTogglePreview();
      } else if ((e.key === "Delete" || (isMod && e.key === "Backspace")) && onDelete && selectedEntry) {
        e.preventDefault();
        onDelete();
      } else if (e.key === "Backspace" && parentPath) {
        e.preventDefault();
        onGoParent(parentPath);
      } else if (e.key === "Enter" && selectedEntry) {
        e.preventDefault();
        onOpenEntry(selectedEntry);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    isDialogOpen,
    parentPath,
    selectedEntry,
    onGoParent,
    onOpenEntry,
    onTogglePreview,
    onCopy,
    onCut,
    onPaste,
    onDelete,
    onSelectAll,
    onNewTab,
    onCloseTab,
  ]);
}
