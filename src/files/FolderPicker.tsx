import { useEffect, useState } from "react";
import { api, errorMessage, type FileEntry } from "../api";
import { Dialog } from "../shell/Dialog";
import { isRemotePath } from "./remotes";
import { parentPath } from "./view";

export function FolderPickerBody({
  path,
  folders,
  busy,
  error,
  title = "Select Folder",
  onUp,
  onEnter,
  onChoose,
  onCancel,
}: Readonly<{
  path: string;
  folders: readonly FileEntry[];
  busy?: boolean;
  error?: string | null;
  title?: string;
  onUp: () => void;
  onEnter: (folderPath: string) => void;
  onChoose: () => void;
  onCancel: () => void;
}>) {
  const isRoot = !path || parentPath(path) === path;

  return (
    <Dialog title={title} onClose={onCancel}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span
            title={path}
            className="min-w-0 flex-1 truncate rounded-lg border border-line bg-canvas px-3 py-1.5 font-mono text-xs text-ink"
          >
            {path || "—"}
          </span>
          <button
            type="button"
            onClick={onUp}
            disabled={busy || isRoot}
            className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Up
          </button>
        </div>

        {error && (
          <div role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        <div className="flex max-h-60 min-h-[140px] flex-col overflow-y-auto rounded-lg border border-line bg-canvas p-1">
          {busy && folders.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-4 text-xs text-muted">
              Loading…
            </div>
          ) : folders.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-4 text-xs text-muted">
              No subfolders
            </div>
          ) : (
            folders.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => onEnter(entry.path)}
                className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-muted"
                  aria-hidden="true"
                >
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
                <span className="truncate">{entry.name}</span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-xs text-ink transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onChoose}
            disabled={!path || busy}
            className="flex h-8 items-center rounded-lg bg-accent px-3.5 text-xs font-semibold text-canvas transition-colors hover:brightness-105 disabled:bg-disabled disabled:text-muted"
          >
            Select this folder
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function FolderPicker({
  initialPath,
  title,
  onSelect,
  onClose,
}: Readonly<{
  initialPath?: string;
  title?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}>) {
  const [currentPath, setCurrentPath] = useState(initialPath || "");
  const [folders, setFolders] = useState<readonly FileEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      let start = initialPath?.trim();
      if (!start) {
        try {
          const places = await api.filePlaces();
          const home = places.places.find((p) => p.icon === "home") || places.places[0];
          start = home?.path || "/";
        } catch (e) {
          if (cancelled) return;
          setError(errorMessage(e));
          return;
        }
      }
      if (!cancelled) {
        setCurrentPath(start);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [initialPath]);

  useEffect(() => {
    if (!currentPath) return;
    let cancelled = false;
    setBusy(true);
    setError(null);

    api
      .listDir(currentPath, false)
      .then((listing) => {
        if (cancelled) return;
        const subfolders = listing.entries
          .filter((entry) => entry.kind === "folder" && !isRemotePath(entry.path))
          .sort((a, b) => a.name.localeCompare(b.name));
        setFolders(subfolders);
        setBusy(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(errorMessage(e));
        setFolders([]);
        setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentPath]);

  function handleUp() {
    if (!currentPath) return;
    const parent = parentPath(currentPath);
    if (parent !== currentPath) {
      setCurrentPath(parent);
    }
  }

  function handleEnter(next: string) {
    setCurrentPath(next);
  }

  function handleChoose() {
    if (currentPath) {
      onSelect(currentPath);
      onClose();
    }
  }

  return (
    <FolderPickerBody
      path={currentPath}
      folders={folders}
      busy={busy}
      error={error}
      title={title}
      onUp={handleUp}
      onEnter={handleEnter}
      onChoose={handleChoose}
      onCancel={onClose}
    />
  );
}
