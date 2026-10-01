import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
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

  it("renders backlink items with titles and types", () => {
    const items = [
      {
        id: "p1",
        type: "page",
        title: "Halaman Penting",
        dueAt: null,
        lastActivityAt: 100,
      },
      {
        id: "j1",
        type: "journal",
        title: "Catatan Harian",
        dueAt: null,
        lastActivityAt: 200,
      },
    ];
    const html = renderToStaticMarkup(
      <Backlinks items={items} onOpenItem={() => {}} />,
    );
    expect(html).toContain("Halaman Penting");
    expect(html).toContain("Halaman");
    expect(html).toContain("Catatan Harian");
    expect(html).toContain("Jurnal");
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
