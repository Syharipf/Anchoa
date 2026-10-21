import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FileEntry, FolderMeta, Place } from "../api";
import { ActionBar } from "./ActionBar";
import { ConflictDialog } from "./ConflictDialog";
import { FileGrid } from "./FileGrid";
import { FileList } from "./FileList";
import { FileTabsBar, tabLabel } from "./FileTabsBar";
import { FilesToolbar } from "./FilesToolbar";
import { FolderTools } from "./FolderTools";
import { PlacesSidebar } from "./PlacesSidebar";
import { PreviewPanel } from "./PreviewPanel";
import { FileContextMenu } from "./FilesPage";
import { ConvertDialog } from "./ConvertDialog";
import { FolderPickerBody } from "./FolderPicker";
const NO_MARKERS: ReadonlyMap<string, FolderMeta> = new Map();

function folderMeta(path: string, patch: Partial<FolderMeta> = {}): FolderMeta {
  return { path, emoji: "", color: "", pinned: false, updatedAt: 1, ...patch };
}

describe("file manager components", () => {
  describe("PlacesSidebar", () => {
    const places: Place[] = [
      { name: "Home", path: "/home/user", icon: "home" },
      { name: "Dokumen", path: "/home/user/Dokumen", icon: "doc" },
    ];
    const devices: Place[] = [
      { name: "USB Flash", path: "/run/media/user/usb", icon: "drive" },
    ];

    it("renders Tempat places and sets aria-current on active path", () => {
      const html = renderToStaticMarkup(
        <PlacesSidebar
          places={places}
          devices={[]}
          bookmarks={[]}
          remotes={[]}
          remoteHint={null}
          remoteVersion={null}
          markers={NO_MARKERS}
          currentPath="/home/user"
          onSelectPlace={() => {}}
        />,
      );
      expect(html).toContain("Places");
      expect(html).toContain("Home");
      expect(html).toContain("Dokumen");
      expect(html).toContain('aria-current="page"');
      expect(html).not.toContain("Devices");
      expect(html).not.toContain("Bookmarks");
      expect(html).not.toContain("Remote");
    });

    it("renders Perangkat section only when devices are present", () => {
      const html = renderToStaticMarkup(
        <PlacesSidebar
          places={places}
          devices={devices}
          bookmarks={[]}
          remotes={[]}
          remoteHint={null}
          remoteVersion={null}
          markers={NO_MARKERS}
          currentPath="/home/user"
          onSelectPlace={() => {}}
        />,
      );
      expect(html).toContain("Devices");
      expect(html).toContain("USB Flash");
    });

    it("lists bookmarks with their marker and remotes with the cloud badge", () => {
      const foto = folderMeta("/home/user/Foto", { emoji: "📷", pinned: true });
      const html = renderToStaticMarkup(
        <PlacesSidebar
          places={places}
          devices={[]}
          bookmarks={[foto]}
          remotes={[{ name: "gdrive", path: "rclone:gdrive:", icon: "remote" }]}
          remoteHint={null}
          remoteVersion="rclone v1.67.0"
          markers={new Map([[foto.path, foto]])}
          currentPath="rclone:gdrive:"
          onSelectPlace={() => {}}
        />,
      );
      expect(html).toContain("Bookmarks");
      expect(html).toContain("Foto");
      expect(html).toContain("📷");
      expect(html).toContain("Remote");
      expect(html).toContain("gdrive");
      expect(html).toContain('title="rclone v1.67.0"');
      expect(html).toContain('aria-current="page"');
    });

    it("shows the rclone install hint when no remote is available", () => {
      const html = renderToStaticMarkup(
        <PlacesSidebar
          places={places}
          devices={[]}
          bookmarks={[]}
          remotes={[]}
          remoteHint="rclone tidak ditemukan. Pasang rclone"
          remoteVersion={null}
          markers={NO_MARKERS}
          currentPath="/home/user"
          onSelectPlace={() => {}}
        />,
      );
      expect(html).toContain("Remote");
      expect(html).toContain("rclone tidak ditemukan");
    });
  });

  describe("FilesToolbar", () => {
    const crumbs = [
      { name: "Home", path: "/home/user" },
      { name: "Dokumen", path: "/home/user/Dokumen" },
    ];

    it("renders navigation buttons with exact Indonesian aria-labels", () => {
      const html = renderToStaticMarkup(
        <FilesToolbar
          canGoBack={true}
          canGoForward={false}
          canGoUp={true}
          onGoBack={() => {}}
          onGoForward={() => {}}
          onGoUp={() => {}}
          crumbs={crumbs}
          onNavigate={() => {}}
          view="grid"
          onToggleView={() => {}}
          showHidden={false}
          onToggleHidden={() => {}}
          clipboardCount={0}
          onPaste={() => {}}
          onClearClipboard={() => {}}
        />,
      );
      expect(html).toContain('aria-label="Back"');
      expect(html).toContain('aria-label="Forward"');
      expect(html).toContain('aria-label="Up one folder"');
      expect(html).toContain('aria-label="Icon view"');
      expect(html).toContain('aria-label="List view"');
      expect(html).toContain("Show hidden");
      expect(html).toContain("Home");
      expect(html).toContain("Dokumen");
      expect(html).not.toContain("Paste");
    });

    it("renders paste and clear buttons when clipboard has items", () => {
      const html = renderToStaticMarkup(
        <FilesToolbar
          canGoBack={false}
          canGoForward={false}
          canGoUp={false}
          onGoBack={() => {}}
          onGoForward={() => {}}
          onGoUp={() => {}}
          crumbs={crumbs}
          onNavigate={() => {}}
          view="grid"
          onToggleView={() => {}}
          showHidden={true}
          onToggleHidden={() => {}}
          clipboardCount={3}
          onPaste={() => {}}
          onClearClipboard={() => {}}
        />,
      );
      expect(html).toContain("Paste 3 items");
      expect(html).toContain('aria-label="Clear clipboard"');
    });
  });

  describe("FileGrid and FileList", () => {
    const entries: FileEntry[] = [
      {
        name: "foto.png",
        path: "/home/user/foto.png",
        kind: "image",
        size: 1048576,
        modified: 1774900000000,
        hidden: false,
      },
      {
        name: "berkas.pdf",
        path: "/home/user/berkas.pdf",
        kind: "pdf",
        size: 512,
        modified: 1774900000000,
        hidden: false,
      },
    ];

    it("renders empty folder text when entries list is empty", () => {
      const gridHtml = renderToStaticMarkup(
        <FileGrid
          entries={[]}
          selected={[]}
          onSelect={() => {}}
          onOpen={() => {}}
        />,
      );
      expect(gridHtml).toContain("Empty folder");

      const listHtml = renderToStaticMarkup(
        <FileList
          entries={[]}
          selected={[]}
          onSelect={() => {}}
          onOpen={() => {}}
        />,
      );
      expect(listHtml).toContain("Empty folder");
    });

    it("renders lazy loading image tag for image entries in grid", () => {
      const html = renderToStaticMarkup(
        <FileGrid
          entries={entries}
          selected={[0]}
          onSelect={() => {}}
          onOpen={() => {}}
        />,
      );
      expect(html).toContain('loading="lazy"');
      expect(html).toContain("data-file-entry");
      expect(html).toContain("foto.png");
      expect(html).toContain("berkas.pdf");
    });

    it("renders headers and columns in list view", () => {
      const html = renderToStaticMarkup(
        <FileList
          entries={entries}
          selected={[1]}
          onSelect={() => {}}
          onOpen={() => {}}
        />,
      );
      expect(html).toContain("Name");
      expect(html).toContain("Size");
      expect(html).toContain("Kind");
      expect(html).toContain("Modified");
      expect(html).toContain("data-file-entry");
      expect(html).toContain("foto.png");
      expect(html).toContain("PDF");
    });

    it("shows folder markers in grid and list", () => {
      const folder: FileEntry = {
        name: "Foto",
        path: "/home/user/Foto",
        kind: "folder",
        size: 3,
        modified: 1774900000000,
        hidden: false,
      };
      const markers = new Map([[folder.path, folderMeta(folder.path, { emoji: "📷", color: "#ff8800" })]]);
      for (const Component of [FileGrid, FileList]) {
        const html = renderToStaticMarkup(
          <Component entries={[folder]} selected={[]} markers={markers} onSelect={() => {}} onOpen={() => {}} />,
        );
        expect(html).toContain("📷");
        expect(html).toContain("color:#ff8800");
      }
    });

    it("never points an image thumbnail at a remote path", () => {
      const remoteImage: FileEntry = { ...entries[0], path: "rclone:gdrive:foto.png" };
      const html = renderToStaticMarkup(
        <FileGrid entries={[remoteImage]} selected={[]} onSelect={() => {}} onOpen={() => {}} />,
      );
      expect(html).not.toContain("<img");
    });
  });

  describe("FileTabsBar", () => {
    it("labels tabs by their last folder or remote name", () => {
      expect(tabLabel("/home/user/Dokumen/")).toBe("Dokumen");
      expect(tabLabel("rclone:gdrive:")).toBe("gdrive");
      expect(tabLabel("rclone:gdrive:Docs/Arsip")).toBe("Arsip");
      expect(tabLabel("/")).toBe("/");
      expect(tabLabel("")).toBe("Files");
    });

    it("stays hidden with one tab and renders closable tabs otherwise", () => {
      const one = { id: "/a", path: "/a", entries: ["/a"], index: 0 };
      const two = { id: "/b", path: "/b/c", entries: ["/b", "/b/c"], index: 1 };
      expect(renderToStaticMarkup(<FileTabsBar tabs={[one]} activeId="/a" onActivate={() => {}} onClose={() => {}} />)).toBe("");
      const html = renderToStaticMarkup(
        <FileTabsBar tabs={[one, two]} activeId="/b" onActivate={() => {}} onClose={() => {}} />,
      );
      expect(html).toContain('role="tablist"');
      expect(html).toContain('aria-selected="true"');
      expect(html).toContain("Close tab c");
    });
  });

  describe("ActionBar", () => {
    it("renders selected items, total size, actions and 88px padding", () => {
      const html = renderToStaticMarkup(
        <ActionBar
          selectedCount={3}
          totalSizeBytes={13002342}
          onCopy={() => {}}
          onMove={() => {}}
          onTrash={() => {}}
          onClear={() => {}}
        />,
      );
      expect(html).toContain("3 items");
      expect(html).toContain("12,4 MB");
      expect(html).toContain("· 12,4 MB");
      expect(html).toContain("Copy");
      expect(html).toContain("Move");
      expect(html).toContain("Delete");
      expect(html).toContain("Cancel");
      expect(html).toContain("pr-[88px]");
    });
  });

  describe("ConflictDialog", () => {
    it("renders conflict count and resolution options", () => {
      const html = renderToStaticMarkup(
        <ConflictDialog
          conflictCount={2}
          onResolve={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(html).toContain("2 name(s) already exist in this folder");
      expect(html).toContain("Replace");
      expect(html).toContain("Skip");
      expect(html).toContain("Save with new name");
      expect(html).toContain("Cancel");
    });
  });

  describe("PreviewPanel", () => {
    const imageEntry: FileEntry = {
      name: "pantai.jpg",
      path: "/home/user/pantai.jpg",
      kind: "image",
      size: 4404019,
      modified: 1774900000000,
      hidden: false,
    };

    const videoEntry: FileEntry = {
      name: "demo.mp4",
      path: "/home/user/demo.mp4",
      kind: "video",
      size: 20000000,
      modified: 1774900000000,
      hidden: false,
    };

    const pdfEntry: FileEntry = {
      name: "dok.pdf",
      path: "/home/user/dok.pdf",
      kind: "pdf",
      size: 100000,
      modified: 1774900000000,
      hidden: false,
    };

    it("renders image preview and metadata", () => {
      const html = renderToStaticMarkup(
        <PreviewPanel
          onOpenAssistant={() => {}}
          entry={imageEntry}
          onClose={() => {}}
          onOpen={() => {}}
        />,
      );
      expect(html).toContain("pantai.jpg");
      expect(html).toContain("Image");
      expect(html).toContain("Ask assistant");
      expect(html).toContain("<img");
    });

    it("renders video preview with preload and controls but no autoplay", () => {
      const html = renderToStaticMarkup(
        <PreviewPanel
          onOpenAssistant={() => {}}
          entry={videoEntry}
          onClose={() => {}}
          onOpen={() => {}}
        />,
      );
      expect(html).toContain("<video");
      expect(html).toContain('aria-label="Video demo.mp4"');
      expect(html).toContain('preload="metadata"');
      expect(html).toContain("controls");
      expect(html).not.toContain("autoplay");
    });

    it("renders pdf preview in iframe", () => {
      const html = renderToStaticMarkup(
        <PreviewPanel
          onOpenAssistant={() => {}}
          entry={pdfEntry}
          onClose={() => {}}
          onOpen={() => {}}
        />,
      );
      expect(html).toContain("<iframe");
      expect(html).toContain('title="dok.pdf"');
    });

    it("renders folder tools inside the panel for a local folder", () => {
      const folder: FileEntry = {
        name: "Foto",
        path: "/home/user/Foto",
        kind: "folder",
        size: 3,
        modified: 1774900000000,
        hidden: false,
      };
      const html = renderToStaticMarkup(
        <PreviewPanel onOpenAssistant={() => {}} entry={folder} onClose={() => {}} onOpen={() => {}}>
          <FolderTools
            entry={folder}
            meta={folderMeta(folder.path, { emoji: "📷", pinned: true })}
            onMetaChange={() => {}}
            onOpenTab={() => {}}
          />
        </PreviewPanel>,
      );
      expect(html).toContain("Markers");
      expect(html).toContain('aria-label="Marker 📷" aria-pressed="true"');
      expect(html).toContain("Remove from Bookmarks");
      expect(html).toContain("Open in new tab");
      expect(html).toContain("Folder summary");
    });

    it("hides the local-only summary for remote folders and their file previews", () => {
      const remoteFolder: FileEntry = {
        name: "Docs",
        path: "rclone:gdrive:Docs",
        kind: "folder",
        size: 0,
        modified: 0,
        hidden: false,
      };
      const tools = renderToStaticMarkup(
        <FolderTools entry={remoteFolder} meta={undefined} onMetaChange={() => {}} onOpenTab={() => {}} />,
      );
      expect(tools).toContain("Add to Bookmarks");
      expect(tools).not.toContain("Folder summary");

      const html = renderToStaticMarkup(
        <PreviewPanel
          onOpenAssistant={() => {}}
          entry={{ ...imageEntry, path: "rclone:gdrive:pantai.jpg" }}
          onClose={() => {}}
          onOpen={() => {}}
        />,
      );
      expect(html).not.toContain("<img");
      expect(html).toContain("Preview not available");
    });
  });

  describe("FileContextMenu", () => {
    const folderEntry: FileEntry = {
      name: "Proyek",
      path: "/home/user/Proyek",
      kind: "folder",
      size: 0,
      modified: 0,
      hidden: false,
    };

    it("renders folder actions: Buka di Tab Baru, Buka di Terminal, Tanya Asisten AI, Salin Path, Kompres ke .zip, Tambah ke Markah", () => {
      const html = renderToStaticMarkup(
        <FileContextMenu
          x={100}
          y={100}
          entry={folderEntry}
          isBookmarked={false}
          clipboard={null}
          onOpen={() => {}}
          onOpenTab={() => {}}
          onOpenTerminal={() => {}}
          onAskAssistant={() => {}}
          onCopy={() => {}}
          onCopyPath={() => {}}
          onToggleBookmark={() => {}}
          onCut={() => {}}
          onPaste={() => {}}
          onRename={() => {}}
          onTrash={() => {}}
          onExtract={() => {}}
          onExtractTo={() => {}}
          onCompress={() => {}}
          onCompressAs={() => {}}
          onDuplicate={() => {}}
          onMoveTo={() => {}}
          onMakeProject={() => {}}
          onNewFolder={() => {}}
          onClose={() => {}}
        />,
      );
      expect(html).toContain("Open in New Tab");
      expect(html).toContain("Open in Terminal");
      expect(html).toContain("Ask AI Assistant");
      expect(html).toContain("Turn into Project");
      expect(html).toContain("Copy Path");
      expect(html).toContain("Compress to .zip");
      expect(html).toContain("Compress as…");
      expect(html).toContain("Duplicate");
      expect(html).toContain("Move to…");
      expect(html).toContain("Add to Bookmarks");
    });

    it("offers both extract actions for archives and hides local-only ones on rclone paths", () => {
      const archive: FileEntry = {
        name: "backup.tar.gz",
        path: "/home/user/backup.tar.gz",
        kind: "other",
        size: 1024,
        modified: 0,
        hidden: false,
      };
      const local = renderToStaticMarkup(
        <FileContextMenu
          x={100}
          y={100}
          entry={archive}
          clipboard={null}
          onOpen={() => {}}
          onCopy={() => {}}
          onCopyPath={() => {}}
          onCut={() => {}}
          onPaste={() => {}}
          onRename={() => {}}
          onTrash={() => {}}
          onExtract={() => {}}
          onExtractTo={() => {}}
          onCompress={() => {}}
          onNewFolder={() => {}}
          onClose={() => {}}
        />,
      );
      expect(local).toContain("Extract here");
      expect(local).toContain("Extract to folder…");

      const remote = renderToStaticMarkup(
        <FileContextMenu
          x={100}
          y={100}
          entry={{ ...folderEntry, path: "rclone:gdrive:Docs" }}
          clipboard={null}
          onOpen={() => {}}
          onOpenTerminal={() => {}}
          onCopy={() => {}}
          onCopyPath={() => {}}
          onCut={() => {}}
          onPaste={() => {}}
          onRename={() => {}}
          onTrash={() => {}}
          onExtract={() => {}}
          onExtractTo={() => {}}
          onCompress={() => {}}
          onCompressAs={() => {}}
          onDuplicate={() => {}}
          onMoveTo={() => {}}
          onMakeProject={() => {}}
          onNewFolder={() => {}}
          onClose={() => {}}
        />,
      );
      expect(remote).not.toContain("Open in Terminal");
      expect(remote).not.toContain("Turn into Project");
      expect(remote).not.toContain("Compress to .zip");
      expect(remote).not.toContain("Duplicate");
      expect(remote).not.toContain("Move to…");
    });

    it("hides extract and compress for an archive on an rclone path", () => {
      const html = renderToStaticMarkup(
        <FileContextMenu
          x={100}
          y={100}
          entry={{
            name: "backup.tar.gz",
            path: "rclone:gdrive:backup.tar.gz",
            kind: "other",
            size: 1024,
            modified: 0,
            hidden: false,
          }}
          clipboard={null}
          onOpen={() => {}}
          onCopy={() => {}}
          onCopyPath={() => {}}
          onCut={() => {}}
          onPaste={() => {}}
          onRename={() => {}}
          onTrash={() => {}}
          onExtract={() => {}}
          onExtractTo={() => {}}
          onCompress={() => {}}
          onCompressAs={() => {}}
          onNewFolder={() => {}}
          onClose={() => {}}
        />,
      );
      expect(html).not.toContain("Extract here");
      expect(html).not.toContain("Extract to folder…");
      expect(html).not.toContain("Compress to .zip");
      expect(html).not.toContain("Compress as…");
    });

    it("renders Hapus dari Markah if folder is already bookmarked", () => {
      const html = renderToStaticMarkup(
        <FileContextMenu
          x={100}
          y={100}
          entry={folderEntry}
          isBookmarked={true}
          clipboard={null}
          onOpen={() => {}}
          onCopy={() => {}}
          onCopyPath={() => {}}
          onToggleBookmark={() => {}}
          onCut={() => {}}
          onPaste={() => {}}
          onRename={() => {}}
          onTrash={() => {}}
          onExtract={() => {}}
          onCompress={() => {}}
          onNewFolder={() => {}}
          onClose={() => {}}
        />,
      );
      expect(html).toContain("Remove from Bookmarks");
    });

    it("renders empty folder context menu with Salin Path Folder, Buka di Terminal, Tanya Asisten AI", () => {
      const html = renderToStaticMarkup(
        <FileContextMenu
          x={100}
          y={100}
          entry={null}
          clipboard={null}
          onOpen={() => {}}
          onOpenTab={() => {}}
          onOpenTerminal={() => {}}
          onAskAssistant={() => {}}
          onCopy={() => {}}
          onCopyPath={() => {}}
          onCut={() => {}}
          onPaste={() => {}}
          onRename={() => {}}
          onTrash={() => {}}
          onExtract={() => {}}
          onCompress={() => {}}
          onNewFolder={() => {}}
          onClose={() => {}}
        />,
      );
      expect(html).toContain("New Folder");
      expect(html).toContain("Copy Folder Path");
      expect(html).toContain("Open in Terminal");
      expect(html).toContain("Ask AI Assistant");
    });
  });

  describe("FolderPickerBody", () => {
    const dummyFolders: FileEntry[] = [
      {
        name: "Proyek",
        path: "/home/user/Proyek",
        kind: "folder",
        size: 0,
        modified: 1000,
        hidden: false,
      },
      {
        name: "Dokumen",
        path: "/home/user/Dokumen",
        kind: "folder",
        size: 0,
        modified: 2000,
        hidden: false,
      },
    ];

    it("renders title, path, folder buttons, and choose button", () => {
      const html = renderToStaticMarkup(
        <FolderPickerBody
          path="/home/user"
          folders={dummyFolders}
          onUp={() => {}}
          onEnter={() => {}}
          onChoose={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(html).toContain("Select Folder");
      expect(html).toContain("/home/user");
      expect(html).toContain("Proyek");
      expect(html).toContain("Dokumen");
      expect(html).toContain("Select this folder");
      expect(html).toContain("Cancel");
    });

    it("disables Naik button when path is / (root)", () => {
      const html = renderToStaticMarkup(
        <FolderPickerBody
          path="/"
          folders={[]}
          onUp={() => {}}
          onEnter={() => {}}
          onChoose={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>\s*Up\s*<\/button>/);
    });

    it("renders empty state when there are no subfolders", () => {
      const html = renderToStaticMarkup(
        <FolderPickerBody
          path="/home/user/Kosong"
          folders={[]}
          onUp={() => {}}
          onEnter={() => {}}
          onChoose={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(html).toContain("No subfolders");
    });

    it("displays error with role=alert when present", () => {
      const html = renderToStaticMarkup(
        <FolderPickerBody
          path="/root/rahasia"
          folders={[]}
          error="Akses ditolak"
          onUp={() => {}}
          onEnter={() => {}}
          onChoose={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(html).toContain('role="alert"');
      expect(html).toContain("Akses ditolak");
    });
  });

  describe("ConvertDialog", () => {
    const png: FileEntry = {
      name: "foto.png",
      path: "/home/user/foto.png",
      kind: "image",
      size: 1024,
      modified: 0,
      hidden: false,
    };
    const imageFormats = [
      { sourceExt: "png", kind: "image" as const, targets: ["jpg", "webp"] },
      { sourceExt: "pdf", kind: "pdf" as const, targets: ["png", "txt"] },
    ];

    it("renders targets, output preview, and the no-overwrite note", () => {
      const html = renderToStaticMarkup(
        <ConvertDialog
          entry={png}
          formats={imageFormats}
          takenNames={[]}
          busy={false}
          onConfirm={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(html).toContain("Source: foto.png");
      expect(html).toContain("JPG");
      expect(html).toContain("WEBP");
      expect(html).toContain("/home/user/foto.jpg");
      expect(html).toContain("Does not overwrite existing files");
    });

    it("previews the next free name when the target exists", () => {
      const html = renderToStaticMarkup(
        <ConvertDialog
          entry={png}
          formats={imageFormats}
          takenNames={["foto.jpg"]}
          busy={false}
          onConfirm={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(html).toContain("/home/user/foto (2).jpg");
    });

    it("shows the running state with disabled buttons", () => {
      const html = renderToStaticMarkup(
        <ConvertDialog
          entry={png}
          formats={imageFormats}
          takenNames={[]}
          busy
          onConfirm={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(html).toContain("Converting…");
      expect(html).toContain("disabled");
    });

    it("explains when no target is available and for PDF first page", () => {
      const empty = renderToStaticMarkup(
        <ConvertDialog
          entry={{ ...png, name: "catatan.docx" }}
          formats={imageFormats}
          takenNames={[]}
          busy={false}
          onConfirm={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(empty).toContain("No target format available");

      const pdf = renderToStaticMarkup(
        <ConvertDialog
          entry={{ ...png, name: "laporan.pdf", path: "/home/user/laporan.pdf" }}
          formats={imageFormats}
          takenNames={[]}
          busy={false}
          onConfirm={() => {}}
          onCancel={() => {}}
        />,
      );
      expect(pdf).toContain("First page only");
    });
  });

  describe("convert menu item", () => {
    const png: FileEntry = {
      name: "foto.png",
      path: "/home/user/foto.png",
      kind: "image",
      size: 1024,
      modified: 0,
      hidden: false,
    };

    it("shows Convert… only for a convertible local file", () => {
      const menu = (entry: FileEntry, convertible: boolean) =>
        renderToStaticMarkup(
          <FileContextMenu
            x={10}
            y={10}
            entry={entry}
            clipboard={null}
            onOpen={() => {}}
            onCopy={() => {}}
            onCopyPath={() => {}}
            onCut={() => {}}
            onPaste={() => {}}
            onRename={() => {}}
            onTrash={() => {}}
            onExtract={() => {}}
            onCompress={() => {}}
            onConvert={() => {}}
            convertible={convertible}
            onNewFolder={() => {}}
            onClose={() => {}}
          />,
        );
      expect(menu(png, true)).toContain("Convert…");
      expect(menu(png, false)).not.toContain("Convert…");
      expect(menu({ ...png, path: "rclone:gdrive:foto.png" }, true)).not.toContain(
        "Convert…",
      );
    });
  });
});
