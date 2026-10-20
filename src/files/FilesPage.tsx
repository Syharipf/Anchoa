import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import {
  api,
  errorMessage,
  type ConvertCapabilities,
  type FileEntry,
  type FolderMeta,
  type Listing,
  type OnConflict,
  type Place,
} from "../api";
import { Dialog } from "../shell/Dialog";
import type { OpenAssistant } from "../assistant/useAssistantRequest";
import { useToast } from "../shell/toast";
import { H1, SECONDARY } from "../shell/ui";
import { ActionBar } from "./ActionBar";
import { ConflictDialog } from "./ConflictDialog";
import { ConvertDialog } from "./ConvertDialog";
import { FileGrid } from "./FileGrid";
import { FileList } from "./FileList";
import { FileTabsBar } from "./FileTabsBar";
import { FilesToolbar } from "./FilesToolbar";
import { FolderTools } from "./FolderTools";
import { PlacesSidebar } from "./PlacesSidebar";
import { FolderPicker } from "./FolderPicker";
import { isArchive, PreviewPanel } from "./PreviewPanel";
import { isRemotePath, isWithin, listFolder, useRemotes } from "./remotes";
import { useFileTabs } from "./useFileTabs";
import { useFilesKeyboard } from "./useFilesKeyboard";
import { useMountWatch } from "./useMountWatch";
import { archiveStem, baseName, joinPath, parentPath, reportToasts, select, targetsFor, totalSize } from "./view";

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

