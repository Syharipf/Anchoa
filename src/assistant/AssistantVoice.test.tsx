import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api, type VoiceStatus } from "../api";
import { elements } from "../test/assistantElements";
import { deferred, hookHarness } from "../test/hookHarness";
import { AssistantCaption } from "./AssistantFeedback";
import { AssistantMini } from "./AssistantMini";
import { AssistantStage } from "./AssistantStage";

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
