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
import { useFilesKeyboard } from "./useFilesKeyboard";
import { useHistory } from "./useHistory";
import { reportToasts, select, totalSize } from "./view";

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

function TrashConfirmDialog({
  count,
  onConfirm,
  onCancel,
}: Readonly<{
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  return (
    <Dialog
      title={`Pindahkan ${count} item ke Tong Sampah?`}
      onClose={onCancel}
    >
      <p className="m-0 text-sm text-muted">
        Item akan dipindahkan ke folder Tong Sampah dan dapat dipulihkan
        nanti jika diperlukan.
      </p>
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className={SECONDARY}
        >
          Batal
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="min-h-10 rounded-full border border-danger px-4 text-[13px] font-semibold text-danger transition-colors hover:bg-danger-row"
        >
          Hapus
        </button>
      </div>
    </Dialog>
  );
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
  const [listing, setListing] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [showHidden, setShowHidden] = useState(getInitialShowHidden);
  const [reloadToken, setReloadToken] = useState(0);

  const [confirmTrash, setConfirmTrash] = useState(false);
  const [conflictCount, setConflictCount] = useState<number | null>(null);

  const history = useHistory();
  const currentPath = history.current;
  const canGoUp = Boolean(listing?.parent);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  const selectedEntries = selected
    .map((i) => listing?.entries[i])
    .filter((e): e is FileEntry => Boolean(e));

  const singleEntry = selectedEntries.length === 1 ? selectedEntries[0] : null;

  // Clear selection and anchor when path changes
  useEffect(() => {
    setSelected([]);
    setAnchor(null);
  }, [currentPath]);

  // Load places once on mount and initialize Home directory via functional update
  useEffect(() => {
    let active = true;
    api.filePlaces().then(
      (res) => {
        if (!active) return;
        setPlaces(res.places);
        setDevices(res.devices);
        const home =
          res.places.find((p) => p.icon === "home")?.path ?? res.places[0]?.path;
        if (home) {
          history.go((prev) => prev || home);
        }
      },
      (e) => {
        if (active) toast(errorMessage(e), "error");
      },
    );
    return () => {
      active = false;
    };
  }, [history.go, toast]);

  // Load listing when currentPath, showHidden or reloadToken changes
  useEffect(() => {
    if (!currentPath) return;
    let active = true;
    api.listDir(currentPath, showHidden).then(
      (res) => {
        if (active) setListing(res);
      },
      (e) => {
        if (active) toast(errorMessage(e), "error");
      },
    );
    return () => {
      active = false;
    };
  }, [currentPath, showHidden, reloadToken, toast]);

  const handleOpen = useCallback(
    (entry: FileEntry) => {
      if (entry.kind === "folder") {
        history.go(entry.path);
      } else {
        api.openFile(entry.path).catch((err) => toast(errorMessage(err), "error"));
      }
    },
    [history.go, toast],
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
    const paths = selectedEntries.map((e) => e.path);
    if (paths.length === 0) return;
    onSetClipboard({ mode: "copy", paths });
    toast(`${paths.length} item disalin ke papan klip`);
  }, [selectedEntries, onSetClipboard, toast]);

  const handleMove = useCallback(() => {
    const paths = selectedEntries.map((e) => e.path);
    if (paths.length === 0) return;
    onSetClipboard({ mode: "move", paths });
    toast(`${paths.length} item ditandai untuk dipindahkan`);
  }, [selectedEntries, onSetClipboard, toast]);

  const paste = useCallback(
    async (onConflict?: OnConflict) => {
      if (onConflict !== undefined) {
        setConflictCount(null);
      }
      if (!clipboard || !currentPath) return;
      try {
        const report = await api.pasteItems({
          sources: [...clipboard.paths],
          dest: currentPath,
          mode: clipboard.mode,
          onConflict,
        });
        if (!onConflict && report.conflicts.length > 0) {
          setConflictCount(report.conflicts.length);
          return;
        }
        const verb = clipboard.mode === "copy" ? "disalin" : "dipindahkan";
        const { ok, error } = reportToasts(report, verb);
        if (ok) toast(ok);
        if (error) toast(error, "error");
        if (clipboard.mode === "move") {
          onSetClipboard(null);
        }
        reload();
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [clipboard, currentPath, onSetClipboard, reload, toast],
  );

  const handleTrashConfirm = useCallback(async () => {
    setConfirmTrash(false);
    const paths = selectedEntries.map((e) => e.path);
    if (paths.length === 0) return;
    try {
      const report = await api.trashItems(paths);
      const { ok, error } = reportToasts(report, "dipindahkan ke Tong Sampah");
      if (ok) toast(ok);
      if (error) toast(error, "error");
      setSelected([]);
      setAnchor(null);
      reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }, [selectedEntries, reload, toast]);

  useFilesKeyboard({
    isDialogOpen: confirmTrash || conflictCount !== null,
    parentPath: listing?.parent,
    selectedEntry: singleEntry,
    onGoParent: history.go,
    onOpenEntry: handleOpen,
  });

  return (
    <div className="flex h-full flex-col gap-3.5">
      <div className="flex items-center gap-3">
        <h1 className={H1}>Berkas</h1>
      </div>

      <FilesToolbar
        canGoBack={history.canBack}
        canGoForward={history.canForward}
        canGoUp={canGoUp}
        onGoBack={history.back}
        onGoForward={history.forward}
        onGoUp={() => listing?.parent && history.go(listing.parent)}
        crumbs={listing?.crumbs ?? []}
        onNavigate={history.go}
        view={view}
        onToggleView={setView}
        showHidden={showHidden}
        onToggleHidden={handleToggleHidden}
        clipboardCount={clipboard?.paths.length ?? 0}
        onPaste={() => void paste()}
        onClearClipboard={() => onSetClipboard(null)}
      />

      <div className="flex min-h-0 flex-1 gap-3.5">
        <PlacesSidebar
          places={places}
          devices={devices}
          currentPath={currentPath}
          onSelectPlace={(path) => {
            if (path === currentPath) {
              reload();
            } else {
              history.go(path);
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

          {selectedEntries.length > 0 && (
            <ActionBar
              selectedCount={selectedEntries.length}
              totalSizeBytes={totalSize(selectedEntries)}
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
          onResolve={paste}
          onCancel={() => setConflictCount(null)}
        />
      )}

      {confirmTrash && (
        <TrashConfirmDialog
          count={selectedEntries.length}
          onConfirm={handleTrashConfirm}
          onCancel={() => setConfirmTrash(false)}
        />
      )}
    </div>
  );
}
