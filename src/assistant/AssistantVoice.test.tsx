import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type VoiceStatus } from "../api";
import { elements } from "../test/assistantElements";
import { deferred, hookHarness } from "../test/hookHarness";
import { AssistantCaption } from "./AssistantFeedback";
import { AssistantMini } from "./AssistantMini";
import { AssistantStage } from "./AssistantStage";
import type { AssistantRequest } from "./useAssistantRequest";

const voiceStatus: VoiceStatus = {
  pwRecord: true, pwPlay: true, whisper: "/usr/bin/whisper-cli", whisperModel: true, piper: true,
  voices: [{
    id: "id", label: "Indonesia", language: "id_ID", quality: "medium", installed: true, imported: false,
    params: { lengthScale: 1, noiseScale: 0.667, noiseW: 0.8 },
  }],
  settings: { id: "id", params: { lengthScale: 1, noiseScale: 0.667, noiseW: 0.8 } },
  recording: false, speaking: false,
};

describe("shared assistant voice controls", () => {
  const spies: ReturnType<typeof spyOn>[] = [];
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  beforeEach(() => {
    spies.push(spyOn(api, "assistantPending").mockResolvedValue([]),
      spyOn(api, "aiStatus").mockResolvedValue({ available: true, models: [], error: null }),
      spyOn(api, "voiceStatus").mockResolvedValue(voiceStatus),
      spyOn(api, "voiceRecordStart").mockResolvedValue(undefined),
      spyOn(api, "voiceRecordStop").mockResolvedValue("Halo"),
      spyOn(api, "assistantStop").mockResolvedValue(undefined),
      spyOn(api, "voiceStop").mockResolvedValue(undefined));
  });
  afterEach(() => {
    harness?.dispose();
    spies.forEach((spy) => spy.mockRestore());
    spies.length = 0;
  });

  const button = (label: string) => elements(harness.render()).find((el) => el.props["aria-label"] === label)!;
  const click = (label: string) => (button(label).props.onClick as () => Promise<void> | void)();
  const mount = async (mini: boolean) => {
    harness = hookHarness<ReactNode>(() => mini ? AssistantMini({ hint: "Petunjuk", onOpenFull: () => {} }) : AssistantStage({}));
    harness.render();
    await harness.settle();
    if (mini) click("Buka asisten");
  };
  const assistant = () => elements(harness.render()).find((el) => el.type === AssistantCaption)!.props.assistant as Parameters<typeof AssistantCaption>[0]["assistant"];

  it.each([false, true])("opens an editable page prompt without sending until requested (Mini: %s)", async (mini) => {
    const send = spyOn(api, "assistantSend").mockResolvedValue({ message: { role: "assistant", content: "Tanggapan" }, proposals: [] });
    spies.push(send);
    let request: AssistantRequest | undefined;
    harness = hookHarness<ReactNode>(() => mini
      ? AssistantMini({ request, hint: "Petunjuk", onOpenFull: () => {} })
      : AssistantStage({ request }));
    harness.render();
    await harness.settle();
    request = { id: 1, action: { kind: "compose", text: "Tanggapi jurnal saya" } };
    const input = () => elements(harness.render()).find((el) => el.type === "input")!;
    expect(input().props.value).toBe("Tanggapi jurnal saya");
    expect(send).not.toHaveBeenCalled();
    (input().props.onChange as (event: unknown) => void)({ target: { value: "Pesan yang saya edit" } });
    harness.render();
    harness.replayEffects();
    expect(input().props.value).toBe("Pesan yang saya edit");
    await click("Kirim");
    await harness.settle();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Pesan yang saya edit", expect.any(Function));
  });

  it.each([false, true])("starts page-requested voice recording once and keeps writes approval-gated (Mini: %s)", async (mini) => {
    let request: AssistantRequest | undefined;
    const proposal = { id: "proposal", name: "create_task" as const, summary: "Buat tugas", args: { title: "Beli teri" } };
    const send = spyOn(api, "assistantSend").mockImplementation(async (_text, onEvent) => {
      onEvent({ type: "proposal", data: proposal });
      return { message: { role: "assistant", content: "" }, proposals: [proposal] };
    });
    const decide = spyOn(api, "assistantDecide").mockResolvedValue(null);
    spies.push(send, decide);
    harness = hookHarness<ReactNode>(() => mini
      ? AssistantMini({ request, hint: "Petunjuk", onOpenFull: () => {} })
      : AssistantStage({ request }));
    harness.render();
    await harness.settle();
    request = { id: 1, action: { kind: "voice" } };
    harness.render();
    await harness.settle();
    expect(assistant().mode).toBe("listening");
    request = { id: 2, action: { kind: "voice" } };
    harness.render();
    expect(api.voiceRecordStart).toHaveBeenCalledTimes(1);
    expect(api.voiceRecordStop).not.toHaveBeenCalled();
    await click("Berhenti mendengarkan");
    expect(send).toHaveBeenCalledWith("Halo", expect.any(Function));
    expect(assistant().pendingProposals).toEqual([proposal]);
    expect(decide).not.toHaveBeenCalled();
  });

  it.each([false, true])("reads page text with Piper even without transcription components and supports stopping (Mini: %s)", async (mini) => {
    const speech = deferred<void>();
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue({ ...voiceStatus, pwRecord: false, whisper: null, whisperModel: false }));
    const speak = spyOn(api, "voiceSpeak").mockReturnValue(speech.promise);
    const send = spyOn(api, "assistantSend");
    spies.push(speak, send);
    let request: AssistantRequest | undefined;
    harness = hookHarness<ReactNode>(() => mini
      ? AssistantMini({ request, hint: "Petunjuk", onOpenFull: () => {} })
      : AssistantStage({ request }));
    harness.render();
    await harness.settle();
    request = { id: 1, action: { kind: "speak", text: "Isi jurnal yang sedang diedit" } };
    harness.render();
    await harness.settle();
    expect(speak).toHaveBeenCalledTimes(1);
    expect(speak).toHaveBeenCalledWith("Isi jurnal yang sedang diedit");
    expect(send).not.toHaveBeenCalled();
    expect(assistant().mode).toBe("speaking");
    expect(assistant().streamingCaption).toBe("Isi jurnal yang sedang diedit");
    expect(assistant().messages).toEqual([]);
    await click("Hentikan suara");
    expect(api.voiceStop).toHaveBeenCalled();
    expect(assistant().mode).toBe("idle");
    speech.resolve();
    await harness.settle();
    expect(assistant().mode).toBe("idle");
  });

  it.each(["missing", "error"] as const)("shows existing setup or error feedback when read-aloud fails (%s)", async (failure) => {
    if (failure === "missing") spies.push(
      spyOn(api, "voiceStatus").mockResolvedValue({ ...voiceStatus, piper: false }),
      spyOn(api, "aiStatus").mockResolvedValue({ available: false, models: [], error: "Offline" }),
    );
    const speak = spyOn(api, "voiceSpeak").mockRejectedValue(new Error("Pemutaran gagal"));
    spies.push(speak);
    let request: AssistantRequest | undefined;
    harness = hookHarness<ReactNode>(() => AssistantMini({ request, hint: "Petunjuk", onOpenFull: () => {} }));
    harness.render();
    await harness.settle();
    request = { id: 1, action: { kind: "speak", text: "Bacakan ini" } };
    harness.render();
    await harness.settle();
    if (failure === "missing") {
      expect(speak).not.toHaveBeenCalled();
      expect(assistant().voiceMissing).toBe(true);
      expect(renderToStaticMarkup(harness.render())).toContain("Suara belum dipasang");
    } else expect(assistant().error).toBe("Pemutaran gagal");
    expect(assistant().mode).toBe("idle");
  });

  it("reads page text after a running reply finishes instead of dropping the request", async () => {
    const reply = deferred<Awaited<ReturnType<typeof api.assistantSend>>>();
    spies.push(spyOn(api, "assistantSend").mockReturnValue(reply.promise));
    const speak = spyOn(api, "voiceSpeak").mockResolvedValue(undefined);
    spies.push(speak);
    let request: AssistantRequest | undefined;
    harness = hookHarness<ReactNode>(() => AssistantStage({ request }));
    harness.render();
    await harness.settle();
    void assistant().send("Halo");
    harness.render();
    expect(assistant().mode).toBe("thinking");
    request = { id: 1, action: { kind: "speak", text: "Bacakan ini" } };
    harness.render();
    await harness.settle();
    expect(speak).not.toHaveBeenCalled();
    reply.resolve({ message: { role: "assistant", content: "Selesai" }, proposals: [] });
    await harness.settle();
    harness.render();
    await harness.settle();
    expect(speak).toHaveBeenCalledWith("Bacakan ini");
  });

  it("ignores a cancelled read-aloud completion while a newer playback is running", async () => {
    const oldSpeech = deferred<void>();
    const newSpeech = deferred<void>();
    const speak = spyOn(api, "voiceSpeak").mockReturnValueOnce(oldSpeech.promise).mockReturnValueOnce(newSpeech.promise);
    spies.push(speak);
    let request: AssistantRequest | undefined;
    harness = hookHarness<ReactNode>(() => AssistantMini({ request, hint: "Petunjuk", onOpenFull: () => {} }));
    harness.render();
    await harness.settle();
    request = { id: 1, action: { kind: "speak", text: "Entri pertama" } };
    harness.render();
    await harness.settle();
    request = { id: 2, action: { kind: "speak", text: "Entri kedua" } };
    harness.render();
    await harness.settle();
    expect(api.voiceStop).toHaveBeenCalled();
    expect(speak).toHaveBeenCalledTimes(2);
    oldSpeech.resolve();
    await harness.settle();
    expect(assistant().mode).toBe("speaking");
    newSpeech.resolve();
    await harness.settle();
    expect(assistant().mode).toBe("idle");
  });

  it.each([false, true])("disables typed sends while recording (Mini: %s)", async (mini) => {
    const send = spyOn(api, "assistantSend").mockResolvedValue({ message: { role: "assistant", content: "Reply" }, proposals: [] });
    spies.push(send);
    await mount(mini);
    click("Ketik pesan");
    const input = elements(harness.render()).find((el) => el.type === "input")!;
    (input.props.onChange as (e: unknown) => void)({ target: { value: "Typed" } });
    await click("Ketuk untuk bicara");
    expect(button("Kirim").props.disabled).toBe(true);
    const disabledInput = elements(harness.render()).find((el) => el.type === "input")!;
    expect(disabledInput.props.disabled).toBe(true);
    click("Kirim");
    (disabledInput.props.onKeyDown as (e: unknown) => void)({ key: "Enter", preventDefault: () => {} });
    expect(send).not.toHaveBeenCalled();
    expect(assistant().mode).toBe("listening");
  });

  it.each([false, true])("routes every speech-stop button to stop and preserves a new recording (Mini: %s)", async (mini) => {
    const speech = deferred<void>();
    spies.push(spyOn(api, "assistantSend").mockResolvedValue({ message: { role: "assistant", content: "Reply" }, proposals: [] }),
      spyOn(api, "voiceSpeak").mockReturnValue(speech.promise));
    await mount(mini);
    await click("Ketuk untuk bicara");
    const reply = click("Berhenti mendengarkan");
    await harness.settle();
    expect(assistant().mode).toBe("speaking");
    const stopping = elements(harness.render()).filter((el) => el.props["aria-label"] === "Hentikan suara");
    expect(stopping).toHaveLength(2);
    expect(stopping.every((el) => el.props.onClick === assistant().stop)).toBe(true);
    await click("Hentikan suara");
    await click("Ketuk untuk bicara");
    speech.resolve();
    await reply;
    expect(assistant().mode).toBe("listening");
  });

  it.each(["listening", "starting", "transcribing"])("drains Mini's recorder when collapsed during %s", async (phase) => {
    const starting = deferred<void>();
    const transcript = deferred<string>();
    if (phase === "starting") spies.push(spyOn(api, "voiceRecordStart").mockReturnValue(starting.promise));
    const recordStop = spyOn(api, "voiceRecordStop").mockReturnValue(transcript.promise);
    const send = spyOn(api, "assistantSend");
    const speak = spyOn(api, "voiceSpeak");
    spies.push(recordStop, send, speak);
    await mount(true);
    const recording = click("Ketuk untuk bicara");
    if (phase !== "starting") await recording;
    let transcribing: Promise<void> | void = undefined;
    if (phase === "transcribing") transcribing = click("Berhenti mendengarkan");
    click("Kecilkan asisten");
    if (phase === "starting") {
      starting.resolve();
      await harness.settle();
    }
    expect(recordStop).toHaveBeenCalledTimes(1);
    transcript.resolve("Cancelled");
    await recording;
    await transcribing;
    await harness.settle();
    expect(send).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
    click("Buka asisten");
    await click("Ketuk untuk bicara");
    expect(assistant().mode).toBe("listening");
  });
});
