import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type AiStatus, type AssistantEvent, type AssistantProposal } from "../api";
import { deferred, elements, hookHarness } from "../test/hookHarness";
import { AssistantStage } from "./AssistantStage";
import { ProposalCard } from "./ProposalCard";

describe("AssistantStage", () => {
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

  it.each([true, false])("keeps streaming controls available (Ollama available: %s)", async (available) => {
    const onlineStatus: AiStatus = {
      available,
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

    const microphone = elements(harness.render()).find((el) => el.props["aria-label"] === "Ketuk untuk bicara")!;
    expect(microphone.props.disabled).toBe(true);
    (microphone.props.onClick as () => void)();
    (kirimBtn!.props.onClick as () => void)();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(renderToStaticMarkup(harness.render())).toContain("Sedang berpikir…");

    // Hentikan remains available even after hiding the typing input.
    (typingBtn!.props.onClick as () => void)();
    expect(renderToStaticMarkup(harness.render())).toContain("Hentikan");

    // Click Hentikan
    const hentikanBtn = elements(harness.render()).find((el) => el.props["aria-label"] === "Hentikan");
    expect(hentikanBtn).toBeDefined();
    await (hentikanBtn!.props.onClick as () => Promise<void>)();
    expect(stopSpy).toHaveBeenCalled();
  });

  it("reenables proposal buttons after a failed decision so the user can retry or reject", async () => {
    const decision = deferred<null>();
    const decideSpy = spyOn(api, "assistantDecide").mockReturnValueOnce(decision.promise).mockResolvedValue(null);
    spies.push(decideSpy);
    harness = hookHarness<ReactNode>(() => ProposalCard({
      proposal: { id: "proposal", name: "create_task", args: {}, summary: "Buat tugas" },
      onDecide: api.assistantDecide,
    }));
    const buttons = () => elements(harness!.render()).filter((el) => el.type === "button");
    const approving = (buttons().find((el) => el.props.children === "Setujui")!.props.onClick as () => Promise<void>)();
    expect(buttons().every((el) => el.props.disabled === true)).toBe(true);
    decision.reject(new Error("Gagal menyimpan"));
    await approving;
    expect(buttons().every((el) => el.props.disabled === false)).toBe(true);
    await (buttons().find((el) => el.props.children === "Tolak")!.props.onClick as () => Promise<void>)();
    expect(decideSpy).toHaveBeenLastCalledWith("proposal", false);
  });

  it("shows send failures in a dismissible danger alert", async () => {
    spies.push(spyOn(api, "aiStatus").mockResolvedValue({ available: true, models: [], error: null }));
    spies.push(spyOn(api, "assistantSend").mockRejectedValue(new Error("Balasan gagal")));
    harness = hookHarness<ReactNode>(() => AssistantStage({}));
    harness.render();
    await harness.settle();
    const button = (label: string) => elements(harness!.render()).find((el) => el.props["aria-label"] === label)!;
    (button("Ketik pesan").props.onClick as () => void)();
    const input = elements(harness.render()).find((el) => el.type === "input")!;
    (input.props.onChange as (e: unknown) => void)({ target: { value: "Halo" } });
    (button("Kirim").props.onClick as () => void)();
    await harness.settle();

    const alert = elements(harness.render()).find((el) => el.props.role === "alert")!;
    expect(alert).toBeDefined();
    expect(alert.props.className).toContain("text-danger");
    expect(renderToStaticMarkup(alert)).toContain("Balasan gagal");
    (button("Tutup pesan kesalahan").props.onClick as () => void)();
    expect(renderToStaticMarkup(harness.render())).not.toContain("Balasan gagal");
  });

  it("hides the offline card when a focus check finds Ollama available", async () => {
    spies.push(spyOn(api, "aiStatus")
      .mockResolvedValueOnce({ available: false, models: [], error: "Offline" })
      .mockResolvedValue({ available: true, models: [], error: null }));
    harness = hookHarness<ReactNode>(() => AssistantStage({}));
    harness.render();
    await harness.settle();
    expect(renderToStaticMarkup(harness.render())).toContain("Ollama belum berjalan");
    harness.focus();
    await harness.settle();
    expect(renderToStaticMarkup(harness.render())).not.toContain("Ollama belum berjalan");
  });
});
