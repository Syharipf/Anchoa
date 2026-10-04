import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as React from "react";
import type { ComponentProps, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type Entry, type Item, type JournalFilter, type JournalList } from "../api";
import { ToastProvider } from "../shell/toast";
import { deferred, elements, hookHarness } from "../test/hookHarness";
import { EntryEditor } from "./EntryEditor";
import { EntryList } from "./EntryList";
import { JournalPage } from "./JournalPage";
import { TagInput } from "./TagInput";
import { JOURNAL_TEMPLATES } from "./view";
function makeEntry(id = "A"): Entry {
  return {
    id, kind: "note", title: `Entri ${id}`, body: `Isi ${id}`, mood: 4,
    tags: ["kerja"], createdAt: 1, when: "Hari ini", taskId: null, pinned: false,
  };
}

function makeItem(entry: Entry): Item {
  return { ...entry, type: "note", parentId: null, dueAt: null, updatedAt: 1, openedAt: null };
}

function button(node: ReactNode, label: string) {
  const control = elements(node).find((element) => element.type === "button" &&
    (element.props["aria-label"] === label || renderToStaticMarkup(element).includes(`>${label}<`)));
  expect(control).toBeDefined();
  return control!;
}

function click(node: ReactNode, label: string) {
  (button(node, label).props.onClick as () => void)();
}

