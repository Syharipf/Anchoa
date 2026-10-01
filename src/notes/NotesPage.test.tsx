import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type Backlink, type Item, type PageNode } from "../api";
import { relativeTime } from "../format";
import { deferred, elements, hookHarness } from "../test/hookHarness";
import { BlockEditor } from "./BlockEditor";
import { NotesPage } from "./NotesPage";
import { Backlinks } from "./Backlinks";
import { MoveDialog } from "./MoveDialog";
import { PageTree } from "./PageTree";
import { TrashDialog } from "./TrashDialog";
import { buildTree } from "./view";

describe("NotesPage editing", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let items: Item[];
  let nodes: PageNode[];
  let calls: string[];
  let spies: { mockRestore: () => void }[];
  const changed = mock(() => {});
  const props = <P,>(type: unknown): P => {
    const element = elements(harness.render()).find((element) => element.type === type);
    expect(element).toBeDefined();
    return element!.props as P;
  };
  const editor = () => props<ComponentProps<typeof BlockEditor>>(BlockEditor);
  const tree = () => props<ComponentProps<typeof PageTree>>(PageTree);
  const button = (text: string) => elements(harness.render()).find((element) =>
    element.type === "button" && elements(element.props.children as ReactNode).length === 0 &&
    element.props.children === text,
  );
  const exportPage = () => {
    const element = elements(harness.render()).find((element) => element.type === "button" &&
      Array.isArray(element.props.children) && element.props.children.includes("Ekspor Markdown"));
    (element!.props.onClick as () => void)();
  };

  beforeEach(async () => {
    calls = [];
    changed.mockClear();
    items = ["A", "B"].map((id, index) => ({
      id, type: "page", title: id, body: id === "A" ? "Lihat [[B]]." : "Isi B",
      parentId: null, dueAt: null, createdAt: 1, updatedAt: index + 1, openedAt: null,
    }));
    nodes = items.map(({ id, title, updatedAt }) => ({ id, title, updatedAt, parentId: null }));
    spies = [
      spyOn(api, "pagesTree").mockImplementation(async () => nodes.map((node) => ({ ...node }))),
      spyOn(api, "pagesTrash").mockResolvedValue([]),
      spyOn(api, "pageBacklinks").mockResolvedValue([]),
      spyOn(api, "openItem").mockImplementation(async (id) => ({ ...items.find((item) => item.id === id)! })),
      spyOn(api, "savePageBody").mockImplementation(async (id, body) => {
        calls.push(`save:${id}:${body}`);
        const item = items.find((item) => item.id === id)!;
        item.body = body;
        item.updatedAt = Date.now();
        nodes.find((node) => node.id === id)!.updatedAt = item.updatedAt;
      }),
      spyOn(api, "deletePage").mockImplementation(async (id) => { calls.push(`delete:${id}`); }),
      spyOn(api, "exportPages").mockImplementation(async () => { calls.push("export"); return "/export"; }),
      spyOn(api, "renamePage").mockImplementation(async (id, title) => {
        calls.push(`rename:${id}`);
        const item = items.find((item) => item.id === id)!;
        const oldTitle = item.title;
        item.title = title;
        nodes.find((node) => node.id === id)!.title = title;
        for (const source of items) source.body = source.body.replaceAll(`[[${oldTitle}]]`, `[[${title}]]`);
        return { ...nodes.find((node) => node.id === id)! };
      }),
    ];
    harness = hookHarness(() => NotesPage({ initialId: "A", onOpenItem: () => {}, onChanged: changed }));
    harness.render();
    await harness.settle();
  });

  afterEach(() => {
    harness.dispose();
    spies.forEach((spy) => spy.mockRestore());
  });

  it("saves late edits from A to A after navigation to B starts", async () => {
    const oldEditor = editor();
    const openingB = deferred<Item>();
    spyOn(api, "openItem").mockImplementation(async (id) => id === "B" ? openingB.promise : { ...items[0] });
    tree().onSelect("B");
    oldEditor.onChange("Late edit on A");
    await harness.settle();
    openingB.resolve(items[1]);
    await harness.settle();
    expect(editor().pageId).toBe("B");
    harness.runTimers();
    await harness.settle();
    expect(api.savePageBody).toHaveBeenCalledWith("A", "Late edit on A");
    expect(items[1].body).toBe("Isi B");
  });

  it("retries unsaved text on the next flush after a save fails", async () => {
    spyOn(api, "savePageBody").mockRejectedValueOnce(new Error("Save failed"));
    editor().onChange("Unsaved text");
    harness.blur();
    await harness.settle();
    harness.blur();
    await harness.settle();
    expect(api.savePageBody).toHaveBeenCalledTimes(2);
    expect(api.savePageBody).toHaveBeenLastCalledWith("A", "Unsaved text");
  });

  it("keeps a newer edit when an older save fails", async () => {
    const save = deferred<void>();
    spyOn(api, "savePageBody").mockImplementationOnce(() => save.promise);
    editor().onChange("Old edit");
    harness.blur();
    editor().onChange("New edit");
    save.reject(new Error("Save failed"));
    await harness.settle();
    harness.blur();
    await harness.settle();
    expect(api.savePageBody).toHaveBeenLastCalledWith("A", "New edit");
  });

  it("serializes flushes and saves newer text before export proceeds", async () => {
    const save = deferred<void>();
    spyOn(api, "savePageBody").mockImplementationOnce(() => save.promise);
    editor().onChange("First edit");
    harness.blur();
    editor().onChange("Latest edit");
    exportPage();
    await harness.settle();
    expect(api.savePageBody).toHaveBeenCalledTimes(1);
    expect(api.exportPages).not.toHaveBeenCalled();
    save.resolve();
    await harness.settle();
    expect(api.savePageBody).toHaveBeenLastCalledWith("A", "Latest edit");
    expect(calls).toEqual(["save:A:Latest edit", "export"]);
  });

  it("keeps edits for both pages when B is edited before A's autosave", async () => {
    const oldEditor = editor();
    tree().onSelect("B");
    oldEditor.onChange("Late A");
    await harness.settle();
    editor().onChange("New B");
    harness.blur();
    await harness.settle();
    expect(api.savePageBody).toHaveBeenCalledWith("A", "Late A");
    expect(api.savePageBody).toHaveBeenCalledWith("B", "New B");
  });

  it("leaves delete and export pending when their save fails", async () => {
    spyOn(api, "savePageBody").mockRejectedValue(new Error("Save failed"));
    editor().onChange("Keep this text");
    tree().onStartDelete(nodes[0]);
    (button("Hapus")!.props.onClick as () => void)();
    await harness.settle();
    expect(api.deletePage).not.toHaveBeenCalled();
    exportPage();
    await harness.settle();
    expect(api.exportPages).not.toHaveBeenCalled();
    expect(api.savePageBody).toHaveBeenLastCalledWith("A", "Keep this text");
  });

  it("waits for pending text to save before deleting the page", async () => {
    const save = deferred<void>();
    spyOn(api, "savePageBody").mockImplementationOnce(() => save.promise);
    editor().onChange("Before trash");
    tree().onStartDelete(nodes[0]);
    (button("Hapus")!.props.onClick as () => void)();
    await harness.settle();
    expect(api.savePageBody).toHaveBeenCalledWith("A", "Before trash");
    expect(api.deletePage).not.toHaveBeenCalled();
    save.resolve();
    await harness.settle();
    expect(api.deletePage).toHaveBeenCalledWith("A");
  });

  it("waits for pending text to save before exporting", async () => {
    const save = deferred<void>();
    spyOn(api, "savePageBody").mockImplementationOnce(() => save.promise);
    editor().onChange("Before export");
    exportPage();
    await harness.settle();
    expect(api.savePageBody).toHaveBeenCalledWith("A", "Before export");
    expect(api.exportPages).not.toHaveBeenCalled();
    save.resolve();
    await harness.settle();
    expect(api.exportPages).toHaveBeenCalledTimes(1);
  });

  it("flushes before tree rename and remounts A with the rewritten links", async () => {
    editor().onChange("Updated [[B]].");
    const oldKey = elements(harness.render()).find((element) => element.type === BlockEditor)!.key;
    tree().onRename!("B", "Renamed B");
    await harness.settle();
    expect(calls.slice(0, 2)).toEqual(["save:A:Updated [[B]].", "rename:B"]);
    expect(editor().body).toBe("Updated [[Renamed B]].");
    expect(elements(harness.render()).find((element) => element.type === BlockEditor)!.key).not.toBe(oldKey);
    editor().onChange(`${editor().body} More text.`);
    harness.blur();
    await harness.settle();
    expect(items[0].body).toBe("Updated [[Renamed B]]. More text.");
  });

  it("flushes before renaming from the title header", async () => {
    editor().onChange("Before title rename");
    const titleInput = () => elements(harness.render()).find((element) => element.props["aria-label"] === "Judul halaman")!;
    (titleInput().props.onChange as (event: unknown) => void)({ target: { value: "Renamed A" } });
    (titleInput().props.onBlur as () => void)();
    await harness.settle();
    expect(calls.slice(0, 2)).toEqual(["save:A:Before title rename", "rename:A"]);
    expect(titleInput().props.value).toBe("Renamed A");
  });

  it("updates the loaded and tree timestamps after saving without remounting the editor", async () => {
    const oldKey = elements(harness.render()).find((element) => element.type === BlockEditor)!.key;
    editor().onChange("New body");
    harness.blur();
    await harness.settle();
    const timestamp = elements(harness.render()).find((element) => element.type === "div" &&
      Array.isArray(element.props.children) && element.props.children[0] === "Diperbarui ");
    expect(timestamp!.props.children).toEqual(["Diperbarui ", relativeTime(items[0].updatedAt, Date.now())]);
    expect(tree().tree.find((node) => node.id === "A")!.updatedAt).toBe(items[0].updatedAt);
    expect(elements(harness.render()).find((element) => element.type === BlockEditor)!.key).toBe(oldKey);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

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
