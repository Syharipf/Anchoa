import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type AiStatus, type AssistantEvent } from "../api";
import { hookHarness } from "../test/hookHarness";
import { elements } from "../test/assistantElements";
import { AssistantFeedback } from "./AssistantFeedback";
import { AssistantMini } from "./AssistantMini";
import { VoiceMissingCard } from "./VoiceMissingCard";

describe("AssistantMini", () => {
  const spies: ReturnType<typeof spyOn>[] = [];
  let harness: ReturnType<typeof hookHarness<ReactNode>> | null = null;

  beforeEach(() => {
    spies.push(spyOn(api, "assistantPending").mockResolvedValue([]));
  });

  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
    spies.length = 0;
    if (harness) {
      harness.dispose();
      harness = null;
    }
  });

  it("renders collapsed trigger button initially and opens on click", () => {
    harness = hookHarness<ReactNode>(() =>
      AssistantMini({
        hint: "Pesan kontekstual",
        onOpenFull: () => {},
      }),
    );
    harness.render();

    const trigger = elements(harness.render()).find(
      (el) => el.props["aria-label"] === "Open assistant",
    );
    expect(trigger).toBeDefined();

    // Click to open
    (trigger!.props.onClick as () => void)();
    harness.render();

    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("Anchoa");
    expect(html).toContain("Pesan kontekstual");
  });

  it("shows state card 'Ollama belum berjalan' when open and Ollama is unreachable", async () => {
    const offlineStatus: AiStatus = {
      available: false,
      models: [],
      error: "Koneksi ke Ollama ditolak",
    };
    spies.push(spyOn(api, "aiStatus").mockResolvedValue(offlineStatus));

    let settingsOpened = false;
    harness = hookHarness<ReactNode>(() =>
      AssistantMini({
        hint: "Petunjuk",
        onOpenFull: () => {},
        onOpenAiSettings: () => { settingsOpened = true; },
      }),
    );
    harness.render();
    await harness.settle();

    // Open popup
    const trigger = elements(harness.render()).find(
      (el) => el.props["aria-label"] === "Open assistant",
    );
    expect(trigger).toBeDefined();
    (trigger!.props.onClick as () => void)();
    harness.render();

    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("Ollama is not running");
    expect(html).toContain("sudo systemctl start ollama");
    expect(html).toContain("Settings › Assistant &amp; AI");

    const linkBtn = elements(harness.render()).find(
      (el) => el.type === "button" && el.props.children === "Settings › Assistant & AI",
    );
    if (linkBtn) {
      (linkBtn.props.onClick as () => void)();
      expect(settingsOpened).toBe(true);
    }
  });

  it.each([true, false])("keeps streaming controls available in Mini (Ollama available: %s)", async (available) => {
    const onlineStatus: AiStatus = {
      available,
      models: ["qwen2.5:3b"],
      error: null,
    };
    spies.push(spyOn(api, "aiStatus").mockResolvedValue(onlineStatus));

    let capturedCallback: ((event: AssistantEvent) => void) | null = null;
    const sendSpy = spyOn(api, "assistantSend").mockImplementation((_text, onEvent) => {
      capturedCallback = onEvent;
      return new Promise(() => {});
    });
    spies.push(sendSpy);

    const stopSpy = spyOn(api, "assistantStop").mockResolvedValue(undefined);
    spies.push(stopSpy);

    harness = hookHarness<ReactNode>(() =>
      AssistantMini({
        hint: "Bantuan mini",
        onOpenFull: () => {},
      }),
    );
    harness.render();
    await harness.settle();

    // Open
    const trigger = elements(harness.render()).find(
      (el) => el.props["aria-label"] === "Open assistant",
    );
    (trigger!.props.onClick as () => void)();
    harness.render();

    // Toggle typing
    const typingBtn = elements(harness.render()).find(
      (el) => el.props["aria-label"] === "Type message",
    );
    expect(typingBtn).toBeDefined();
    (typingBtn!.props.onClick as () => void)();
    harness.render();

    // Type text
    const input = elements(harness.render()).find((el) => el.type === "input");
    expect(input).toBeDefined();
    (input!.props.onChange as (e: unknown) => void)({ target: { value: "buat catatan" } });
    harness.render();

    // Send
    const kirimBtn = elements(harness.render()).find(
      (el) => el.props["aria-label"] === "Send",
    );
    expect(kirimBtn).toBeDefined();
    (kirimBtn!.props.onClick as () => void)();
    harness.render();
    expect(sendSpy).toHaveBeenCalledWith("buat catatan", expect.any(Function));

    // Emit streaming delta
    expect(capturedCallback).not.toBeNull();
    capturedCallback!({ type: "delta", data: "Mencatat..." });
    harness.render();

    const markup = renderToStaticMarkup(harness.render());
    expect(markup).toContain("Thinking…");
    expect(markup).toContain("Mencatat...");
    expect(markup).toContain("Stop");

    const microphone = elements(harness.render()).find((el) => el.props["aria-label"] === "Tap to speak")!;
    expect(microphone.props.disabled).toBe(true);
    (microphone.props.onClick as () => void)();
    (kirimBtn!.props.onClick as () => void)();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(renderToStaticMarkup(harness.render())).toContain("Thinking…");
    (typingBtn!.props.onClick as () => void)();
    expect(renderToStaticMarkup(harness.render())).toContain("Stop");

    // Click Stop
    const hentikanBtn = elements(harness.render()).find(
      (el) => el.props["aria-label"] === "Stop",
    );
    expect(hentikanBtn).toBeDefined();
    await (hentikanBtn!.props.onClick as () => Promise<void>)();
    expect(stopSpy).toHaveBeenCalled();
  });

  it("shows send failures in a dismissible danger alert", async () => {
    spies.push(spyOn(api, "aiStatus").mockResolvedValue({ available: true, models: [], error: null }));
    spies.push(spyOn(api, "assistantSend").mockRejectedValue(new Error("Balasan gagal")));
    harness = hookHarness<ReactNode>(() => AssistantMini({ hint: "Petunjuk", onOpenFull: () => {} }));
    harness.render();
    await harness.settle();
    const button = (label: string) => elements(harness!.render()).find((el) => el.props["aria-label"] === label)!;
    (button("Open assistant").props.onClick as () => void)();
    (button("Type message").props.onClick as () => void)();
    const input = elements(harness.render()).find((el) => el.type === "input")!;
    (input.props.onChange as (e: unknown) => void)({ target: { value: "Halo" } });
    (button("Send").props.onClick as () => void)();
    await harness.settle();

    const feedback = elements(harness.render()).find((el) => el.type === AssistantFeedback)!;
    expect(feedback).toBeDefined();
    const feedbackElements = elements(AssistantFeedback(feedback.props as any));
    const alert = feedbackElements.find((el) => el.props.role === "alert")!;
    expect(alert).toBeDefined();
    expect(alert.props.className).toContain("text-danger");
    expect(renderToStaticMarkup(alert)).toContain("Balasan gagal");
    const closeBtn = feedbackElements.find(
      (el) => el.props["aria-label"] === "Close error message",
    )!;
    expect(closeBtn).toBeDefined();
    (closeBtn.props.onClick as () => void)();
    expect(renderToStaticMarkup(harness.render())).not.toContain("Balasan gagal");
  });

  it("hides the offline card after an offline polling check finds Ollama available", async () => {
    spies.push(spyOn(api, "aiStatus")
      .mockResolvedValueOnce({ available: false, models: [], error: "Offline" })
      .mockResolvedValue({ available: true, models: [], error: null }));
    harness = hookHarness<ReactNode>(() => AssistantMini({ hint: "Petunjuk", onOpenFull: () => {} }));
    harness.render();
    await harness.settle();
    const trigger = elements(harness.render()).find((el) => el.props["aria-label"] === "Open assistant")!;
    (trigger.props.onClick as () => void)();
    expect(renderToStaticMarkup(harness.render())).toContain("Ollama is not running");
    harness.runTimers();
    await harness.settle();
    expect(renderToStaticMarkup(harness.render())).not.toContain("Ollama is not running");
  });

  it("shows VoiceMissingCard linking to Pengaturan > Suara when voice parts are missing and mic is pressed in Mini", async () => {
    spies.push(spyOn(api, "aiStatus").mockResolvedValue({ available: true, models: [], error: null }));
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue({
      pwRecord: true,
      pwPlay: true,
      whisper: null,
      whisperModel: false,
      piper: false,
      voices: [],
      settings: { id: "id_ID-news_tts-medium", params: { lengthScale: 1.0, noiseScale: 0.667, noiseW: 0.8 } },
      recording: false,
      speaking: false,
    }));

    let voiceSettingsOpened = false;
    harness = hookHarness<ReactNode>(() =>
      AssistantMini({
        hint: "Petunjuk",
        onOpenFull: () => {},
        onOpenVoiceSettings: () => { voiceSettingsOpened = true; },
      }),
    );
    harness.render();
    await harness.settle();

    // Open popup
    const trigger = elements(harness.render()).find((el) => el.props["aria-label"] === "Open assistant")!;
    (trigger.props.onClick as () => void)();
    harness.render();

    const micBtn = elements(harness.render()).find((el) => el.props["aria-label"] === "Tap to speak")!;
    expect(micBtn).toBeDefined();

    await (micBtn.props.onClick as () => Promise<void>)();
    await harness.settle();

    const markup = renderToStaticMarkup(harness.render());
    expect(markup).toContain("Voice not installed");
    expect(markup).toContain("Settings › Voice");

    const card = elements(harness.render()).find((el) => el.type === VoiceMissingCard);
    expect(card).toBeDefined();
    const cardElements = elements(VoiceMissingCard(card!.props as any));
    const linkBtn = cardElements.find((el) => el.type === "button");
    expect(linkBtn).toBeDefined();
    (linkBtn!.props.onClick as () => void)();
    expect(voiceSettingsOpened).toBe(true);
  });
});
