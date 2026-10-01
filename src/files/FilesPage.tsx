import {
  useCallback,
  useEffect,
  useState,
  type MouseEvent,
} from "react";
import {
  api,
  errorMessage,
  type FileEntry,
  type Listing,
  type OnConflict,
  type Place,
} from "../api";
import { Dialog } from "../shell/Dialog";
import { useToast } from "../shell/toast";
import { H1, SECONDARY } from "../shell/ui";
import { ActionBar } from "./ActionBar";
import { ConflictDialog } from "./ConflictDialog";
import { FileGrid } from "./FileGrid";
import { FileList } from "./FileList";
import { FilesToolbar } from "./FilesToolbar";
import { PlacesSidebar } from "./PlacesSidebar";
import { PreviewPanel } from "./PreviewPanel";
import { select, totalSize } from "./view";

export interface FileClipboard {
  readonly mode: "copy" | "move";
  readonly paths: readonly string[];
}

function getInitialShowHidden(): boolean {
  try {
    return localStorage.getItem("anchoa:files:hidden") === "true";
  } catch {
    return false;
  }
}

function setShowHiddenStored(val: boolean) {
  try {
    localStorage.setItem("anchoa:files:hidden", String(val));
  } catch {
    // Ignore storage failure
  }
}

export function FilesPage({
  clipboard,
  onSetClipboard,
}: Readonly<{
  clipboard: FileClipboard | null;
  onSetClipboard: (clip: FileClipboard | null) => void;
}>) {
  const toast = useToast();
  const [places, setPlaces] = useState<Place[]>([]);
  const [devices, setDevices] = useState<Place[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [listing, setListing] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [showHidden, setShowHidden] = useState(getInitialShowHidden);

  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const [confirmTrash, setConfirmTrash] = useState(false);
  const [conflictCount, setConflictCount] = useState<number | null>(null);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;
  const canGoUp = listing?.parent !== null && listing?.parent !== undefined;

  const loadDir = useCallback(
    async (path: string, hidden: boolean) => {
      try {
        const res = await api.listDir(path, hidden);
        setListing(res);
        setSelected([]);
        setAnchor(null);
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [toast],
  );

  // Load places and initialize Home directory
  useEffect(() => {
    let active = true;
    api.filePlaces().then(
      (res) => {
        if (!active) return;
        setPlaces(res.places);
        setDevices(res.devices);
        const home =
          res.places.find((p) => p.icon === "home")?.path ?? res.places[0]?.path;
        if (home && !currentPath) {
          setCurrentPath(home);
          setHistory([home]);
          setHistoryIndex(0);
        }
      },
      (e) => {
        if (active) toast(errorMessage(e), "error");
      },
    );
    return () => {
      active = false;
    };
  }, [currentPath, toast]);

  // Load listing when currentPath or showHidden changes
  useEffect(() => {
    if (currentPath) {
      void loadDir(currentPath, showHidden);
    }
  }, [currentPath, showHidden, loadDir]);

  const navigateTo = useCallback(
    (newPath: string) => {
      setHistory((prev) => {
        const next = prev.slice(0, historyIndex + 1);
        next.push(newPath);
        return next;
      });
      setHistoryIndex((prev) => prev + 1);
      setCurrentPath(newPath);
    },
    [historyIndex],
  );

  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      setHistoryIndex(prevIndex);
      setCurrentPath(history[prevIndex]);
    }
  }, [historyIndex, history]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      setHistoryIndex(nextIndex);
      setCurrentPath(history[nextIndex]);
    }
  }, [historyIndex, history]);

  const goUp = useCallback(() => {
    if (listing?.parent) {
      navigateTo(listing.parent);
    }
  }, [listing?.parent, navigateTo]);

  const handleOpen = useCallback(
    (entry: FileEntry) => {
      if (entry.kind === "folder") {
        navigateTo(entry.path);
      } else {
        api.openFile(entry.path).catch((err) => toast(errorMessage(err), "error"));
      }
    },
    [navigateTo, toast],
  );

  const handleSelect = useCallback(
    (index: number, e: MouseEvent) => {
      const next = select(
        { selected, anchor },
        index,
        { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey },
      );
      setSelected(next.selected);
      setAnchor(next.anchor);
    },
    [selected, anchor],
  );

  const handleToggleHidden = useCallback((val: boolean) => {
    setShowHidden(val);
    setShowHiddenStored(val);
  }, []);

  const handleCopy = useCallback(() => {
    if (!listing) return;
    const paths = selected.map((i) => listing.entries[i].path);
    onSetClipboard({ mode: "copy", paths });
    toast(`${paths.length} item disalin ke papan klip`);
  }, [listing, selected, onSetClipboard, toast]);

  const handleMove = useCallback(() => {
    if (!listing) return;
    const paths = selected.map((i) => listing.entries[i].path);
    onSetClipboard({ mode: "move", paths });
    toast(`${paths.length} item ditandai untuk dipindahkan`);
  }, [listing, selected, onSetClipboard, toast]);

  const handlePaste = useCallback(async () => {
    if (!clipboard || !currentPath) return;
    try {
      const report = await api.pasteItems({
        sources: [...clipboard.paths],
        dest: currentPath,
        mode: clipboard.mode,
      });
      if (report.conflicts.length > 0) {
        setConflictCount(report.conflicts.length);
        return;
      }
      if (report.done.length > 0) {
        toast(
          `${report.done.length} item ${
            clipboard.mode === "copy" ? "disalin" : "dipindahkan"
          }`,
        );
      }
      if (report.failed.length > 0) {
        const errs = report.failed
          .map((f) => `${f.path}: ${f.error}`)
          .join(", ");
        toast(`Gagal: ${errs}`, "error");
      }
      if (clipboard.mode === "move") {
        onSetClipboard(null);
      }
      void loadDir(currentPath, showHidden);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [clipboard, currentPath, onSetClipboard, loadDir, showHidden, toast]);

  const handleResolveConflict = useCallback(
    async (choice: OnConflict) => {
      setConflictCount(null);
      if (!clipboard || !currentPath) return;
      try {
        const report = await api.pasteItems({
          sources: [...clipboard.paths],
          dest: currentPath,
          mode: clipboard.mode,
          onConflict: choice,
        });
        if (report.done.length > 0) {
          toast(
            `${report.done.length} item ${
              clipboard.mode === "copy" ? "disalin" : "dipindahkan"
            }`,
          );
        }
        if (report.failed.length > 0) {
          const errs = report.failed
            .map((f) => `${f.path}: ${f.error}`)
            .join(", ");
          toast(`Gagal: ${errs}`, "error");
        }
        if (clipboard.mode === "move") {
          onSetClipboard(null);
        }
        void loadDir(currentPath, showHidden);
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [clipboard, currentPath, onSetClipboard, loadDir, showHidden, toast],
  );

  const handleTrashConfirm = useCallback(async () => {
    setConfirmTrash(false);
    if (!listing) return;
    const paths = selected.map((i) => listing.entries[i].path);
    try {
      const report = await api.trashItems(paths);
      if (report.done.length > 0) {
        toast(`${report.done.length} item dipindahkan ke Tong Sampah`);
      }
      if (report.failed.length > 0) {
        const errs = report.failed
          .map((f) => `${f.path}: ${f.error}`)
          .join(", ");
        toast(`Gagal menghapus: ${errs}`, "error");
      }
      setSelected([]);
      setAnchor(null);
      void loadDir(currentPath, showHidden);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [listing, selected, currentPath, showHidden, loadDir, toast]);

  // Backspace goes up, Enter opens selected entry
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea") {
        return;
      }
      if (e.key === "Backspace" && listing?.parent) {
        e.preventDefault();
        navigateTo(listing.parent);
      } else if (e.key === "Enter" && selected.length === 1 && listing) {
        const entry = listing.entries[selected[0]];
        if (entry) {
          e.preventDefault();
          handleOpen(entry);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [listing, selected, navigateTo, handleOpen]);

  const singleEntry =
    selected.length === 1 && listing ? listing.entries[selected[0]] : null;

  return (
    <div className="flex h-full flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <h1 className={H1}>Berkas</h1>
      </div>

      <FilesToolbar
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        canGoUp={canGoUp}
        onGoBack={goBack}
        onGoForward={goForward}
        onGoUp={goUp}
        crumbs={listing?.crumbs ?? []}
        onNavigate={navigateTo}
        view={view}
        onToggleView={setView}
        showHidden={showHidden}
        onToggleHidden={handleToggleHidden}
        clipboardCount={clipboard?.paths.length ?? 0}
        onPaste={handlePaste}
        onClearClipboard={() => onSetClipboard(null)}
      />

      <div className="flex min-h-0 flex-1 gap-3.5">
        <PlacesSidebar
          places={places}
          devices={devices}
          currentPath={currentPath}
          onSelectPlace={(path) => {
            if (path === currentPath) {
              void loadDir(path, showHidden);
            } else {
              navigateTo(path);
            }
          }}
        />

        <section
          aria-label={`Isi folder ${listing?.path ?? ""}`}
          className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-stage"
        >
          {view === "grid" ? (
            <FileGrid
              entries={listing?.entries ?? []}
              selected={selected}
              onSelect={handleSelect}
              onOpen={handleOpen}
            />
          ) : (
            <FileList
              entries={listing?.entries ?? []}
              selected={selected}
              onSelect={handleSelect}
              onOpen={handleOpen}
            />
          )}

          {selected.length > 0 && listing && (
            <ActionBar
              selectedCount={selected.length}
              totalSizeBytes={totalSize(listing.entries, selected)}
              onCopy={handleCopy}
              onMove={handleMove}
              onTrash={() => setConfirmTrash(true)}
              onClear={() => {
                setSelected([]);
                setAnchor(null);
              }}
            />
          )}
        </section>

        {singleEntry && (
          <PreviewPanel
            entry={singleEntry}
            onClose={() => {
              setSelected([]);
              setAnchor(null);
            }}
            onOpen={handleOpen}
          />
        )}
      </div>

      {conflictCount !== null && (
        <ConflictDialog
          conflictCount={conflictCount}
          onResolve={handleResolveConflict}
          onCancel={() => setConflictCount(null)}
        />
      )}

      {confirmTrash && (
        <Dialog
          title={`Pindahkan ${selected.length} item ke Tong Sampah?`}
          onClose={() => setConfirmTrash(false)}
        >
          <p className="m-0 text-sm text-muted">
            Item akan dipindahkan ke folder Tong Sampah dan dapat dipulihkan
            nanti jika diperlukan.
          </p>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmTrash(false)}
              className={SECONDARY}
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleTrashConfirm}
              className="min-h-10 rounded-full border border-danger px-4 text-[13px] font-semibold text-danger transition-colors hover:bg-danger-row"
            >
              Hapus
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
