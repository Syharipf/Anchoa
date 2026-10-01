import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type AiStatus, type AssistantEvent } from "../api";
import { elements, hookHarness } from "../test/hookHarness";
import { AssistantFeedback } from "./AssistantFeedback";
import { AssistantMini } from "./AssistantMini";

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
      (el) => el.props["aria-label"] === "Buka asisten",
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
      (el) => el.props["aria-label"] === "Buka asisten",
    );
    expect(trigger).toBeDefined();
    (trigger!.props.onClick as () => void)();
    harness.render();

    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("Ollama belum berjalan");
    expect(html).toContain("sudo systemctl start ollama");
    expect(html).toContain("Pengaturan › Asisten &amp; AI");

    const linkBtn = elements(harness.render()).find(
      (el) => el.type === "button" && el.props.children === "Pengaturan › Asisten & AI",
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
      (el) => el.props["aria-label"] === "Buka asisten",
    );
    (trigger!.props.onClick as () => void)();
    harness.render();

    // Toggle typing
    const typingBtn = elements(harness.render()).find(
      (el) => el.props["aria-label"] === "Ketik pesan",
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
      (el) => el.props["aria-label"] === "Kirim",
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
    expect(markup).toContain("Sedang berpikir…");
    expect(markup).toContain("Mencatat...");
    expect(markup).toContain("Hentikan");

    const microphone = elements(harness.render()).find((el) => el.props["aria-label"] === "Ketuk untuk bicara")!;
    expect(microphone.props.disabled).toBe(true);
    (microphone.props.onClick as () => void)();
    (kirimBtn!.props.onClick as () => void)();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(renderToStaticMarkup(harness.render())).toContain("Sedang berpikir…");
    (typingBtn!.props.onClick as () => void)();
    expect(renderToStaticMarkup(harness.render())).toContain("Hentikan");

    // Click Hentikan
    const hentikanBtn = elements(harness.render()).find(
      (el) => el.props["aria-label"] === "Hentikan",
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
    (button("Buka asisten").props.onClick as () => void)();
    (button("Ketik pesan").props.onClick as () => void)();
    const input = elements(harness.render()).find((el) => el.type === "input")!;
    (input.props.onChange as (e: unknown) => void)({ target: { value: "Halo" } });
    (button("Kirim").props.onClick as () => void)();
    await harness.settle();

    const feedback = elements(harness.render()).find((el) => el.type === AssistantFeedback)!;
    expect(feedback).toBeDefined();
    const feedbackElements = elements(AssistantFeedback(feedback.props as any));
    const alert = feedbackElements.find((el) => el.props.role === "alert")!;
    expect(alert).toBeDefined();
    expect(alert.props.className).toContain("text-danger");
    expect(renderToStaticMarkup(alert)).toContain("Balasan gagal");
    const closeBtn = feedbackElements.find(
      (el) => el.props["aria-label"] === "Tutup pesan kesalahan",
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
    const trigger = elements(harness.render()).find((el) => el.props["aria-label"] === "Buka asisten")!;
    (trigger.props.onClick as () => void)();
    expect(renderToStaticMarkup(harness.render())).toContain("Ollama belum berjalan");
    harness.runTimers();
    await harness.settle();
    expect(renderToStaticMarkup(harness.render())).not.toContain("Ollama belum berjalan");
  });
});
