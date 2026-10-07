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
      expect(html).toContain("Tempat");
      expect(html).toContain("Home");
      expect(html).toContain("Dokumen");
      expect(html).toContain('aria-current="page"');
      expect(html).not.toContain("Perangkat");
      expect(html).not.toContain("Markah");
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
      expect(html).toContain("Perangkat");
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
      expect(html).toContain("Markah");
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
      expect(html).toContain('aria-label="Kembali"');
      expect(html).toContain('aria-label="Maju"');
      expect(html).toContain('aria-label="Naik satu folder"');
      expect(html).toContain('aria-label="Tampilan ikon"');
      expect(html).toContain('aria-label="Tampilan daftar"');
      expect(html).toContain("Tampilkan tersembunyi");
      expect(html).toContain("Home");
      expect(html).toContain("Dokumen");
      expect(html).not.toContain("Tempel");
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
      expect(html).toContain("Tempel 3 item");
      expect(html).toContain('aria-label="Kosongkan papan klip"');
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
      expect(gridHtml).toContain("Folder kosong");

      const listHtml = renderToStaticMarkup(
        <FileList
          entries={[]}
          selected={[]}
          onSelect={() => {}}
          onOpen={() => {}}
        />,
      );
      expect(listHtml).toContain("Folder kosong");
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
      expect(html).toContain("Nama");
      expect(html).toContain("Ukuran");
      expect(html).toContain("Jenis");
      expect(html).toContain("Diubah");
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
      expect(tabLabel("")).toBe("Berkas");
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
      expect(html).toContain("Tutup tab c");
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
      expect(html).toContain("3 item");
      expect(html).toContain("12,4 MB");
      expect(html).toContain("· 12,4 MB");
      expect(html).toContain("Salin");
      expect(html).toContain("Pindahkan");
      expect(html).toContain("Hapus");
      expect(html).toContain("Batal");
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
      expect(html).toContain("2 nama sudah ada di folder ini");
      expect(html).toContain("Ganti");
      expect(html).toContain("Lewati");
      expect(html).toContain("Simpan dengan nama baru");
      expect(html).toContain("Batal");
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
      expect(html).toContain("Gambar");
      expect(html).toContain("Tanya asisten");
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
      expect(html).toContain("Penanda");
      expect(html).toContain('aria-label="Penanda 📷" aria-pressed="true"');
      expect(html).toContain("Hapus dari Markah");
      expect(html).toContain("Buka di tab baru");
      expect(html).toContain("Ringkasan folder");
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
      expect(tools).toContain("Tambah ke Markah");
      expect(tools).not.toContain("Ringkasan folder");

      const html = renderToStaticMarkup(
        <PreviewPanel
          onOpenAssistant={() => {}}
          entry={{ ...imageEntry, path: "rclone:gdrive:pantai.jpg" }}
          onClose={() => {}}
          onOpen={() => {}}
        />,
      );
      expect(html).not.toContain("<img");
      expect(html).toContain("Pratinjau belum tersedia");
    });
  });
});
