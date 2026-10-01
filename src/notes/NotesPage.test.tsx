import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Backlink } from "../api";
import { Backlinks } from "./Backlinks";
import { MoveDialog } from "./MoveDialog";
import { PageTree } from "./PageTree";
import { TrashDialog } from "./TrashDialog";
import { buildTree } from "./view";

describe("PageTree", () => {
  it("renders tree nodes and highlights selected node", () => {
    const nodes = [
      { id: "root1", title: "Akar Satu", parentId: null, updatedAt: 100 },
      { id: "child1", title: "Anak Satu", parentId: "root1", updatedAt: 200 },
    ];
    const tree = buildTree(nodes);

    const html = renderToStaticMarkup(
      <PageTree
        tree={tree}
        selectedId="root1"
        onSelect={() => {}}
        onCreateSubpage={() => {}}
        onStartRename={() => {}}
        onStartMove={() => {}}
        onStartDelete={() => {}}
      />,
    );

    expect(html).toContain("Akar Satu");
    expect(html).toContain("Menu Akar Satu");
    expect(html).toContain("text-accent");
  });
});

describe("Backlinks", () => {
  it("renders empty state when no backlinks exist", () => {
    const html = renderToStaticMarkup(
      <Backlinks items={[]} onOpenItem={() => {}} />,
    );
    expect(html).toContain("Belum ada yang menautkan halaman ini.");
  });

  it("renders backlink titles, Indonesian types, and linking-line excerpts", () => {
    const items: Backlink[] = [
      {
        id: "p1",
        type: "page",
        title: "Halaman Penting",
        dueAt: null,
        lastActivityAt: 100,
        excerpt: "Lihat [[Rencana]] untuk langkah berikutnya.",
      },
      {
        id: "j1",
        type: "note",
        title: "Catatan Harian",
        dueAt: null,
        lastActivityAt: 200,
        excerpt: "Hari ini membahas [[Rencana|peluncuran]].",
      },
    ];
    const html = renderToStaticMarkup(
      <Backlinks items={items} onOpenItem={() => {}} />,
    );
    expect(html).toContain("Halaman Penting");
    expect(html).toContain("Catatan halaman");
    expect(html).toContain("Catatan Harian");
    expect(html).toContain("Jurnal");
    expect(html).toContain(items[0].excerpt);
    expect(html).toContain(items[1].excerpt);
  });

  it.each([
    ["task", "Tugas"],
    ["project", "Proyek"],
    ["habit", "Kebiasaan"],
    ["account", "Akun"],
    ["transaction", "Transaksi"],
    ["bill", "Tagihan"],
    ["download", "Unduhan"],
    ["unknown", "Item"],
  ])("labels %s backlinks as %s", (type, label) => {
    const html = renderToStaticMarkup(
      <Backlinks
        items={[{
          id: "source", type, title: "Penaut", dueAt: null,
          lastActivityAt: 100, excerpt: "",
        }]}
        onOpenItem={() => {}}
      />,
    );
    expect(html).toContain(`>${label}</span>`);
  });

  it("renders excerpts as escaped text", () => {
    const html = renderToStaticMarkup(
      <Backlinks
        items={[{
          id: "source", type: "note", title: "Penaut", dueAt: null,
          lastActivityAt: 100, excerpt: '<script>alert("[[Rencana]]")</script>',
        }]}
        onOpenItem={() => {}}
      />,
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("MoveDialog", () => {
  it("renders destinations excluding self and descendants", () => {
    const nodes = [
      { id: "root", title: "Akar Utama", parentId: null, updatedAt: 1 },
      { id: "self", title: "Halaman Saya", parentId: "root", updatedAt: 2 },
      { id: "child", title: "Anak Saya", parentId: "self", updatedAt: 3 },
      { id: "other", title: "Halaman Lain", parentId: null, updatedAt: 4 },
    ];

    const html = renderToStaticMarkup(
      <MoveDialog
        nodes={nodes}
        page={nodes[1]}
        onClose={() => {}}
        onMove={async () => {}}
      />,
    );

    expect(html).toContain("Pindahkan &quot;Halaman Saya&quot;");
    expect(html).toContain("Akar (tanpa induk)");
    expect(html).toContain("Akar Utama");
    expect(html).toContain("Halaman Lain");
    // self and child must be excluded from options
    expect(html).not.toContain('<option value="self">');
    expect(html).not.toContain('<option value="child">');
  });
});

describe("TrashDialog", () => {
  it("renders empty state when trash is empty", () => {
    const html = renderToStaticMarkup(
      <TrashDialog entries={[]} onClose={() => {}} onRestore={async () => {}} />,
    );
    expect(html).toContain("Sampah kosong.");
  });

  it("renders trash entries with subpage counts and restore button", () => {
    const entries = [
      {
        id: "del1",
        title: "Catatan Lama",
        deletedAt: Date.now() - 3600000,
        descendants: 2,
      },
    ];

    const html = renderToStaticMarkup(
      <TrashDialog
        entries={entries}
        onClose={() => {}}
        onRestore={async () => {}}
      />,
    );

    expect(html).toContain("Catatan Lama");
    expect(html).toContain("2 subhalaman");
    expect(html).toContain("Pulihkan");
  });
});