function NewFolderDialog({
  onConfirm,
  onCancel,
}: Readonly<{
  onConfirm: (name: string) => void;
  onCancel: () => void;
}>) {
  const [name, setName] = useState("");
  return (
    <Dialog title="Buat Folder Baru" onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onConfirm(name.trim());
        }}
        className="flex flex-col gap-3"
      >
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nama folder..."
          className="rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink placeholder:text-muted focus:border-field-focus focus:outline-none"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-xs text-ink transition-colors hover:bg-surface-2"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="flex h-8 items-center rounded-lg bg-accent px-3.5 text-xs font-semibold text-canvas transition-colors hover:brightness-105 disabled:bg-disabled disabled:text-muted"
          >
            Buat Folder
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RenameDialog({
  initialName,
  onConfirm,
  onCancel,
}: Readonly<{
  initialName: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}>) {
  const [name, setName] = useState(initialName);
  return (
    <Dialog title="Ganti Nama" onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && name.trim() !== initialName) {
            onConfirm(name.trim());
          } else {
            onCancel();
          }
        }}
        className="flex flex-col gap-3"
      >
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nama baru..."
          className="rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink placeholder:text-muted focus:border-field-focus focus:outline-none"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-xs text-ink transition-colors hover:bg-surface-2"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={!name.trim() || name.trim() === initialName}
            className="flex h-8 items-center rounded-lg bg-accent px-3.5 text-xs font-semibold text-canvas transition-colors hover:brightness-105 disabled:bg-disabled disabled:text-muted"
          >
            Simpan
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function PathPickerRow({
  value,
  onChange,
  ariaLabel,
  disabled,
  initialPath,
}: Readonly<{
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  initialPath?: string;
}>) {
  const [picking, setPicking] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="w-full min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs text-ink placeholder:text-muted focus:border-field-focus focus:outline-none"
      />
      <button
        type="button"
        onClick={() => setPicking(true)}
        disabled={disabled}
        className="shrink-0 whitespace-nowrap rounded-lg border border-line px-2.5 py-2 text-xs text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        Pilih…
      </button>
      {picking && (
        <FolderPicker
          initialPath={value || initialPath}
          onSelect={onChange}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
function ExtractDialog({
  entry,
  onConfirm,
  onCancel,
}: Readonly<{
  entry: FileEntry;
  onConfirm: (dest: string) => void;
  onCancel: () => void;
}>) {
  const [dest, setDest] = useState(() =>
    joinPath(parentPath(entry.path), archiveStem(entry.name) || "ekstrak"),
  );
  return (
    <Dialog title="Ekstrak ke Folder" onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dest.trim()) onConfirm(dest.trim());
        }}
        className="flex flex-col gap-3"
      >
        <span className="truncate text-xs text-muted">Arsip: {entry.name}</span>
        <PathPickerRow
          value={dest}
          onChange={setDest}
          ariaLabel="Folder tujuan ekstrak"
          initialPath={parentPath(entry.path)}
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-xs text-ink transition-colors hover:bg-surface-2"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={!dest.trim()}
            className="flex h-8 items-center rounded-lg bg-accent px-3.5 text-xs font-semibold text-canvas transition-colors hover:brightness-105 disabled:bg-disabled disabled:text-muted"
          >
            Ekstrak
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function CompressDialog({
  entry,
  onConfirm,
  onCancel,
}: Readonly<{
  entry: FileEntry;
  onConfirm: (destPath: string) => void;
  onCancel: () => void;
}>) {
  const [name, setName] = useState(() => archiveStem(entry.name) || "Arsip");
  const [format, setFormat] = useState<".zip" | ".tar.gz">(".zip");
  const dir = parentPath(entry.path);
  const trimmedName = name.trim();
  // A separator or a bare dot would escape the folder or fail the backend guard.
  const invalidName =
    !trimmedName ||
    /[\\/]/.test(trimmedName) ||
    trimmedName === "." ||
    trimmedName === "..";
  const target = joinPath(dir, `${trimmedName}${format}`);
  return (
    <Dialog title="Kompres" onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalidName) onConfirm(target);
        }}
        className="flex flex-col gap-3"
      >
        <span className="truncate text-xs text-muted">Sumber: {entry.name}</span>
        <div className="flex items-center gap-2">
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Nama arsip"
            className="w-full min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-xs text-ink focus:border-field-focus focus:outline-none"
          />
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as ".zip" | ".tar.gz")}
            aria-label="Format arsip"
            className="shrink-0 rounded-lg border border-line bg-canvas px-2 py-2 text-xs text-ink focus:border-field-focus focus:outline-none"
          >
            <option value=".zip">.zip</option>
            <option value=".tar.gz">.tar.gz</option>
          </select>
        </div>
        <span className="truncate font-mono text-[11px] text-muted">{target}</span>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-xs text-ink transition-colors hover:bg-surface-2"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={invalidName}
            className="flex h-8 items-center rounded-lg bg-accent px-3.5 text-xs font-semibold text-canvas transition-colors hover:brightness-105 disabled:bg-disabled disabled:text-muted"
          >
            Kompres
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function MoveDialog({
  entry,
  initialPath,
  onConfirm,
  onCancel,
}: Readonly<{
  entry: FileEntry;
  initialPath?: string;
  onConfirm: (dest: string) => void;
  onCancel: () => void;
}>) {
  const [dest, setDest] = useState("");
  return (
    <Dialog title="Pindahkan ke Folder" onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (dest.trim()) onConfirm(dest.trim());
        }}
        className="flex flex-col gap-3"
      >
        <span className="truncate text-xs text-muted">Item: {entry.name}</span>
        <PathPickerRow
          value={dest}
          onChange={setDest}
          ariaLabel="Folder tujuan pindah"
          initialPath={initialPath}
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-xs text-ink transition-colors hover:bg-surface-2"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={!dest.trim()}
            className="flex h-8 items-center rounded-lg bg-accent px-3.5 text-xs font-semibold text-canvas transition-colors hover:brightness-105 disabled:bg-disabled disabled:text-muted"
          >
            Pindahkan
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function FileContextMenu({
  x,
  y,
  entry,
  isBookmarked,
  clipboard,
  onOpen,
  onOpenTab,
  onOpenTerminal,
  onAskAssistant,
  onCopy,
  onCopyPath,
  onToggleBookmark,
  onCut,
  onPaste,
  onRename,
  onTrash,
  onExtract,
  onExtractTo,
  onCompress,
  onCompressAs,
  onConvert,
  convertible,
  onDuplicate,
  onMoveTo,
  onMakeProject,
  onNewFolder,
  onClose,
}: Readonly<{
  x: number;
  y: number;
  entry: FileEntry | null;
  isBookmarked?: boolean;
  clipboard: FileClipboard | null;
  onOpen: (entry: FileEntry) => void;
  onOpenTab?: (path: string) => void;
  onOpenTerminal?: (path: string) => void;
  onAskAssistant?: (path: string) => void;
  onCopy: (entry: FileEntry) => void;
  onCopyPath: (path: string) => void;
  onToggleBookmark?: (entry: FileEntry) => void;
  onCut: (entry: FileEntry) => void;
  onPaste: () => void;
  onRename: (entry: FileEntry) => void;
  onTrash: (entry: FileEntry) => void;
  onExtract: (entry: FileEntry) => void;
  onExtractTo?: (entry: FileEntry) => void;
  onCompress: (entry: FileEntry) => void;
  onCompressAs?: (entry: FileEntry) => void;
  onConvert?: (entry: FileEntry) => void;
  convertible?: boolean;
  onDuplicate?: (entry: FileEntry) => void;
  onMoveTo?: (entry: FileEntry) => void;
  onMakeProject?: (path: string) => void;
  onNewFolder: () => void;
  onClose: () => void;
}>) {
  const winW = typeof window !== "undefined" ? window.innerWidth : 1024;
  const winH = typeof window !== "undefined" ? window.innerHeight : 768;
  const menuH = entry ? 560 : 260;
  const menuX = Math.max(8, Math.min(x, winW - 200));
  const menuY = Math.max(8, Math.min(y, winH - menuH));
  // Local-only actions (archive, duplicate, move, project) cannot run on rclone paths.
  const remote = entry ? isRemotePath(entry.path) : false;

  function onMenuKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1].focus();
    }
  }

  return (
    <div
      role="menu"
      style={{ left: `${menuX}px`, top: `${menuY}px` }}
      className="fixed z-50 flex max-h-[calc(100vh-16px)] w-48 flex-col overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-2xl backdrop-blur-md"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onMenuKeyDown}
    >
      {entry ? (
        <>
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              onClose();
              onOpen(entry);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
          >
            Buka
          </button>
          {entry.kind === "folder" && onOpenTab && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onOpenTab(entry.path);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
            >
              Buka di Tab Baru
            </button>
          )}
          {entry.kind === "folder" && !remote && onOpenTerminal && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onOpenTerminal(entry.path);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
            >
              Buka di Terminal
            </button>
          )}
          {onAskAssistant && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onAskAssistant(entry.path);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-accent transition-colors hover:bg-surface-2"
            >
              Tanya Asisten AI
            </button>
          )}
          {entry.kind === "folder" && !remote && onMakeProject && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onMakeProject(entry.path);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
            >
              Jadikan Proyek
            </button>
          )}
          <div className="my-1 h-px bg-line" role="separator" />
          {isArchive(entry.name) && !remote && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onExtract(entry);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-accent transition-colors hover:bg-surface-2"
              >
                Ekstrak di sini
              </button>
              {onExtractTo && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onClose();
                    onExtractTo(entry);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
                >
                  Ekstrak ke folder…
                </button>
              )}
            </>
          )}
          {!remote && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onClose();
                  onCompress(entry);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
              >
                Kompres ke .zip
              </button>
              {onCompressAs && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onClose();
                    onCompressAs(entry);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
                >
                  Kompres sebagai…
                </button>
              )}
            </>
          )}
          {!remote && entry.kind !== "folder" && convertible && onConvert && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onConvert(entry);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
            >
              Konversi…
            </button>
          )}
          {entry.kind === "folder" && onToggleBookmark && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onToggleBookmark(entry);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
            >
              {isBookmarked ? "Hapus dari Markah" : "Tambah ke Markah"}
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onCopyPath(entry.path);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
          >
            Salin Path
          </button>
          <div className="my-1 h-px bg-line" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onCopy(entry);
            }}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
          >
            <span>Salin</span>
            <span className="font-mono text-[10px] text-muted">Ctrl+C</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onCut(entry);
            }}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
          >
            <span>Potong</span>
            <span className="font-mono text-[10px] text-muted">Ctrl+X</span>
          </button>
          {!remote && onDuplicate && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onDuplicate(entry);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
            >
              Duplikat
            </button>
          )}
          <div className="my-1 h-px bg-line" role="separator" />
          {!remote && onMoveTo && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onMoveTo(entry);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
            >
              Pindahkan ke…
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onRename(entry);
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
          >
            Ganti Nama
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onTrash(entry);
            }}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-danger transition-colors hover:bg-danger-row"
          >
            <span>Hapus</span>
            <span className="font-mono text-[10px] text-muted">Del</span>
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              onClose();
              onNewFolder();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
          >
            Folder Baru
          </button>
          {clipboard && clipboard.paths.length > 0 && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onPaste();
              }}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold text-accent transition-colors hover:bg-surface-2"
            >
              <span>Tempel {clipboard.paths.length} item</span>
              <span className="font-mono text-[10px] text-muted">Ctrl+V</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose();
              onCopyPath("");
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
          >
            Salin Path Folder
          </button>
          {onOpenTerminal && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onOpenTerminal("");
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
            >
              Buka di Terminal
            </button>
          )}
          {onAskAssistant && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onAskAssistant("");
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-accent transition-colors hover:bg-surface-2"
            >
              Tanya Asisten AI
            </button>
          )}
          {onMakeProject && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose();
                onMakeProject("");
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
            >
              Jadikan Proyek
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function FilesPage({
  clipboard,
  onSetClipboard,
  initialPath,
  onOpenAssistant,
}: Readonly<{
  clipboard: FileClipboard | null;
  onSetClipboard: (clip: FileClipboard | null) => void;
  initialPath?: string;
  onOpenAssistant: OpenAssistant;
}>) {
  const toast = useToast();
  const [places, setPlaces] = useState<Place[]>([]);
  const [devices, setDevices] = useState<Place[]>([]);
  const [folderMetas, setFolderMetas] = useState<FolderMeta[]>([]);
  const [listing, setListing] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [showHidden, setShowHidden] = useState(getInitialShowHidden);
  const [reloadToken, setReloadToken] = useState(0);

  const [confirmTrash, setConfirmTrash] = useState(false);
  const [conflictCount, setConflictCount] = useState<number | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [extractTarget, setExtractTarget] = useState<FileEntry | null>(null);
  const [compressTarget, setCompressTarget] = useState<FileEntry | null>(null);
  const [moveTarget, setMoveTarget] = useState<FileEntry | null>(null);
  const [capabilities, setCapabilities] = useState<ConvertCapabilities | null>(null);
  const [convertTarget, setConvertTarget] = useState<FileEntry | null>(null);
  const [convertBusy, setConvertBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: FileEntry | null;
  } | null>(null);
  const tabs = useFileTabs(initialPath ?? "");
  const currentPath = tabs.active.path;
  const canGoUp = Boolean(listing?.parent);
  const remotes = useRemotes();
  const home = places.find((p) => p.icon === "home")?.path ?? places[0]?.path ?? "";

  const markers = useMemo(
    () => new Map(folderMetas.map((m) => [m.path, m])),
    [folderMetas],
  );
  const bookmarks = useMemo(() => folderMetas.filter((m) => m.pinned), [folderMetas]);
  // Network mounts outside home and devices would be refused by the local path guard.
  const remotePlaces = useMemo(
    () => [
      ...remotes.remotes,
      ...remotes.mounts.filter(
        (m) => isWithin(m.path, home) || devices.some((d) => isWithin(m.path, d.path)),
      ),
    ],
    [remotes.remotes, remotes.mounts, home, devices],
  );

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

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

  // Load places and folder markers once; an empty tab starts at Home.
  useEffect(() => {
    let active = true;
    api.filePlaces().then(
      (res) => {
        if (!active) return;
        setPlaces(res.places);
        setDevices(res.devices);
        const first =
          res.places.find((p) => p.icon === "home")?.path ?? res.places[0]?.path;
        if (first) {
          tabs.go((prev) => prev || first);
        }
      },
      (e) => {
        if (active) toast(errorMessage(e), "error");
      },
    );
    api.folderMetaList().then(
      (res) => {
        if (active) setFolderMetas(res);
      },
      (e) => {
        if (active) toast(errorMessage(e), "error");
      },
    );
    return () => {
      active = false;
    };
  }, [tabs.go, toast]);

  // Which conversions the installed CLI tools support; a failure just hides the action.
  useEffect(() => {
    let active = true;
    api.convertCapabilities().then(
      (caps) => {
        if (active) setCapabilities(caps);
      },
      (e) => {
        if (!active) return;
        setCapabilities({ tools: [], formats: [] });
        toast(errorMessage(e), "error");
      },
    );
    return () => {
      active = false;
    };
  }, [toast]);

  // The mount watcher outlives renders, so it reads the location through a ref.
  const whereRef = useRef({ currentPath, home });
  useEffect(() => {
    whereRef.current = { currentPath, home };
  }, [currentPath, home]);

  const handleDevicesChange = useCallback(
    (next: readonly Place[]) => {
      setDevices([...next]);
      const { currentPath: path, home: homePath } = whereRef.current;
      const orphaned =
        homePath &&
        path &&
        !isRemotePath(path) &&
        !isWithin(path, homePath) &&
        !next.some((d) => isWithin(path, d.path));
      if (orphaned) {
        toast("Perangkat dilepas, kembali ke folder Home", "info");
        tabs.go(homePath);
      }
    },
    [tabs.go, toast],
  );
  useMountWatch(handleDevicesChange);

  // Load listing when currentPath, showHidden or reloadToken changes
  useEffect(() => {
    if (!currentPath) return;
    let active = true;
    listFolder(currentPath, showHidden).then(
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
        tabs.go(entry.path);
      } else if (isRemotePath(entry.path)) {
        toast("Berkas remote belum bisa dibuka langsung. Salin ke folder lokal dulu.", "info");
      } else {
        api.openFile(entry.path).catch((err) => toast(errorMessage(err), "error"));
      }
    },
    [tabs.go, toast],
  );

  const handleMetaChange = useCallback((path: string, meta: FolderMeta | null) => {
    setFolderMetas((prev) => {
      const rest = prev.filter((m) => m.path !== path);
      return meta ? [meta, ...rest] : rest;
    });
  }, []);

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

  const handleExtract = useCallback(
    async (path: string) => {
      try {
        await api.extractArchive(path);
        toast("Arsip berhasil diekstrak");
        reload();
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [reload, toast],
  );
  const handleCompress = useCallback(
    async (entry: FileEntry) => {
      try {
        await api.compressArchive([entry.path]);
        toast("Arsip .zip berhasil dibuat");
        reload();
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [reload, toast],
  );

  const handleExtractTo = useCallback(
    async (entry: FileEntry, dest: string) => {
      setExtractTarget(null);
      try {
        await api.extractArchive(entry.path, dest);
        toast(`Arsip diekstrak ke ${dest}`);
        reload();
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [reload, toast],
  );

  const handleCompressTo = useCallback(
    async (entry: FileEntry, destPath: string) => {
      setCompressTarget(null);
      try {
        await api.compressArchive([entry.path], destPath);
        toast("Arsip berhasil dibuat");
        reload();
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [reload, toast],
  );

  const handleConvertTo = useCallback(
    async (entry: FileEntry, target: string) => {
      setConvertBusy(true);
      try {
        const result = await api.convertFile(entry.path, target);
        toast(
          result.bytes === 0
            ? `Tidak ada isi yang bisa diekstrak; ${baseName(result.path)} kosong`
            : `Berkas dikonversi ke ${baseName(result.path)}`,
        );
        setConvertTarget(null);
        reload();
      } catch (e) {
        toast(errorMessage(e), "error");
      } finally {
        setConvertBusy(false);
      }
    },
    [reload, toast],
  );

  const handleDuplicate = useCallback(
    async (entry: FileEntry) => {
      const parent = parentPath(entry.path);
      const dest = parent === "." ? currentPath : parent;
      if (!dest) return;
      try {
        const report = await api.pasteItems({
          sources: [entry.path],
          dest,
          mode: "copy",
          onConflict: "rename",
        });
        const { ok, error } = reportToasts(report, "diduplikasi");
        if (ok) toast(ok);
        if (error) toast(error, "error");
        reload();
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [currentPath, reload, toast],
  );

  const handleMoveTo = useCallback(
    async (entry: FileEntry, dest: string) => {
      setMoveTarget(null);
      try {
        const report = await api.pasteItems({
          sources: [entry.path],
          dest,
          mode: "move",
          onConflict: "rename",
        });
        const { ok, error } = reportToasts(report, "dipindahkan");
        if (ok) toast(ok);
        if (error) toast(error, "error");
        reload();
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [reload, toast],
  );

  const handleMakeProject = useCallback(
    async (path: string) => {
      const target = path || currentPath;
      if (!target || isRemotePath(target)) return;
      if (home && target === home) {
        toast("Folder Home tidak bisa dijadikan proyek", "error");
        return;
      }
      if (home && !isWithin(target, home)) {
        toast("Folder proyek harus berada di bawah Home", "error");
        return;
      }
      const name = baseName(target) || "Proyek";
      try {
        await api.saveProject({
          name,
          kind: "app",
          description: `Folder: ${target}`,
          agent: false,
          agentDir: target,
        });
        toast(`Proyek "${name}" dibuat`);
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [currentPath, home, toast],
  );

  const handleCopyPath = useCallback(
    async (path: string) => {
      const target = path || currentPath;
      if (!target) return;
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(target);
          toast("Path disalin ke papan klip");
        }
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [currentPath, toast],
  );

  const handleToggleBookmark = useCallback(
    async (entry: FileEntry) => {
      if (entry.kind !== "folder") return;
      const isPinned = folderMetas.some((m) => m.path === entry.path && m.pinned);
      try {
        const next = await api.folderMetaPin(entry.path, !isPinned);
        handleMetaChange(entry.path, next);
        toast(isPinned ? "Dihapus dari Markah" : "Ditambahkan ke Markah");
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [folderMetas, handleMetaChange, toast],
  );
  const handleOpenTerminal = useCallback(
    async (path?: string) => {
      const target = path || currentPath;
      if (!target) return;
      try {
        await api.openTerminalAt(target);
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [currentPath, toast],
  );

  const handleAskAssistant = useCallback(
    (path?: string) => {
      const target = path || currentPath;
      if (!target) return;
      onOpenAssistant({
        kind: "compose",
        text: `Bantu jelaskan atau kelola isi folder ini:\nLokasi: ${target}`,
      });
    },
    [currentPath, onOpenAssistant],
  );

  const handleDropIntoFolder = useCallback(
    async (sources: string[], targetFolder: string) => {
      try {
        const report = await api.pasteItems({
          sources,
          dest: targetFolder,
          mode: "move",
          onConflict: "rename",
        });
        const { ok, error } = reportToasts(report, "dipindahkan");
        if (ok) toast(ok);
        if (error) toast(error, "error");
        reload();
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [reload, toast],
  );

  const handleRenameConfirm = useCallback(
    async (newName: string) => {
      if (!renameTarget) return;
      try {
        await api.renameEntry(renameTarget.path, newName, showHidden);
        toast("Nama berhasil diubah");
        setRenameTarget(null);
        reload();
      } catch (e) {
        toast(errorMessage(e), "error");
      }
    },
    [renameTarget, showHidden, reload, toast],
  );

  useFilesKeyboard({
    isDialogOpen:
      confirmTrash ||
      conflictCount !== null ||
      newFolderOpen ||
      renameTarget !== null ||
      extractTarget !== null ||
      compressTarget !== null ||
      moveTarget !== null ||
      convertTarget !== null,
    parentPath: listing?.parent,
    selectedEntry: singleEntry,
    onGoParent: tabs.go,
    onOpenEntry: handleOpen,
    onTogglePreview: () => {
      if (selected.length > 0) {
        setSelected([]);
        setAnchor(null);
      }
    },
    onCopy: handleCopy,
    onCut: handleMove,
    onPaste: () => void paste(),
    onDelete: () => {
      if (selectedEntries.length > 0) setConfirmTrash(true);
    },
    onSelectAll: () => {
      if (listing?.entries.length) {
        setSelected(listing.entries.map((_, i) => i));
      }
    },
    onNewTab: () => tabs.openTab(home || currentPath),
    onCloseTab: () => tabs.closeTab(tabs.active.id),
  });

  return (
    <div className="flex h-full flex-col gap-3.5">
      <div className="flex items-center justify-between gap-3">
        <h1 className={H1}>Berkas</h1>
        <button
          type="button"
          onClick={() => setNewFolderOpen(true)}
          className="flex h-8 items-center gap-1.5 rounded-[9px] bg-accent px-3.5 text-xs font-semibold text-canvas transition-colors hover:brightness-105"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Folder baru
        </button>
      </div>

      <FileTabsBar
        tabs={tabs.state.tabs}
        activeId={tabs.state.activeId}
        onActivate={tabs.activate}
        onClose={tabs.closeTab}
        onNewTab={() => tabs.openTab(home || currentPath)}
      />

      <FilesToolbar
        canGoBack={tabs.canBack}
        canGoForward={tabs.canForward}
        canGoUp={canGoUp}
        onGoBack={tabs.back}
        onGoForward={tabs.forward}
        onGoUp={() => listing?.parent && tabs.go(listing.parent)}
        crumbs={listing?.crumbs ?? []}
        onNavigate={tabs.go}
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
          bookmarks={bookmarks}
          remotes={remotePlaces}
          remoteHint={remotes.hint}
          remoteVersion={remotes.version}
          markers={markers}
          currentPath={currentPath}
          onSelectPlace={(path) => {
            if (path === currentPath) {
              reload();
            } else {
              tabs.go(path);
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
              markers={markers}
              clipboard={clipboard}
              onSelect={handleSelect}
              onOpen={handleOpen}
              onDropIntoFolder={handleDropIntoFolder}
              onContextMenu={(entry, e) =>
                setContextMenu({ x: e.clientX, y: e.clientY, entry })
              }
            />
          ) : (
            <FileList
              entries={listing?.entries ?? []}
              selected={selected}
              markers={markers}
              clipboard={clipboard}
              onSelect={handleSelect}
              onOpen={handleOpen}
              onDropIntoFolder={handleDropIntoFolder}
              onContextMenu={(entry, e) =>
                setContextMenu({ x: e.clientX, y: e.clientY, entry })
              }
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
            onOpenAssistant={onOpenAssistant}
            entry={singleEntry}
            onClose={() => {
              setSelected([]);
              setAnchor(null);
            }}
            onOpen={handleOpen}
            onExtract={handleExtract}
          >
            {singleEntry.kind === "folder" && (
              <FolderTools
                entry={singleEntry}
                meta={markers.get(singleEntry.path)}
                onMetaChange={handleMetaChange}
                onOpenTab={tabs.openTab}
              />
            )}
          </PreviewPanel>
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
      {newFolderOpen && (
        <NewFolderDialog
          onConfirm={(name) => {
            if (!currentPath) return;
            api.createDir(currentPath, name, showHidden)
              .then(() => {
                setReloadToken((t) => t + 1);
                setNewFolderOpen(false);
                toast("Folder berhasil dibuat");
              })
              .catch((e) => toast(errorMessage(e), "error"));
          }}
          onCancel={() => setNewFolderOpen(false)}
        />
      )}
      {renameTarget && (
        <RenameDialog
          initialName={renameTarget.name}
          onConfirm={handleRenameConfirm}
          onCancel={() => setRenameTarget(null)}
        />
      )}
      {extractTarget && (
        <ExtractDialog
          entry={extractTarget}
          onConfirm={(dest) => void handleExtractTo(extractTarget, dest)}
          onCancel={() => setExtractTarget(null)}
        />
      )}
      {compressTarget && (
        <CompressDialog
          entry={compressTarget}
          onConfirm={(dest) => void handleCompressTo(compressTarget, dest)}
          onCancel={() => setCompressTarget(null)}
        />
      )}
      {moveTarget && (
        <MoveDialog
          entry={moveTarget}
          initialPath={currentPath}
          onConfirm={(dest) => void handleMoveTo(moveTarget, dest)}
          onCancel={() => setMoveTarget(null)}
        />
      )}
      {convertTarget && (
        <ConvertDialog
          entry={convertTarget}
          formats={capabilities?.formats ?? []}
          takenNames={listing?.entries.map((e) => e.name) ?? []}
          busy={convertBusy}
          onConfirm={(target) => void handleConvertTo(convertTarget, target)}
          onCancel={() => setConvertTarget(null)}
        />
      )}
      {contextMenu && (
        <FileContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          clipboard={clipboard}
          onOpen={handleOpen}
          onOpenTab={(p) => tabs.openTab(p)}
          onOpenTerminal={
            currentPath && !isRemotePath(currentPath)
              ? handleOpenTerminal
              : undefined
          }
          onAskAssistant={handleAskAssistant}
          onCopy={(e) => {
            onSetClipboard({ mode: "copy", paths: [e.path] });
            toast("Disalin ke papan klip");
          }}
          onCut={(e) => {
            onSetClipboard({ mode: "move", paths: [e.path] });
            toast("Ditandai untuk dipindahkan");
          }}
          onPaste={() => void paste()}
          onRename={(e) => setRenameTarget(e)}
          onTrash={(e) => {
            const idx = listing?.entries.findIndex((x) => x.path === e.path);
            setSelected(idx !== undefined && idx !== -1 ? [idx] : []);
            setConfirmTrash(true);
          }}
          onExtract={(e) => void handleExtract(e.path)}
          onExtractTo={(e) => setExtractTarget(e)}
          onCompress={(e) => void handleCompress(e)}
          onCompressAs={(e) => setCompressTarget(e)}
          onConvert={(e) => setConvertTarget(e)}
          convertible={
            contextMenu.entry
              ? targetsFor(contextMenu.entry.name, capabilities?.formats ?? []).length > 0
              : false
          }
          onDuplicate={(e) => void handleDuplicate(e)}
          onMoveTo={(e) => setMoveTarget(e)}
          onMakeProject={
            currentPath && !isRemotePath(currentPath)
              ? (p) => void handleMakeProject(p)
              : undefined
          }
          onCopyPath={(p) => void handleCopyPath(p)}
          onToggleBookmark={(e) => void handleToggleBookmark(e)}
          isBookmarked={
            contextMenu.entry?.kind === "folder" &&
            folderMetas.some(
              (m) => m.path === contextMenu.entry?.path && m.pinned,
            )
          }
          onNewFolder={() => setNewFolderOpen(true)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
