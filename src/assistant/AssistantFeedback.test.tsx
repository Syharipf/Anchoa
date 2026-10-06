import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AssistantMessage, AssistantProposal } from "../api";
import { elements } from "../test/hookHarness";
import { AssistantCaption, AssistantFeedback } from "./AssistantFeedback";
import { ProposalCard } from "./ProposalCard";
import type { useAssistant } from "./useAssistant";

function createMockAssistant(
  overrides: Partial<ReturnType<typeof useAssistant>> = {},
): ReturnType<typeof useAssistant> {
  return {
    mode: "idle",
    messages: [],
    streamingCaption: "",
    pendingProposals: [],
    error: null,
    currentSendId: 0,
    aiStatus: null,
    checkStatus: async () => ({ available: true, models: [], error: null }),
    voiceMissing: false,
    voiceStatus: null,
    checkVoiceStatus: async () => null,
    toggleMic: async () => {},
    sendVoice: async () => {},
    speak: async () => {},
    clearVoiceMissing: () => {},
    send: async () => {},
    stop: async () => {},
    decide: async () => ({
      id: "p1",
      title: "Task",
      status: "plan",
      tag: null,
      dueAt: null,
      overdue: false,
      subDone: 0,
      subTotal: 0,
      projectId: null,
      projectName: null,
      priority: null,
    }),
    setMode: () => {},
    clearError: () => {},
    reset: async () => {},
    ...overrides,
  };
}

describe("AssistantFeedback", () => {
  it("shows custom failure without directing user to start Ollama", () => {
    const assistant = createMockAssistant({ aiStatus: { provider: "custom", name: "9router", available: false, models: [], error: "Autentikasi gagal" } });
    const html = renderToStaticMarkup(AssistantCaption({ assistant }));
    expect(html).toContain("9router tidak tersedia");
    expect(html).toContain("Autentikasi gagal");
    expect(html).not.toContain("systemctl");
    expect(html).not.toContain("Ollama belum berjalan");
  });
  it("renders nothing when there is no error, no proposals, and no messages", () => {
    const assistant = createMockAssistant();
    const tree = AssistantFeedback({ assistant });
    const html = renderToStaticMarkup(tree);
    expect(html).toBe("");
  });

  it("renders error alert with Tutup button and calls clearError on click", () => {
    let cleared = false;
    const assistant = createMockAssistant({
      error: "Koneksi terputus",
      clearError: () => {
        cleared = true;
      },
    });

    const tree = AssistantFeedback({ assistant });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Koneksi terputus");
    expect(html).toContain("Tutup");

    const els = elements(tree);
    const alert = els.find((el) => el.props.role === "alert");
    expect(alert).toBeDefined();

    const closeBtn = els.find((el) => el.props["aria-label"] === "Tutup pesan kesalahan");
    expect(closeBtn).toBeDefined();
    (closeBtn!.props.onClick as () => void)();
    expect(cleared).toBe(true);
  });

  it("renders proposal cards and allows decision", async () => {
    let decidedId = "";
    let decidedApprove = false;
    const proposal: AssistantProposal = {
      id: "prop-1",
      name: "create_task",
      args: { title: "Beli kopi" },
      summary: "Buat tugas “Beli kopi”",
    };
    const assistant = createMockAssistant({
      pendingProposals: [proposal],
      decide: async (id, approve) => {
        decidedId = id;
        decidedApprove = approve;
        return null as any;
      },
    });

    const tree = AssistantFeedback({ assistant });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Buat tugas “Beli kopi”");
    expect(html).toContain("Setujui");
    expect(html).toContain("Tolak");

    const els = elements(tree);
    const card = els.find((el) => el.type === ProposalCard);
    expect(card).toBeDefined();
    const cardProps = card!.props as {
      proposal: AssistantProposal;
      onDecide: (id: string, approve: boolean) => Promise<void>;
    };
    expect(cardProps.proposal.id).toBe("prop-1");
    await cardProps.onDecide("prop-1", true);
    expect(decidedId).toBe("prop-1");
    expect(decidedApprove).toBe(true);
  });

  it("renders message history when showHistory is true and ignores empty or system messages", () => {
    const messages: AssistantMessage[] = [
      { role: "system", content: "ignore system" },
      { role: "user", content: "Halo asisten" },
      { role: "assistant", content: "" },
      { role: "assistant", content: "Halo! Ada yang bisa dibantu?" },
    ];
    const assistant = createMockAssistant({ messages });

    const tree = AssistantFeedback({ assistant, showHistory: true });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Halo asisten");
    expect(html).toContain("Halo! Ada yang bisa dibantu?");
    expect(html).not.toContain("ignore system");

    const els = elements(tree);
    const historyContainer = els.find((el) => el.props["aria-label"] === "Riwayat pesan");
    expect(historyContainer).toBeDefined();
    expect(historyContainer!.props.className).toContain("max-h-36");
  });

  it("does not render message history when showHistory is false", () => {
    const messages: AssistantMessage[] = [
      { role: "user", content: "Halo asisten" },
    ];
    const assistant = createMockAssistant({ messages });

    const tree = AssistantFeedback({ assistant, showHistory: false });
    const html = renderToStaticMarkup(tree);
    expect(html).not.toContain("Halo asisten");
    expect(html).not.toContain("Riwayat pesan");
  });

  it("renders compact history container and bubbles when compact is true", () => {
    const messages: AssistantMessage[] = [
      { role: "user", content: "Pesan mini" },
    ];
    const assistant = createMockAssistant({ messages });

    const tree = AssistantFeedback({ assistant, compact: true });
    const els = elements(tree);
    const historyContainer = els.find((el) => el.props["aria-label"] === "Riwayat pesan");
    expect(historyContainer).toBeDefined();
    expect(historyContainer!.props.className).toContain("max-h-28");
    expect(historyContainer!.props.className).toContain("bg-surface-2/40");

    const bubble = els.find((el) => el.props.children === "Pesan mini");
    expect(bubble).toBeDefined();
    expect(bubble!.props.className).toContain("rounded-md px-2 py-1");
  });
});
