import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type AiStatus, type AssistantEvent, type AssistantProposal } from "../api";
import { elements, hookHarness } from "../test/hookHarness";
import { AssistantStage } from "./AssistantStage";
import { ProposalCard } from "./ProposalCard";

describe("AssistantStage", () => {
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

  it("shows state card 'Ollama belum berjalan' with command and settings link when Ollama is unreachable", async () => {
    const offlineStatus: AiStatus = {
      available: false,
      models: [],
      error: "Koneksi ke Ollama ditolak",
    };
    spies.push(spyOn(api, "aiStatus").mockResolvedValue(offlineStatus));

    let settingsOpened = false;
    harness = hookHarness<ReactNode>(() =>
      AssistantStage({ onOpenAiSettings: () => { settingsOpened = true; } }),
    );
    harness.render();
    await harness.settle();

    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("Ollama belum berjalan");
    expect(html).toContain("sudo systemctl start ollama");
    expect(html).toContain("Pengaturan › Asisten &amp; AI");

    const buttons = elements(harness.render()).filter((el) => el.type === "button");
    const linkBtn = buttons.find(
      (b) => b.props.children === "Pengaturan › Asisten & AI",
    );
    if (linkBtn) {
      (linkBtn.props.onClick as () => void)();
      expect(settingsOpened).toBe(true);
    }
  });

  it("renders proposal cards with Setujui and Tolak and calls assistantDecide", async () => {
    const decideSpy = spyOn(api, "assistantDecide").mockResolvedValue({
      id: "task-1",
      title: "Beli teri",
      status: "plan",
      tag: null,
      dueAt: null,
      overdue: false,
      subDone: 0,
      subTotal: 0,
      projectId: null,
      projectName: null,
    });
    spies.push(decideSpy);

    let changed = false;
    const proposal: AssistantProposal = {
      id: "prop-42",
      summary: "Buat tugas “Beli teri”",
      name: "create_task",
      args: { title: "Beli teri" },
    };

    harness = hookHarness<ReactNode>(() =>
      ProposalCard({
        proposal,
        onDecide: async (id, approve) => {
          await api.assistantDecide(id, approve);
          if (approve) changed = true;
        },
      }),
    );
    harness.render();

    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("Buat tugas “Beli teri”");
    expect(html).toContain("Setujui");
    expect(html).toContain("Tolak");

    const buttons = elements(harness.render()).filter((el) => el.type === "button");
    const approveBtn = buttons.find((b) => b.props.children === "Setujui");
    const rejectBtn = buttons.find((b) => b.props.children === "Tolak");
    expect(approveBtn).toBeDefined();
    expect(rejectBtn).toBeDefined();

    // Click Setujui
    await (approveBtn!.props.onClick as () => Promise<void>)();
    expect(decideSpy).toHaveBeenCalledWith("prop-42", true);
    expect(changed).toBe(true);

    // Click Tolak
    changed = false;
    await (rejectBtn!.props.onClick as () => Promise<void>)();
    expect(decideSpy).toHaveBeenCalledWith("prop-42", false);
    expect(changed).toBe(false);
  });

  it("handles typing and sending to assistantSend with streaming caption and Hentikan button", async () => {
    const onlineStatus: AiStatus = {
      available: true,
      models: ["qwen2.5:3b"],
      error: null,
    };
    spies.push(spyOn(api, "aiStatus").mockResolvedValue(onlineStatus));

    let capturedCallback: ((event: AssistantEvent) => void) | null = null;
    const sendSpy = spyOn(api, "assistantSend").mockImplementation((_text, onEvent) => {
      capturedCallback = onEvent;
      return new Promise(() => {}); // Remains in flight to test thinking mode
    });
    spies.push(sendSpy);

    const stopSpy = spyOn(api, "assistantStop").mockResolvedValue(undefined);
    spies.push(stopSpy);

    harness = hookHarness<ReactNode>(() => AssistantStage({}));
    harness.render();
    await harness.settle();

    // Toggle typing
    const buttons = elements(harness.render()).filter((el) => el.type === "button");
    const typingBtn = buttons.find((b) => b.props["aria-label"] === "Ketik pesan");
    expect(typingBtn).toBeDefined();
    (typingBtn!.props.onClick as () => void)();
    harness.render();

    // Input text
    const inputs = elements(harness.render()).filter((el) => el.type === "input");
    expect(inputs.length).toBe(1);
    (inputs[0].props.onChange as (e: unknown) => void)({ target: { value: "halo" } });
    harness.render();

    // Click Kirim
    const kirimBtn = elements(harness.render()).find((el) => el.props["aria-label"] === "Kirim");
    expect(kirimBtn).toBeDefined();
    (kirimBtn!.props.onClick as () => void)();
    harness.render();

    expect(sendSpy).toHaveBeenCalledWith("halo", expect.any(Function));

    // Stream a chunk
    expect(capturedCallback).not.toBeNull();
    capturedCallback!({ type: "delta", data: "Halo dari asisten" });
    harness.render();

    const markup = renderToStaticMarkup(harness.render());
    expect(markup).toContain("Sedang berpikir…");
    expect(markup).toContain("Halo dari asisten");
    expect(markup).toContain("Hentikan");

    // Click Hentikan
    const hentikanBtn = elements(harness.render()).find((el) => el.props["aria-label"] === "Hentikan");
    expect(hentikanBtn).toBeDefined();
    await (hentikanBtn!.props.onClick as () => Promise<void>)();
    expect(stopSpy).toHaveBeenCalled();
  });
});
