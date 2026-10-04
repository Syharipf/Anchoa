import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api, type Entry, type Item, type VoiceStatus } from "../api";
import * as toastModule from "../shell/toast";
import { elements, hookHarness } from "../test/hookHarness";
import { EntryEditor } from "./EntryEditor";

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
  const el = elements(node).find((e) => e.type === "button" &&
    (e.props["aria-label"] === label ||
      (Array.isArray(e.props.children)
        ? e.props.children.some((c: unknown) => c === label)
        : e.props.children === label)));
  expect(el).toBeDefined();
  return el!;
}

function click(node: ReactNode, label: string) {
  (button(node, label).props.onClick as () => void)();
}

const baseVoiceStatus: VoiceStatus = {
  pwRecord: true, pwPlay: true, whisper: "/opt/whisper", whisperModel: true,
  piper: true, voices: [], settings: { id: "default", params: { lengthScale: 1, noiseScale: 0.667, noiseW: 0.8 } },
  recording: false, speaking: false,
};

describe("EntryEditor dictation", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let entry: Entry;
  let spies: { mockRestore: () => void }[];
  const onOpenSettings = mock((_section?: string) => {});
  let toastCalls: { text: string; kind?: string; action?: { label: string; run: () => void } }[];

  beforeEach(() => {
    entry = makeEntry();
    toastCalls = [];
    onOpenSettings.mockClear();
    spies = [
      spyOn(api, "updateItem").mockImplementation(async (id, patch) =>
        ({ ...makeItem(entry), id, ...patch })),
    ];
  });

  function mount() {
    const toastFn = (text: string, kind?: string, action?: toastModule.ToastAction) => {
      toastCalls.push({ text, kind, action });
    };
    spies.push(spyOn(toastModule, "useToast").mockReturnValue(toastFn));
    harness = hookHarness(() => EntryEditor({
      entry,
      onEntryChanged: (updated) => { entry = updated; },
      onOpenTask: () => {},
      onOpenAssistant: () => {},
      onDelete: async () => {},
      onTagClick: () => {},
      onOpenSettings,
    }));
    harness.render();
  }

  afterEach(() => {
    harness?.dispose();
    spies.forEach((spy) => spy.mockRestore());
  });

  it("shows toast error when whisper not installed and offers Pengaturan", async () => {
    const status = { ...baseVoiceStatus, whisper: null, whisperModel: false };
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(status));
    spies.push(spyOn(api, "voiceRecordStart").mockResolvedValue(undefined));
    mount();
    click(harness.render(), "Dikte");
    await harness.settle();
    expect(api.voiceStatus).toHaveBeenCalledTimes(1);
    expect(api.voiceRecordStart).not.toHaveBeenCalled();
    expect(toastCalls.length).toBeGreaterThanOrEqual(1);
    const t = toastCalls.find((c) => c.text === "Model Whisper belum terpasang");
    expect(t).toBeDefined();
    expect(t!.kind).toBe("error");
    expect(t!.action?.label).toBe("Pengaturan");
    t!.action!.run();
    expect(onOpenSettings).toHaveBeenCalledWith("suara");
  });

  it("starts recording when whisper is installed", async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus));
    spies.push(spyOn(api, "voiceRecordStart").mockResolvedValue(undefined));
    mount();
    click(harness.render(), "Dikte");
    await harness.settle();
    expect(api.voiceRecordStart).toHaveBeenCalledTimes(1);
    // Button aria-label changes to "Hentikan rekaman dikte"
    const btn = button(harness.render(), "Hentikan rekaman dikte");
    expect(btn).toBeDefined();
  });

  it("stops recording and inserts transcript into body", async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus));
    spies.push(spyOn(api, "voiceRecordStart").mockResolvedValue(undefined));
    spies.push(spyOn(api, "voiceRecordStop").mockResolvedValue("teks baru"));
    mount();
    // Start
    click(harness.render(), "Dikte");
    await harness.settle();
    // Stop
    click(harness.render(), "Hentikan rekaman dikte");
    await harness.settle();
    // Body should contain the transcript appended
    const textarea = elements(harness.render()).find((e) => e.props["aria-label"] === "Isi entri");
    expect(textarea).toBeDefined();
    expect((textarea!.props.value as string)).toContain("teks baru");
  });

  it("inserts transcript at cursor position when textarea has selection", async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus));
    spies.push(spyOn(api, "voiceRecordStart").mockResolvedValue(undefined));
    spies.push(spyOn(api, "voiceRecordStop").mockResolvedValue("disisipkan"));
    entry.body = "Awal Akhir";
    mount();

    click(harness.render(), "Dikte");
    await harness.settle();

    const textareaEl = elements(harness.render()).find((e) => e.props["aria-label"] === "Isi entri");
    expect(textareaEl).toBeDefined();
    if (textareaEl && "ref" in textareaEl.props) {
      const ref = textareaEl.props.ref;
      if (ref && typeof ref === "object" && "current" in ref) {
        ref.current = { selectionStart: 5, selectionEnd: 5 };
      }
    }

    click(harness.render(), "Hentikan rekaman dikte");
    await harness.settle();

    const textarea = elements(harness.render()).find((e) => e.props["aria-label"] === "Isi entri");
    expect((textarea!.props.value as string)).toBe("Awal disisipkan Akhir");
  });
  it("cleans up recording on unmount", async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus));
    spies.push(spyOn(api, "voiceRecordStart").mockResolvedValue(undefined));
    const stop = spyOn(api, "voiceRecordStop").mockResolvedValue("");
    spies.push(stop);
    mount();
    click(harness.render(), "Dikte");
    await harness.settle();
    expect(api.voiceRecordStart).toHaveBeenCalledTimes(1);
    harness.dispose();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("preserves edits typed while transcript is pending", async () => {
    const { promise: delayedStop, resolve: resolveStop } = Promise.withResolvers<string>();
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus));
    spies.push(spyOn(api, "voiceRecordStart").mockResolvedValue(undefined));
    spies.push(spyOn(api, "voiceRecordStop").mockReturnValue(delayedStop));
    entry.body = "Awal";
    mount();

    // Start & stop recording
    click(harness.render(), "Dikte");
    await harness.settle();
    click(harness.render(), "Hentikan rekaman dikte");
    await harness.settle();

    // While transcribing is pending, user types in textarea
    const textareaEl = elements(harness.render()).find((e) => e.props["aria-label"] === "Isi entri");
    expect(textareaEl).toBeDefined();
    (textareaEl!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: "Awal diedit" } });
    await harness.settle();

    // Transcript arrives now
    resolveStop("suara baru");
    await harness.settle();

    const textareaAfter = elements(harness.render()).find((e) => e.props["aria-label"] === "Isi entri");
    expect((textareaAfter!.props.value as string)).toBe("Awal diedit suara baru");
  });

  it("discards pending transcript when switching entry", async () => {
    const { promise: delayedStop, resolve: resolveStop } = Promise.withResolvers<string>();
    const updateItemSpy = spyOn(api, "updateItem").mockResolvedValue(makeItem(entry));
    spies.push(updateItemSpy);
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus));
    spies.push(spyOn(api, "voiceRecordStart").mockResolvedValue(undefined));
    spies.push(spyOn(api, "voiceRecordStop").mockReturnValue(delayedStop));
    entry.body = "Isi entri 1";
    mount();

    click(harness.render(), "Dikte");
    await harness.settle();
    click(harness.render(), "Hentikan rekaman dikte");
    await harness.settle();

    // Switch to another entry
    entry = { ...makeEntry(), id: "entry-2", title: "Entri 2", body: "Isi entri 2" };
    harness.render();
    await harness.settle();

    // Delayed transcript from entry 1 arrives
    resolveStop("suara entri 1");
    await harness.settle();

    const textarea = elements(harness.render()).find((e) => e.props["aria-label"] === "Isi entri");
    expect((textarea!.props.value as string)).toBe("Isi entri 2");
    // updateItem should not have been called with the discarded transcript
    expect(updateItemSpy).not.toHaveBeenCalledWith("entry-2", expect.objectContaining({ body: expect.stringContaining("suara entri 1") }));
  });

  it("discards pending transcript when unmounted", async () => {
    const { promise: delayedStop, resolve: resolveStop } = Promise.withResolvers<string>();
    const updateItemSpy = spyOn(api, "updateItem").mockResolvedValue(makeItem(entry));
    spies.push(updateItemSpy);
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus));
    spies.push(spyOn(api, "voiceRecordStart").mockResolvedValue(undefined));
    spies.push(spyOn(api, "voiceRecordStop").mockReturnValue(delayedStop));
    mount();

    click(harness.render(), "Dikte");
    await harness.settle();
    click(harness.render(), "Hentikan rekaman dikte");
    await harness.settle();

    // Unmount before transcript arrives
    harness.dispose();

    // Transcript arrives after unmount
    resolveStop("suara terlambat");
    const { promise: timer, resolve: resolveTimer } = Promise.withResolvers<void>();
    setTimeout(resolveTimer, 50);
    await timer;

    // No autosave updateItem triggered
    expect(updateItemSpy).not.toHaveBeenCalled();
  });

  it("stops recording if voiceRecordStart finishes after unmount", async () => {
    const { promise: startPromise, resolve: resolveStart } = Promise.withResolvers<void>();
    const stopSpy = spyOn(api, "voiceRecordStop").mockResolvedValue("");
    spies.push(stopSpy);
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus));
    spies.push(spyOn(api, "voiceRecordStart").mockReturnValue(startPromise));
    mount();

    click(harness.render(), "Dikte");
    await harness.settle();

    // Unmount while starting
    harness.dispose();

    // Start completes after unmount
    resolveStart();
    const { promise: timer, resolve: resolveTimer } = Promise.withResolvers<void>();
    setTimeout(resolveTimer, 50);
    await timer;

    // Orphaned start must be stopped immediately
    expect(stopSpy).toHaveBeenCalled();
  });

  it("does not start recording if voiceStatus finishes after unmount", async () => {
    const { promise: statusPromise, resolve: resolveStatus } = Promise.withResolvers<VoiceStatus>();
    const startSpy = spyOn(api, "voiceRecordStart").mockResolvedValue(undefined);
    spies.push(startSpy);
    spies.push(spyOn(api, "voiceStatus").mockReturnValue(statusPromise));
    mount();

    click(harness.render(), "Dikte");
    await harness.settle();

    // Unmount while checking status
    harness.dispose();

    // Status arrives after unmount
    resolveStatus(baseVoiceStatus);
    const { promise: timer, resolve: resolveTimer } = Promise.withResolvers<void>();
    setTimeout(resolveTimer, 50);
    await timer;

    expect(startSpy).not.toHaveBeenCalled();
  });
});