describe("JournalPage actions and filters", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let entries: Entry[];
  let deleted: Set<string>;
  let spies: { mockRestore: () => void }[];
  const changed = mock(() => {});

  const props = <P,>(type: unknown): P => {
    const element = elements(harness.render()).find((element) => element.type === type);
    expect(element).toBeDefined();
    return element!.props as P;
  };
  const editor = () => props<ComponentProps<typeof EntryEditor>>(EntryEditor);
  const list = () => props<ComponentProps<typeof EntryList>>(EntryList);

  beforeEach(async () => {
    entries = [makeEntry()];
    deleted = new Set();
    changed.mockClear();
    spies = [
      spyOn(api, "journalList").mockImplementation(async (filter: JournalFilter = {}) => {
        const live = entries.filter((entry) => !deleted.has(entry.id) &&
          (!filter.kind || entry.kind === filter.kind) &&
          (!filter.query || entry.title.includes(filter.query)) &&
          (!filter.tag || entry.tags.includes(filter.tag)) &&
          (!filter.mood || entry.mood === filter.mood));
        const groups = [
          { key: "pinned", label: "Disematkan", entries: live.filter((entry) => entry.pinned) },
          { key: "today", label: "Hari ini", entries: live.filter((entry) => !entry.pinned) },
        ].filter((group) => group.entries.length).map((group) => ({
          ...group,
          entries: group.entries.map((entry) => ({ ...entry, preview: entry.body, time: "10.00" })),
        }));
        return { groups };
      }),
      spyOn(api, "journalEntry").mockImplementation(async (id) => {
        if (deleted.has(id)) throw new Error("Entri tidak ditemukan");
        return { ...entries.find((entry) => entry.id === id)! };
      }),
      spyOn(api, "journalSide").mockResolvedValue({ trend: [], writeDays: 0, ideas: [] }),
      spyOn(api, "deleteEntry").mockImplementation(async (id) => { deleted.add(id); }),
      spyOn(api, "restoreEntry").mockImplementation(async (id) => { deleted.delete(id); }),
    ];
    let showToast: unknown;
    harness = hookHarness(() => {
      const provider = ToastProvider({ children: null });
      showToast = provider.props.value;
      const page = JournalPage({ onOpenItem: () => {}, onOpenAssistant: () => {}, onChanged: changed });
      return React.cloneElement(provider, {}, page, provider.props.children[1]);
    });
    spies.push(spyOn(React, "useContext").mockImplementation((() => showToast) as typeof React.useContext));
    harness.render();
    await harness.settle();
  });

  afterEach(() => {
    harness?.dispose();
    spies.forEach((spy) => spy.mockRestore());
  });

  it("deletes the selected entry, closes its editor and offers Urungkan", async () => {
    await editor().onDelete("A");
    await harness.settle();
    expect(api.deleteEntry).toHaveBeenCalledWith("A");
    expect(list().groups).toEqual([]);
    expect(elements(harness.render()).some((element) => element.type === EntryEditor)).toBe(false);
    expect(elements(harness.render()).some((element) =>
      Array.isArray(element.props.children) && element.props.children.includes("Entri dihapus"))).toBe(true);
    expect(button(harness.render(), "Urungkan")).toBeDefined();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("restores the entry and reloads the list when Urungkan is clicked", async () => {
    await editor().onDelete("A");
    await harness.settle();
    const beforeUndo = spyOn(api, "journalList").mock.calls.length;
    click(harness.render(), "Urungkan");
    await harness.settle();
    expect(api.restoreEntry).toHaveBeenCalledWith("A");
    expect(api.journalList).toHaveBeenCalledTimes(beforeUndo + 1);
    expect(list().groups[0].entries[0].id).toBe("A");
    expect(editor().entry.id).toBe("A");
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("uses the current filters when an older toast restores an entry", async () => {
    const oldEditor = editor();
    await oldEditor.onDelete("A");
    await harness.settle();
    oldEditor.onTagClick("kerja");
    await harness.settle();
    click(harness.render(), "Urungkan");
    await harness.settle();
    expect(api.journalList).toHaveBeenLastCalledWith({ tag: "kerja" });
  });

  it("keeps a restored entry outside the active filter out of the editor", async () => {
    await editor().onDelete("A");
    await harness.settle();
    list().onFilterChange({ mood: 1 });
    await harness.settle();
    click(harness.render(), "Urungkan");
    await harness.settle();
    expect(api.restoreEntry).toHaveBeenCalledWith("A");
    expect(list().groups).toEqual([]);
    expect(elements(harness.render()).some((element) => element.type === EntryEditor)).toBe(false);
  });

  it("combines tag, mood, kind and query, and removes only the chosen filter", async () => {
    list().onFilterChange({ query: "Entri", kind: "note", mood: 4 });
    await harness.settle();
    editor().onTagClick("kerja");
    await harness.settle();
    expect(api.journalList).toHaveBeenLastCalledWith({ query: "Entri", kind: "note", mood: 4, tag: "kerja" });
    expect(list().filter.tag).toBe("kerja");
    list().onFilterChange({ tag: undefined });
    await harness.settle();
    expect(api.journalList).toHaveBeenLastCalledWith({ query: "Entri", kind: "note", mood: 4, tag: undefined });
  });

  it("drops filters that would hide a new entry and opens it", async () => {
    spies.push(spyOn(api, "createEntry").mockImplementation(async (kind) => {
      const created: Entry = { ...makeEntry("B"), kind, title: "", mood: null, tags: [] };
      entries.push(created);
      return created;
    }));
    list().onFilterChange({ query: "Entri", kind: "note", mood: 4, tag: "kerja" });
    await harness.settle();
    click(harness.render(), "Tulis");
    await harness.settle();
    expect(api.createEntry).toHaveBeenCalledWith("note", "");
    expect(list().filter).toEqual({ kind: "note" });
    expect(api.journalList).toHaveBeenLastCalledWith({ kind: "note" });
    expect(editor().entry.id).toBe("B");
    expect(list().groups.flatMap((group) => group.entries).some((entry) => entry.id === "B")).toBe(true);
  });

  it("opens template dropdown and creates an entry with template title and body", async () => {
    spies.push(spyOn(api, "createEntry").mockImplementation(async (kind, title) => {
      const created: Entry = { ...makeEntry("T1"), kind, title: title ?? "", mood: null, tags: [] };
      entries.push(created);
      return created;
    }));
    spies.push(spyOn(api, "updateItem").mockImplementation(async (id, patch) => {
      const entry = entries.find((e) => e.id === id);
      if (entry && patch.body !== undefined) {
        entry.body = patch.body;
      }
      return makeItem(entry ?? makeEntry(id));
    }));

    // Menu is initially closed
    expect(elements(harness.render()).some((el) => el.type === "button" && renderToStaticMarkup(el).includes(">Refleksi harian<"))).toBe(false);

    // Open dropdown menu
    click(harness.render(), "Entri baru ▾");
    await harness.settle();

    // Dropdown contains all 4 templates and Entri kosong
    expect(elements(harness.render()).some((el) => el.type === "button" && renderToStaticMarkup(el).includes(">Refleksi harian<"))).toBe(true);
    expect(elements(harness.render()).some((el) => el.type === "button" && renderToStaticMarkup(el).includes(">3 hal yang disyukuri<"))).toBe(true);
    expect(elements(harness.render()).some((el) => el.type === "button" && renderToStaticMarkup(el).includes(">Review mingguan<"))).toBe(true);
    expect(elements(harness.render()).some((el) => el.type === "button" && renderToStaticMarkup(el).includes(">Curhat terarah<"))).toBe(true);
    expect(elements(harness.render()).some((el) => el.type === "button" && renderToStaticMarkup(el).includes(">Entri kosong<"))).toBe(true);

    // Select "Refleksi harian" template
    click(harness.render(), "Refleksi harian");
    await harness.settle();

    expect(api.createEntry).toHaveBeenCalledWith("note", "Refleksi harian");
    expect(api.updateItem).toHaveBeenCalledWith("T1", {
      body: JOURNAL_TEMPLATES[0].body,
    });
    expect(editor().entry.id).toBe("T1");
    expect(editor().entry.title).toBe("Refleksi harian");
    expect(editor().entry.body).toBe(JOURNAL_TEMPLATES[0].body);

    // Dropdown is closed after selecting template
    expect(elements(harness.render()).some((el) => el.type === "button" && renderToStaticMarkup(el).includes(">Refleksi harian<"))).toBe(false);
  });

  it("creates a vent entry when Curhat terarah template is chosen", async () => {
    spies.push(spyOn(api, "createEntry").mockImplementation(async (kind, title) => {
      const created: Entry = { ...makeEntry("V1"), kind, title: title ?? "", mood: null, tags: [] };
      entries.push(created);
      return created;
    }));
    spies.push(spyOn(api, "updateItem").mockImplementation(async (id, patch) => {
      const entry = entries.find((e) => e.id === id);
      if (entry && patch.body !== undefined) {
        entry.body = patch.body;
      }
      return makeItem(entry ?? makeEntry(id));
    }));

    click(harness.render(), "Entri baru ▾");
    await harness.settle();

    click(harness.render(), "Curhat terarah");
    await harness.settle();

    const ventTemplate = JOURNAL_TEMPLATES.find((t) => t.id === "guided-vent")!;
    expect(api.createEntry).toHaveBeenCalledWith("vent", "Curhat terarah");
    expect(api.updateItem).toHaveBeenCalledWith("V1", { body: ventTemplate.body });
    expect(editor().entry.id).toBe("V1");
    expect(editor().entry.kind).toBe("vent");
    expect(editor().entry.body).toBe(ventTemplate.body);
  });

  it("creates blank entry when Entri kosong is clicked in dropdown", async () => {
    spies.push(spyOn(api, "createEntry").mockImplementation(async (kind) => {
      const created: Entry = { ...makeEntry("B2"), kind, title: "", mood: null, tags: [] };
      entries.push(created);
      return created;
    }));

    click(harness.render(), "Entri baru ▾");
    await harness.settle();

    click(harness.render(), "Entri kosong");
    await harness.settle();

    expect(api.createEntry).toHaveBeenCalledWith("note", "");
    expect(editor().entry.id).toBe("B2");
    expect(elements(harness.render()).some((el) => el.type === "button" && renderToStaticMarkup(el).includes(">Entri kosong<"))).toBe(false);
  });

  it("toggles and closes dropdown menu via Escape key", async () => {
    click(harness.render(), "Entri baru ▾");
    await harness.settle();

    const menuEl = elements(harness.render()).find((el) => el.props.role === "menu");
    expect(menuEl).toBeDefined();

    // Press Escape
    (menuEl!.props.onKeyDown as (e: { key: string }) => void)({ key: "Escape" });
    await harness.settle();

    expect(elements(harness.render()).some((el) => el.props.role === "menu")).toBe(false);
  });

  it("passes mood filtering to the backend", async () => {
    list().onFilterChange({ mood: 4 });
    await harness.settle();
    expect(api.journalList).toHaveBeenLastCalledWith({ mood: 4 });
    expect(list().filter.mood).toBe(4);
  });

  it("keeps the editor open, shows a delete error, and allows retry when api.deleteEntry rejects", async () => {
    spyOn(api, "deleteEntry").mockRejectedValueOnce(new Error("Hapus gagal"));
    const result = await editor().onDelete("A");
    await harness.settle();
    expect(result).toBe(false);
    expect(editor().entry.id).toBe("A");
    expect(elements(harness.render()).some((element) =>
      Array.isArray(element.props.children) && element.props.children.includes("Hapus gagal"))).toBe(true);
    expect(elements(harness.render()).some((element) => element.props.children === "Urungkan")).toBe(false);

    // Retrying deletion succeeds
    const retried = await editor().onDelete("A");
    await harness.settle();
    expect(retried).toBe(true);
    expect(api.deleteEntry).toHaveBeenCalledTimes(2);
    expect(elements(harness.render()).some((element) => element.type === EntryEditor)).toBe(false);
    expect(button(harness.render(), "Urungkan")).toBeDefined();
  });

  it("shows restore errors without reopening a deleted entry", async () => {
    await editor().onDelete("A");
    await harness.settle();
    spyOn(api, "restoreEntry").mockRejectedValueOnce(new Error("Pulihkan gagal"));
    click(harness.render(), "Urungkan");
    await harness.settle();
    expect(elements(harness.render()).some((element) => element.type === EntryEditor)).toBe(false);
    expect(elements(harness.render()).some((element) =>
      Array.isArray(element.props.children) && element.props.children.includes("Pulihkan gagal"))).toBe(true);
  });

  it("ignores an older list response that still contains the deleted selection", async () => {
    const stale = deferred<JournalList>();
    const snapshot = { groups: list().groups } as JournalList;
    spyOn(api, "journalList").mockImplementationOnce(() => stale.promise);
    editor().onAfterSaved!();
    await editor().onDelete("A");
    await harness.settle();
    stale.resolve(snapshot);
    await harness.settle();
    expect(list().groups).toEqual([]);
    expect(elements(harness.render()).some((element) => element.type === EntryEditor)).toBe(false);
    expect(api.journalEntry).toHaveBeenCalledTimes(1);
  });

  it("clears a stale editor as soon as another selection starts loading", async () => {
    entries.push(makeEntry("B"));
    editor().onAfterSaved!();
    await harness.settle();
    const opening = deferred<Entry>();
    spyOn(api, "journalEntry").mockImplementationOnce(() => opening.promise);
    list().onSelect("B");
    await harness.settle();
    expect(elements(harness.render()).some((element) => element.type === EntryEditor)).toBe(false);
    opening.resolve(entries[1]);
    await harness.settle();
    expect(editor().entry.id).toBe("B");
  });

  it("preserves a new selection while an older entry is being deleted", async () => {
    entries.push(makeEntry("B"));
    const oldEditor = editor();
    oldEditor.onAfterSaved!();
    await harness.settle();
    const deleting = deferred<void>();
    spyOn(api, "deleteEntry").mockImplementationOnce(async (id) => {
      await deleting.promise;
      deleted.add(id);
    });
    const deletion = oldEditor.onDelete("A");
    list().onSelect("B");
    await harness.settle();
    expect(editor().entry.id).toBe("B");
    deleting.resolve();
    await deletion;
    await harness.settle();
    expect(editor().entry.id).toBe("B");
    oldEditor.onEntryChanged(makeEntry());
    await harness.settle();
    expect(editor().entry.id).toBe("B");
  });

  it("ignores list responses for filters that have already changed", async () => {
    const stale = deferred<JournalList>();
    const snapshot = { groups: list().groups } as JournalList;
    spyOn(api, "journalList").mockImplementationOnce(() => stale.promise);
    list().onFilterChange({ tag: "kerja" });
    await harness.settle();
    list().onFilterChange({ mood: 1 });
    await harness.settle();
    stale.resolve(snapshot);
    await harness.settle();
    expect(list().filter).toEqual({ tag: "kerja", mood: 1 });
    expect(list().groups).toEqual([]);
    expect(elements(harness.render()).some((element) => element.type === EntryEditor)).toBe(false);
  });

  it("does not reopen the deleted editor if reloading the list fails", async () => {
    spyOn(api, "journalList").mockRejectedValueOnce(new Error("Muat gagal"));
    await editor().onDelete("A");
    await harness.settle();
    expect(elements(harness.render()).some((element) => element.type === EntryEditor)).toBe(false);
    expect(list().groups.flatMap((group) => group.entries)).toEqual([]);
    click(harness.render(), "Urungkan");
    await harness.settle();
    expect(editor().entry.id).toBe("A");
  });
});

describe("EntryEditor pinning and safe deletion", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let entry: Entry;
  let spies: { mockRestore: () => void }[];
  let calls: string[];
  const afterSaved = mock(() => {});
  const onDelete = mock(async (id: string): Promise<boolean | void> => { calls.push(`delete:${id}`); });

  function edit(value: string) {
    const textarea = elements(harness.render()).find((element) => element.props["aria-label"] === "Isi entri")!;
    (textarea.props.onChange as (event: unknown) => void)({ target: { value } });
  }

  function blur() {
    const textarea = elements(harness.render()).find((element) => element.props["aria-label"] === "Isi entri")!;
    (textarea.props.onBlur as () => void)();
  }

  beforeEach(() => {
    entry = makeEntry();
    calls = [];
    afterSaved.mockClear();
    onDelete.mockClear();
    spies = [
      spyOn(api, "updateItem").mockImplementation(async (id, patch) => {
        calls.push(`save:${id}:${patch.body}`);
        return { ...makeItem(entry), id, ...patch };
      }),
      spyOn(api, "updateEntry").mockImplementation(async (_id, patch) => {
        entry = { ...entry, pinned: patch.pinned ?? entry.pinned };
        return entry;
      }),
    ];
    harness = hookHarness(() => EntryEditor({
      entry, onEntryChanged: (updated) => { entry = updated; }, onOpenTask: () => {},
      onAfterSaved: afterSaved, onOpenAssistant: () => {}, onDelete, onTagClick: () => {},
    }));
    harness.render();
  });

  afterEach(() => {
    harness.dispose();
    spies.forEach((spy) => spy.mockRestore());
  });

  it("pins and unpins with the correct label and pressed state", async () => {
    expect(button(harness.render(), "Sematkan").props["aria-pressed"]).toBe(false);
    click(harness.render(), "Sematkan");
    await harness.settle();
    expect(api.updateEntry).toHaveBeenCalledWith("A", { pinned: true });
    expect(button(harness.render(), "Lepas sematan").props["aria-pressed"]).toBe(true);
    click(harness.render(), "Lepas sematan");
    await harness.settle();
    expect(api.updateEntry).toHaveBeenLastCalledWith("A", { pinned: false });
  });

  it("flushes pending edits before Hapus entri and never saves after deletion", async () => {
    edit("Sebelum hapus");
    click(harness.render(), "Hapus entri");
    await harness.settle();
    expect(calls).toEqual(["save:A:Sebelum hapus", "delete:A"]);
    harness.runTimers();
    harness.dispose();
    await harness.settle();
    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("waits for an in-flight autosave and drains newer edits before deletion", async () => {
    const saving = deferred<Item>();
    spyOn(api, "updateItem").mockImplementationOnce(() => saving.promise);
    edit("Pertama");
    blur();
    edit("Terbaru");
    click(harness.render(), "Hapus entri");
    await harness.settle();
    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    expect(button(harness.render(), "Hapus entri").props.disabled).toBe(true);
    saving.resolve(makeItem(entry));
    await harness.settle();
    expect(api.updateItem).toHaveBeenLastCalledWith("A", { body: "Terbaru" });
    expect(calls).toEqual(["save:A:Terbaru", "delete:A"]);
  });

  it("keeps unsaved text and allows retry when saving before deletion fails", async () => {
    spyOn(api, "updateItem").mockRejectedValueOnce(new Error("Simpan gagal"));
    edit("Jangan hilang");
    click(harness.render(), "Hapus entri");
    await harness.settle();
    expect(onDelete).not.toHaveBeenCalled();
    expect(button(harness.render(), "Hapus entri").props.disabled).toBe(false);
    click(harness.render(), "Hapus entri");
    await harness.settle();
    expect(api.updateItem).toHaveBeenLastCalledWith("A", { body: "Jangan hilang" });
    expect(onDelete).toHaveBeenCalledWith("A");
  });

  it("blocks duplicate deletes and late edits while deletion is pending", async () => {
    const deleting = deferred<void>();
    onDelete.mockImplementationOnce(() => deleting.promise);
    click(harness.render(), "Hapus entri");
    await harness.settle();
    click(harness.render(), "Hapus entri");
    edit("Terlambat");
    harness.runTimers();
    await harness.settle();
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(api.updateItem).not.toHaveBeenCalled();
    deleting.resolve();
    await harness.settle();
  });

  it("re-enables controls and allows retry when onDelete returns false or rejects", async () => {
    onDelete.mockResolvedValueOnce(false);
    click(harness.render(), "Hapus entri");
    await harness.settle();
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(button(harness.render(), "Hapus entri").props.disabled).toBe(false);
    expect(elements(harness.render()).find((el) => el.props["aria-label"] === "Isi entri")!.props.disabled).toBe(false);

    onDelete.mockRejectedValueOnce(new Error("Gagal"));
    click(harness.render(), "Hapus entri");
    await harness.settle();
    expect(onDelete).toHaveBeenCalledTimes(2);
    expect(button(harness.render(), "Hapus entri").props.disabled).toBe(false);
    expect(elements(harness.render()).find((el) => el.props["aria-label"] === "Isi entri")!.props.disabled).toBe(false);

    // Retrying delete succeeds and keeps controls disabled
    onDelete.mockResolvedValueOnce(true);
    click(harness.render(), "Hapus entri");
    await harness.settle();
    expect(button(harness.render(), "Hapus entri").props.disabled).toBe(true);
    expect(elements(harness.render()).find((el) => el.props["aria-label"] === "Isi entri")!.props.disabled).toBe(true);
  });

  it("keeps deleting disabled until unmount when deletion succeeds", async () => {
    click(harness.render(), "Hapus entri");
    await harness.settle();
    expect(onDelete).toHaveBeenCalledWith("A");
    expect(button(harness.render(), "Hapus entri").props.disabled).toBe(true);
    edit("Jangan disimpan setelah terhapus");
    harness.runTimers();
    expect(api.updateItem).not.toHaveBeenCalled();
  });

  it("re-enables controls and allows retry when api.deleteEntry rejects", async () => {
    spies.push(spyOn(api, "deleteEntry").mockRejectedValueOnce(new Error("Hapus gagal")).mockResolvedValue(undefined));
    onDelete.mockImplementation(async (id: string) => {
      try {
        await api.deleteEntry(id);
        return true;
      } catch {
        return false;
      }
    });
    click(harness.render(), "Hapus entri");
    await harness.settle();
    expect(api.deleteEntry).toHaveBeenCalledTimes(1);
    expect(button(harness.render(), "Hapus entri").props.disabled).toBe(false);
    expect(elements(harness.render()).find((el) => el.props["aria-label"] === "Isi entri")!.props.disabled).toBe(false);

    // Retrying delete succeeds
    click(harness.render(), "Hapus entri");
    await harness.settle();
    expect(api.deleteEntry).toHaveBeenCalledTimes(2);
    expect(button(harness.render(), "Hapus entri").props.disabled).toBe(true);
  });
});

describe("EntryList chips and tag buttons", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  afterEach(() => harness?.dispose());

  it("renders the pinned group and removable tag and mood chips", () => {
    const onFilterChange = mock(() => {});
    const entry = makeEntry();
    const html = renderToStaticMarkup(
      <ToastProvider>
        <EntryList groups={[{ key: "pinned", label: "Disematkan", entries: [{ ...entry, preview: entry.body, time: "10.00" }] }]}
          selectedId="A" onSelect={() => {}} filter={{ tag: "kerja", mood: 4 }} onFilterChange={onFilterChange} />
      </ToastProvider>,
    );
    expect(html).toContain("Disematkan");
    expect(html).toContain("#kerja");
    expect(html).toContain("Suasana 4");
    expect(html).toContain("×");
    harness = hookHarness(() => EntryList({
      groups: [], selectedId: null, onSelect: () => {}, filter: { tag: "kerja", mood: 4 }, onFilterChange,
    }));
    click(harness.render(), "Hapus saringan tag kerja");
    expect(onFilterChange).toHaveBeenLastCalledWith({ tag: undefined });
    click(harness.render(), "Hapus saringan suasana hati");
    expect(onFilterChange).toHaveBeenLastCalledWith({ mood: undefined });
  });

  it("renders five mood filter buttons and toggles the selected mood", () => {
    const onFilterChange = mock(() => {});
    harness = hookHarness(() => EntryList({
      groups: [], selectedId: null, onSelect: () => {}, filter: { mood: 4 }, onFilterChange,
    }));
    const fieldset = elements(harness.render()).find((element) => element.type === "fieldset" &&
      renderToStaticMarkup(element).includes("Saring suasana hati"))!;
    expect(elements(fieldset).filter((element) => element.type === "button")).toHaveLength(5);
    expect(button(fieldset, "Baik").props["aria-pressed"]).toBe(true);
    click(fieldset, "Senang");
    expect(onFilterChange).toHaveBeenLastCalledWith({ mood: 5 });
    click(fieldset, "Baik");
    expect(onFilterChange).toHaveBeenLastCalledWith({ mood: undefined });
  });

  it("shows the filtered empty message for each active filter", () => {
    for (const filter of [{ query: "cari" }, { kind: "idea" as const }, { tag: "kerja" }, { mood: 4 }]) {
      const html = renderToStaticMarkup(<ToastProvider><EntryList groups={[]} selectedId={null}
        onSelect={() => {}} filter={filter} onFilterChange={() => {}} /></ToastProvider>);
      expect(html).toContain("Tidak ada entri yang cocok dengan saringan.");
    }
  });

  it("filters by clicking a tag without removing it", () => {
    const onTagClick = mock(() => {});
    const onChange = mock(() => {});
    harness = hookHarness(() => TagInput({ tags: ["kerja"], onChange, onTagClick }));
    click(harness.render(), "#kerja");
    expect(onTagClick).toHaveBeenCalledWith("kerja");
    expect(onChange).not.toHaveBeenCalled();
    click(harness.render(), "Hapus tag kerja");
    expect(onChange).toHaveBeenCalledWith([]);
    expect(onTagClick).toHaveBeenCalledTimes(1);
  });
});
