import { describe, expect, it } from "bun:test";
import type { AssistantProposal } from "../api";
import {
  assistantReducer,
  initialAssistantState,
  type AssistantState,
} from "./useAssistant";

describe("assistantReducer", () => {
  it("accumulates delta events into streaming caption (stream)", () => {
    const s0 = initialAssistantState;
    const s1 = assistantReducer(s0, {
      type: "send",
      text: "Halo asisten",
      sendId: 1,
    });
    expect(s1.mode).toBe("thinking");
    expect(s1.currentSendId).toBe(1);
    expect(s1.streamingCaption).toBe("");
    expect(s1.messages).toEqual([{ role: "user", content: "Halo asisten" }]);

    const s2 = assistantReducer(s1, {
      type: "delta",
      data: "Halo",
      sendId: 1,
    });
    expect(s2.streamingCaption).toBe("Halo");

    const s3 = assistantReducer(s2, {
      type: "delta",
      data: " juga!",
      sendId: 1,
    });
    expect(s3.streamingCaption).toBe("Halo juga!");
    expect(s3.mode).toBe("thinking");
  });

  it("handles done event by setting mode to idle and appending message", () => {
    const s0: AssistantState = {
      ...initialAssistantState,
      mode: "thinking",
      currentSendId: 1,
      streamingCaption: "Halo juga!",
      messages: [{ role: "user", content: "Halo" }],
    };

    const s1 = assistantReducer(s0, {
      type: "done",
      data: { role: "assistant", content: "Halo juga!" },
      sendId: 1,
    });

    expect(s1.mode).toBe("idle");
    expect(s1.streamingCaption).toBe("Halo juga!");
    expect(s1.messages).toHaveLength(2);
    expect(s1.messages[1]).toEqual({
      role: "assistant",
      content: "Halo juga!",
    });
  });

  it("adds proposals and removes them on decide (approve / reject)", () => {
    const proposal: AssistantProposal = {
      id: "prop-123",
      summary: "Buat tugas “Beli teri”",
      name: "create_task",
      args: { title: "Beli teri" },
    };

    const s0: AssistantState = {
      ...initialAssistantState,
      mode: "thinking",
      currentSendId: 1,
    };

    const s1 = assistantReducer(s0, {
      type: "proposal",
      data: proposal,
      sendId: 1,
    });

    expect(s1.pendingProposals).toHaveLength(1);
    expect(s1.pendingProposals[0]).toEqual(proposal);

    // Reject or Approve dispatches decide with proposalId
    const s2 = assistantReducer(s1, {
      type: "decide",
      proposalId: "prop-123",
    });

    expect(s2.pendingProposals).toHaveLength(0);
  });

  it("ignores stale events from an older send", () => {
    // Send 1 started
    const s1 = assistantReducer(initialAssistantState, {
      type: "send",
      text: "Pertama",
      sendId: 1,
    });

    // Send 2 started before send 1 finished
    const s2 = assistantReducer(s1, {
      type: "send",
      text: "Kedua",
      sendId: 2,
    });

    expect(s2.currentSendId).toBe(2);
    expect(s2.messages).toHaveLength(2);

    // Stale delta from send 1
    const s3 = assistantReducer(s2, {
      type: "delta",
      data: "Teks lama",
      sendId: 1,
    });
    expect(s3.streamingCaption).toBe("");

    // Stale proposal from send 1
    const staleProp: AssistantProposal = {
      id: "prop-old",
      summary: "Usulan lama",
      name: "create_task",
      args: {},
    };
    const s4 = assistantReducer(s3, {
      type: "proposal",
      data: staleProp,
      sendId: 1,
    });
    expect(s4.pendingProposals).toHaveLength(0);

    // Stale done from send 1
    const s5 = assistantReducer(s4, {
      type: "done",
      data: { role: "assistant", content: "Jawaban lama" },
      sendId: 1,
    });
    expect(s5.mode).toBe("thinking"); // Stays thinking for send 2
    expect(s5.messages).toHaveLength(2);

    // Stale error from send 1
    const s6 = assistantReducer(s5, {
      type: "error",
      error: "Error lama",
      sendId: 1,
    });
    expect(s6.error).toBeNull();
    expect(s6.mode).toBe("thinking");

    // Valid delta from send 2
    const s7 = assistantReducer(s6, {
      type: "delta",
      data: "Teks baru",
      sendId: 2,
    });
    expect(s7.streamingCaption).toBe("Teks baru");

    // Valid done from send 2
    const s8 = assistantReducer(s7, {
      type: "done",
      data: { role: "assistant", content: "Teks baru" },
      sendId: 2,
    });
    expect(s8.mode).toBe("idle");
    expect(s8.messages).toHaveLength(3);
    expect(s8.messages[2].content).toBe("Teks baru");
  });

  it("stops and invalidates older in-flight events", () => {
    const s1 = assistantReducer(initialAssistantState, {
      type: "send",
      text: "Halo",
      sendId: 1,
    });
    expect(s1.mode).toBe("thinking");

    const s2 = assistantReducer(s1, { type: "stop" });
    expect(s2.mode).toBe("idle");
    expect(s2.currentSendId).toBe(2);

    // Event from stopped send 1 is ignored
    const s3 = assistantReducer(s2, {
      type: "delta",
      data: "Jangan muncul",
      sendId: 1,
    });
    expect(s3.streamingCaption).toBe("");
  });

  it("sets error and returns to idle mode", () => {
    const s1 = assistantReducer(initialAssistantState, {
      type: "send",
      text: "Pertanyaan",
      sendId: 1,
    });
    const s2 = assistantReducer(s1, {
      type: "error",
      error: "Ollama belum berjalan di 127.0.0.1:11434",
      sendId: 1,
    });

    expect(s2.mode).toBe("idle");
    expect(s2.error).toBe("Ollama belum berjalan di 127.0.0.1:11434");
  });
});

describe("decided", () => {
  it("confirms approvals and rejections in the caption and history", () => {
    const approved = assistantReducer(initialAssistantState, { type: "decided", summary: "Buat tugas “Beli teri”", approved: true });
    expect(approved.streamingCaption).toBe("✓ Buat tugas “Beli teri”");
    expect(approved.messages.at(-1)?.content).toBe("✓ Buat tugas “Beli teri”");
    const rejected = assistantReducer(initialAssistantState, { type: "decided", summary: "Buat tugas “Beli teri”", approved: false });
    expect(rejected.streamingCaption).toBe("Dibatalkan: Buat tugas “Beli teri”");
  });
});
