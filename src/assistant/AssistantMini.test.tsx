import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type AiStatus, type AssistantEvent } from "../api";
import { elements, hookHarness } from "../test/hookHarness";
import { AssistantMini } from "./AssistantMini";

describe("AssistantMini", () => {
  const spies: ReturnType<typeof spyOn>[] = [];
  let harness: ReturnType<typeof hookHarness<ReactNode>> | null = null;

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

  it("handles typing mode, sending, streaming, and stopping in mini popup", async () => {
    const onlineStatus: AiStatus = {
      available: true,
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

    // Click Hentikan
    const hentikanBtn = elements(harness.render()).find(
      (el) => el.props["aria-label"] === "Hentikan",
    );
    expect(hentikanBtn).toBeDefined();
    await (hentikanBtn!.props.onClick as () => Promise<void>)();
    expect(stopSpy).toHaveBeenCalled();
  });
});
