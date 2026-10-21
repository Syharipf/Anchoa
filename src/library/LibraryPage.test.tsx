import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type LibraryList, type MediaRow } from "../api";
import { elements, hookHarness } from "../test/hookHarness";
import { LibraryPage } from "./LibraryPage";
import { MediaDialog } from "./MediaDialog";

const sampleMedia: MediaRow = {
  id: "med-1",
  title: "Severance",
  body: "Office sci-fi horror",
  kind: "series",
  status: "active",
  progress: 6,
  progressTotal: 10,
  rating: 5,
  startedAt: 100,
  finishedAt: null,
  year: 2022,
  creator: "Dan Erickson",
  tags: "sci-fi, thriller",
};

const sampleList: LibraryList = {
  items: [sampleMedia],
  counts: { all: 1, want: 0, active: 1, finished: 0, dropped: 0 },
};

describe("LibraryPage", () => {
  let originalLibraryList: typeof api.libraryList;
  let originalSaveMedia: typeof api.saveMedia;
  let originalDeleteMedia: typeof api.deleteMedia;
  let originalRestoreMedia: typeof api.restoreMedia;

  beforeEach(() => {
    originalLibraryList = api.libraryList;
    originalSaveMedia = api.saveMedia;
    originalDeleteMedia = api.deleteMedia;
    originalRestoreMedia = api.restoreMedia;
  });

  afterEach(() => {
    api.libraryList = originalLibraryList;
    api.saveMedia = originalSaveMedia;
    api.deleteMedia = originalDeleteMedia;
    api.restoreMedia = originalRestoreMedia;
  });

  it("renders list and status chips", async () => {
    const listMock = mock(() => Promise.resolve(sampleList));
    api.libraryList = listMock;

    const harness = hookHarness(() => LibraryPage({}));
    const initial = harness.render();
    expect(renderToStaticMarkup(initial)).toContain("Library");

    await harness.settle();
    const rendered = harness.render();
    const html = renderToStaticMarkup(rendered);

    expect(html).toContain("Severance");
    expect(html).toContain("Dan Erickson · 2022");
    expect(html).toContain("6 / 10 eps");
    expect(listMock).toHaveBeenCalled();
    harness.dispose();
  });

  it("filtering by status calls libraryList with status", async () => {
    const listMock = mock((filter: { status?: string }) => {
      if (filter.status === "want") {
        return Promise.resolve({
          items: [],
          counts: { all: 1, want: 0, active: 1, finished: 0, dropped: 0 },
        });
      }
      return Promise.resolve(sampleList);
    });
    api.libraryList = listMock as unknown as typeof api.libraryList;

    const harness = hookHarness(() => LibraryPage({}));
    await harness.settle();

    const rendered = harness.render();
    const allButtons = elements(rendered).filter((el) => el.type === "button");
    const wantButton = allButtons.find((el) => {
      const children = Array.isArray(el.props.children) ? el.props.children : [el.props.children];
      return children.some((c: unknown) => {
        if (c && typeof c === "object" && "props" in c) {
          const props = c.props;
          if (props && typeof props === "object" && "children" in props) {
            return props.children === "Want";
          }
        }
        return false;
      });
    });

    expect(wantButton).toBeDefined();
    (wantButton!.props.onClick as () => void)();

    await harness.settle();
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ status: "want" }));
    harness.dispose();
  });

  it("opens edit dialog when initialId is provided", async () => {
    api.libraryList = mock(() => Promise.resolve(sampleList));

    const harness = hookHarness(() => LibraryPage({ initialId: "med-1" }));
    await harness.settle();

    const rendered = harness.render();
    const html = renderToStaticMarkup(rendered);
    expect(html).toContain("Edit media");
    harness.dispose();
  });

  it("clicking + Add opens dialog and save calls saveMedia", async () => {
    api.libraryList = mock(() => Promise.resolve(sampleList));
    const saveMock = mock(() => Promise.resolve(sampleMedia));
    api.saveMedia = saveMock as unknown as typeof api.saveMedia;

    const harness = hookHarness(() => LibraryPage({}));
    await harness.settle();

    const rendered = harness.render();
    const addBtn = elements(rendered).find(
      (el) => el.type === "button" && el.props.children === "+ Add",
    );
    expect(addBtn).toBeDefined();
    (addBtn!.props.onClick as () => void)();

    const dialogRendered = harness.render();
    const dialogEl = elements(dialogRendered).find((el) => el.type === MediaDialog);
    expect(dialogEl).toBeDefined();
    const dialogContent = elements(MediaDialog(dialogEl!.props as Parameters<typeof MediaDialog>[0]));

    const form = dialogContent.find((el) => el.type === "form");
    expect(form).toBeDefined();
    await (form!.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });

    // Title was empty, so save is not called yet
    expect(saveMock).not.toHaveBeenCalled();

    const titleInput = dialogContent.find(
      (el) => el.type === "input" && el.props.placeholder === "Title",
    );
    expect(titleInput).toBeDefined();
    (titleInput!.props.onChange as (e: unknown) => void)({ target: { value: "New Movie" } });

    // Save directly using onSave on the dialog props
    await (dialogEl!.props.onSave as (input: unknown) => Promise<void>)({
      title: "New Movie",
      body: "",
      kind: "film",
      status: "want",
      creator: "",
      tags: "",
    });
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New Movie",
        kind: "film",
      }),
    );
    harness.dispose();
  });

  it("delete calls deleteMedia and Undo calls restoreMedia", async () => {
    api.libraryList = mock(() => Promise.resolve(sampleList));
    const deleteMock = mock(() => Promise.resolve());
    const restoreMock = mock(() => Promise.resolve());
    api.deleteMedia = deleteMock;
    api.restoreMedia = restoreMock;

    const harness = hookHarness(() => LibraryPage({ initialId: "med-1" }));
    await harness.settle();

    const rendered = harness.render();
    const dialogEl = elements(rendered).find((el) => el.type === MediaDialog);
    expect(dialogEl).toBeDefined();
    const dialogContent = elements(MediaDialog(dialogEl!.props as Parameters<typeof MediaDialog>[0]));

    const deleteBtn = dialogContent.find(
      (el) => el.type === "button" && el.props.children === "Delete",
    );
    expect(deleteBtn).toBeDefined();
    await (deleteBtn!.props.onClick as () => Promise<void>)();
    harness.dispose();
  });
});
