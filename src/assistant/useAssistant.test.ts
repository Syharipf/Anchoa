import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { api, type AiStatus, type AssistantEvent, type AssistantProposal, type AssistantReply } from "../api";
import { deferred, hookHarness } from "../test/hookHarness";
import {
  assistantReducer,
  initialAssistantState,
  useAssistant,
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

  it("adds proposals and removes them after a successful decision", () => {
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

    const s2 = assistantReducer(s1, {
      type: "decided",
      proposalId: "prop-123",
      summary: proposal.summary,
      approved: true,
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
    const approved = assistantReducer(initialAssistantState, { type: "decided", proposalId: "prop-123", summary: "Buat tugas “Beli teri”", approved: true });
    expect(approved.streamingCaption).toBe("✓ Buat tugas “Beli teri”");
    expect(approved.messages.at(-1)?.content).toBe("✓ Buat tugas “Beli teri”");
    const rejected = assistantReducer(initialAssistantState, { type: "decided", proposalId: "prop-123", summary: "Buat tugas “Beli teri”", approved: false });
    expect(rejected.streamingCaption).toBe("Dibatalkan: Buat tugas “Beli teri”");
  });
});

const proposal: AssistantProposal = {
  id: "proposal", name: "create_task", args: { title: "Beli teri" }, summary: "Buat tugas Beli teri",
};
const offline: AiStatus = { available: false, models: [], error: "Koneksi ditolak" };
const online: AiStatus = { available: true, models: ["qwen2.5:3b"], error: null };
const reply: AssistantReply = { message: { role: "assistant", content: "Halo" }, proposals: [] };

describe("useAssistant", () => {
  const spies: ReturnType<typeof spyOn>[] = [];
  let harness: ReturnType<typeof hookHarness<ReturnType<typeof useAssistant>>>;

  beforeEach(() => {
    spies.push(spyOn(api, "aiStatus").mockResolvedValue(online));
    spies.push(spyOn(api, "assistantPending").mockResolvedValue([proposal]));
  });
  afterEach(() => {
    harness?.dispose();
    spies.forEach((spy) => spy.mockRestore());
    spies.length = 0;
  });

  it("restores pending proposals on each mount", async () => {
    harness = hookHarness(() => useAssistant());
    harness.render();
    expect((await harness.settle()).pendingProposals).toEqual([proposal]);
    harness.dispose();
    harness = hookHarness(() => useAssistant());
    harness.render();
    expect((await harness.settle()).pendingProposals).toEqual([proposal]);
    expect(api.assistantPending).toHaveBeenCalledTimes(2);
  });

  it("restores pending proposals after StrictMode's cleanup and ignores the first snapshot", async () => {
    const first = deferred<AssistantProposal[]>();
    spies.push(spyOn(api, "assistantPending").mockReturnValueOnce(first.promise).mockResolvedValue([proposal]));
    harness = hookHarness(() => useAssistant());
    harness.render();
    harness.replayEffects();
    expect((await harness.settle()).pendingProposals).toEqual([proposal]);
    first.resolve([{ ...proposal, id: "stale" }]);
    expect((await harness.settle()).pendingProposals).toEqual([proposal]);
  });

  it.each([true, false])("keeps the card during a decision and after failure (approve: %s)", async (approve) => {
    const decision = deferred<null>();
    const decideSpy = spyOn(api, "assistantDecide").mockReturnValueOnce(decision.promise).mockResolvedValue(null);
    spies.push(decideSpy);
    let changes = 0;
    harness = hookHarness(() => useAssistant({ onChanged: () => { changes++; } }));
    harness.render();
    const assistant = await harness.settle();
    const pendingDecision = assistant.decide(proposal.id, approve);
    expect(harness.render().pendingProposals).toEqual([proposal]);
    decision.reject(new Error("Gagal menyimpan"));
    await expect(pendingDecision).rejects.toThrow("Gagal menyimpan");
    const failed = await harness.settle();
    expect(failed.pendingProposals).toEqual([proposal]);
    expect(failed.error).toBe("Gagal menyimpan");
    expect(changes).toBe(0);

    // Retry approval, or reject the proposal after an approval failure.
    await failed.decide(proposal.id, !approve);
    const recovered = await harness.settle();
    expect(recovered.pendingProposals).toEqual([]);
    expect(recovered.error).toBeNull();
    expect(changes).toBe(approve ? 0 : 1);
  });

  it("discards previous proposals on a new send and ignores a late mount snapshot", async () => {
    const pending = deferred<AssistantProposal[]>();
    spies.push(spyOn(api, "assistantPending").mockReturnValue(pending.promise));
    spies.push(spyOn(api, "assistantSend").mockResolvedValue(reply));
    harness = hookHarness(() => useAssistant());
    const assistant = harness.render();
    await assistant.send("Pesan baru");
    pending.resolve([proposal]);
    expect((await harness.settle()).pendingProposals).toEqual([]);
  });

  it("clears restored proposals when starting another send", async () => {
    spies.push(spyOn(api, "assistantSend").mockReturnValue(new Promise(() => {})));
    harness = hookHarness(() => useAssistant());
    harness.render();
    const assistant = await harness.settle();
    void assistant.send("Pesan baru");
    expect(harness.render().pendingProposals).toEqual([]);
  });

  it("guards concurrent sends and microphone mode changes while streaming", async () => {
    const sendSpy = spyOn(api, "assistantSend").mockReturnValue(new Promise(() => {}));
    spies.push(sendSpy);
    harness = hookHarness(() => useAssistant());
    const assistant = harness.render();
    void assistant.send("Pertama");
    void assistant.send("Kedua");
    harness.render().setMode("listening");
    expect(harness.render().mode).toBe("thinking");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("rechecks offline status after a successful send", async () => {
    const statusSpy = spyOn(api, "aiStatus").mockResolvedValueOnce(offline).mockResolvedValue(online);
    spies.push(statusSpy);
    spies.push(spyOn(api, "assistantSend").mockImplementation(async (_text, onEvent) => {
      onEvent({ type: "done", data: reply.message });
      return reply;
    }));
    harness = hookHarness(() => useAssistant());
    harness.render();
    const assistant = await harness.settle();
    expect(assistant.aiStatus).toEqual(offline);
    await assistant.send("Halo");
    expect((await harness.settle()).aiStatus).toEqual(online);
    expect(statusSpy).toHaveBeenCalledTimes(2);
  });

  it("rechecks status when the window regains focus and removes the listener on unmount", async () => {
    const statusSpy = spyOn(api, "aiStatus").mockResolvedValueOnce(offline).mockResolvedValue(online);
    spies.push(statusSpy);
    harness = hookHarness(() => useAssistant());
    harness.render();
    await harness.settle();
    harness.focus();
    expect((await harness.settle()).aiStatus).toEqual(online);
    expect(statusSpy).toHaveBeenCalledTimes(2);
    harness.dispose();
    harness.focus();
    expect(statusSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps the recovered status when an older offline check finishes later", async () => {
    const oldStatus = deferred<AiStatus>();
    spies.push(spyOn(api, "aiStatus").mockReturnValueOnce(oldStatus.promise).mockResolvedValue(online));
    harness = hookHarness(() => useAssistant());
    harness.render();
    harness.focus();
    expect((await harness.settle()).aiStatus).toEqual(online);
    oldStatus.resolve(offline);
    expect((await harness.settle()).aiStatus).toEqual(online);
  });

  it("polls every 30 seconds while offline and stops polling once available", async () => {
    const statusSpy = spyOn(api, "aiStatus")
      .mockResolvedValueOnce(offline).mockResolvedValueOnce(offline).mockResolvedValue(online);
    spies.push(statusSpy);
    harness = hookHarness(() => useAssistant());
    harness.render();
    await harness.settle();
    expect(harness.intervalDelays()).toEqual([30_000]);
    harness.runTimers();
    await harness.settle();
    expect(statusSpy).toHaveBeenCalledTimes(2);
    harness.runTimers();
    expect((await harness.settle()).aiStatus).toEqual(online);
    expect(harness.intervalDelays()).toEqual([]);
    harness.runTimers();
    expect(statusSpy).toHaveBeenCalledTimes(3);
  });

  it("cleans up offline polling on unmount", async () => {
    spies.push(spyOn(api, "aiStatus").mockResolvedValue(offline));
    harness = hookHarness(() => useAssistant());
    harness.render();
    await harness.settle();
    expect(harness.intervalDelays()).toEqual([30_000]);
    harness.dispose();
    expect(harness.intervalDelays()).toEqual([]);
  });
});

describe("microphone and voice flow in useAssistant", () => {
  const spies: ReturnType<typeof spyOn>[] = [];
  let harness: ReturnType<typeof hookHarness<ReturnType<typeof useAssistant>>> | null = null;

  const installedVoiceStatus = {
    pwRecord: true,
    pwPlay: true,
    whisper: "/usr/bin/whisper-cli",
    whisperModel: true,
    piper: true,
    voices: [
      {
        id: "id_ID-news_tts-medium",
        label: "Indonesia · News",
        language: "id_ID",
        quality: "medium",
        installed: true,
        imported: false,
        params: { lengthScale: 1.0, noiseScale: 0.667, noiseW: 0.8 },
      },
    ],
    settings: {
      id: "id_ID-news_tts-medium",
      params: { lengthScale: 1.0, noiseScale: 0.667, noiseW: 0.8 },
    },
    recording: false,
    speaking: false,
  };

  const missingVoiceStatus = {
    ...installedVoiceStatus,
    whisperModel: false,
  };

  beforeEach(() => {
    spies.push(spyOn(api, "assistantPending").mockResolvedValue([]));
    spies.push(spyOn(api, "aiStatus").mockResolvedValue({ available: true, models: ["qwen2.5:3b"], error: null }));
    spies.push(spyOn(api, "assistantStop").mockResolvedValue(undefined));
    spies.push(spyOn(api, "assistantReset").mockResolvedValue(undefined));
    spies.push(spyOn(api, "voiceStop").mockResolvedValue(undefined));
  });

  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
    spies.length = 0;
    if (harness) {
      harness.dispose();
      harness = null;
    }
  });

  it("sets voiceMissing and does not start recording when voice parts are not installed", async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(missingVoiceStatus));
    const startSpy = spyOn(api, "voiceRecordStart").mockResolvedValue(undefined);
    spies.push(startSpy);

    harness = hookHarness(() => useAssistant());
    harness.render();
    await harness.settle();

    const assistant = harness.render();
    expect(assistant.voiceMissing).toBe(false);
    expect(assistant.mode).toBe("idle");

    await assistant.toggleMic();
    const updated = await harness.settle();
    expect(updated.voiceMissing).toBe(true);
    expect(updated.mode).toBe("idle");
    expect(startSpy).not.toHaveBeenCalled();
  });

  it("starts recording and enters listening mode when voice parts are installed", async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(installedVoiceStatus));
    const startSpy = spyOn(api, "voiceRecordStart").mockResolvedValue(undefined);
    spies.push(startSpy);

    harness = hookHarness(() => useAssistant());
    harness.render();
    await harness.settle();

    const assistant = harness.render();
    await assistant.toggleMic();
    const listening = await harness.settle();

    expect(listening.mode).toBe("listening");
    expect(listening.voiceMissing).toBe(false);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("stops recording on second press, sends transcript, speaks reply, and goes idle with caption intact", async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(installedVoiceStatus));
    spies.push(spyOn(api, "voiceRecordStart").mockResolvedValue(undefined));
    spies.push(spyOn(api, "voiceRecordStop").mockResolvedValue("Halo anchoa"));

    const reply: AssistantReply = {
      message: { role: "assistant", content: "Halo juga, ada yang bisa kubantu?" },
      proposals: [],
    };
    spies.push(spyOn(api, "assistantSend").mockImplementation(async (_text, onEvent) => {
      onEvent({ type: "delta", data: "Halo juga" });
      onEvent({ type: "done", data: reply.message });
      return reply;
    }));

    const speechDeferred = deferred<void>();
    const speakSpy = spyOn(api, "voiceSpeak").mockReturnValue(speechDeferred.promise);
    spies.push(speakSpy);

    harness = hookHarness(() => useAssistant());
    harness.render();
    await harness.settle();

    // First press -> listening
    await harness.render().toggleMic();
    expect(harness.render().mode).toBe("listening");

    // Second press -> stops recording, sends to assistant, then speaks
    const togglePromise = harness.render().toggleMic();
    await harness.settle();

    // Mode should be speaking while voiceSpeak is running
    expect(harness.render().mode).toBe("speaking");
    expect(harness.render().streamingCaption).toBe("Halo juga, ada yang bisa kubantu?");
    expect(harness.render().messages).toEqual([
      { role: "user", content: "Halo anchoa" }, reply.message,
    ]);
    expect(speakSpy).toHaveBeenCalledWith("Halo juga, ada yang bisa kubantu?");

    // Complete speaking
    speechDeferred.resolve();
    await togglePromise;
    const finalState = await harness.settle();

    expect(finalState.mode).toBe("idle");
    expect(finalState.streamingCaption).toBe("Halo juga, ada yang bisa kubantu?");
  });

  it("stops speech and returns to idle when mic is pressed during speaking mode", async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(installedVoiceStatus));
    spies.push(spyOn(api, "voiceRecordStart").mockResolvedValue(undefined));
    spies.push(spyOn(api, "voiceRecordStop").mockResolvedValue("Pertanyaan"));

    const reply: AssistantReply = {
      message: { role: "assistant", content: "Jawaban panjang" },
      proposals: [],
    };
    spies.push(spyOn(api, "assistantSend").mockResolvedValue(reply));

    const speechDeferred = deferred<void>();
    spies.push(spyOn(api, "voiceSpeak").mockReturnValue(speechDeferred.promise));
    const stopSpy = spyOn(api, "voiceStop").mockResolvedValue(undefined);
    spies.push(stopSpy);

    harness = hookHarness(() => useAssistant());
    harness.render();
    await harness.settle();

    // Start recording
    await harness.render().toggleMic();
    // Stop recording and start speaking
    void harness.render().toggleMic();
    await harness.settle();
    expect(harness.render().mode).toBe("speaking");

    // Press mic while speaking -> stops voice
    await harness.render().toggleMic();
    speechDeferred.resolve();
    await harness.settle();

    expect(stopSpy).toHaveBeenCalled();
    expect(harness.render().mode).toBe("idle");
    expect(harness.render().streamingCaption).toBe("Jawaban panjang");
  });

  it("handles empty transcript by resetting to idle without sending", async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(installedVoiceStatus));
    spies.push(spyOn(api, "voiceRecordStart").mockResolvedValue(undefined));
    spies.push(spyOn(api, "voiceRecordStop").mockResolvedValue("   "));
    const sendSpy = spyOn(api, "assistantSend").mockResolvedValue({
      message: { role: "assistant", content: "" },
      proposals: [],
    });
    spies.push(sendSpy);

    harness = hookHarness(() => useAssistant());
    harness.render();
    await harness.settle();

    await harness.render().toggleMic();
    expect(harness.render().mode).toBe("listening");

    await harness.render().toggleMic();
    await harness.settle();

    expect(harness.render().mode).toBe("idle");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("handles voiceRecordStop failure gracefully", async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(installedVoiceStatus));
    spies.push(spyOn(api, "voiceRecordStart").mockResolvedValue(undefined));
    spies.push(spyOn(api, "voiceRecordStop").mockRejectedValue(new Error("Transkripsi gagal")));

    harness = hookHarness(() => useAssistant());
    harness.render();
    await harness.settle();

    await harness.render().toggleMic();
    expect(harness.render().mode).toBe("listening");

    await harness.render().toggleMic();
    const failed = await harness.settle();

    expect(failed.mode).toBe("idle");
    expect(failed.error).toBe("Transkripsi gagal");
  });

  const mountListening = async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(installedVoiceStatus));
    spies.push(spyOn(api, "voiceRecordStart").mockResolvedValue(undefined));
    harness = hookHarness(() => useAssistant());
    harness.render();
    await harness.settle();
    await harness.render().toggleMic();
    expect(harness.render().mode).toBe("listening");
  };

  it.each(["stop", "reset", "unmount"])("stops the recorder and discards its transcript on %s", async (action) => {
    const transcript = deferred<string>();
    const recordStop = spyOn(api, "voiceRecordStop").mockReturnValue(transcript.promise);
    const send = spyOn(api, "assistantSend").mockResolvedValue(reply);
    const speak = spyOn(api, "voiceSpeak").mockResolvedValue(undefined);
    spies.push(recordStop, send, speak);
    await mountListening();
    if (action === "unmount") harness!.dispose();
    else void harness!.render()[action as "stop" | "reset"]();
    expect(recordStop).toHaveBeenCalledTimes(1);
    transcript.resolve("Ne jamais envoyer");
    await transcript.promise;
    if (action !== "unmount") {
      await harness!.settle();
      await harness!.render().toggleMic();
      expect(harness!.render().mode).toBe("listening");
    }
    expect(send).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
    expect(api.voiceStop).toHaveBeenCalled();
  });

  it("uses thinking during transcription and guards repeated mic presses and typed sends", async () => {
    const transcript = deferred<string>();
    const recordStop = spyOn(api, "voiceRecordStop").mockReturnValue(transcript.promise);
    const send = spyOn(api, "assistantSend").mockResolvedValue(reply);
    spies.push(recordStop, send);
    await mountListening();
    const assistant = harness!.render();
    await assistant.send("Typed during recording");
    const recording = assistant.toggleMic();
    expect(harness!.render().mode).toBe("thinking");
    await assistant.toggleMic(); // Also guard a handler captured before the render.
    await harness!.render().send("Typed during transcription");
    expect(recordStop).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    transcript.resolve("");
    await recording;
    expect(harness!.render().mode).toBe("idle");
  });

  it.each(["stop", "reset", "unmount"])("does not send a pending transcription after %s", async (action) => {
    const transcript = deferred<string>();
    const send = spyOn(api, "assistantSend").mockResolvedValue(reply);
    const speak = spyOn(api, "voiceSpeak").mockResolvedValue(undefined);
    spies.push(spyOn(api, "voiceRecordStop").mockReturnValue(transcript.promise), send, speak);
    await mountListening();
    const recording = harness!.render().toggleMic();
    if (action === "unmount") harness!.dispose();
    else void harness!.render()[action as "stop" | "reset"]();
    transcript.resolve("Cancelled transcript");
    await recording;
    expect(send).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it.each(["stop", "reset", "unmount"])("drains a recorder whose start finishes after %s", async (action) => {
    const start = deferred<void>();
    const recordStop = spyOn(api, "voiceRecordStop").mockResolvedValue("Discard");
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(installedVoiceStatus),
      spyOn(api, "voiceRecordStart").mockReturnValue(start.promise), recordStop);
    harness = hookHarness(() => useAssistant());
    harness.render();
    await harness.settle();
    const starting = harness.render().toggleMic();
    await harness.settle();
    if (action === "unmount") harness.dispose();
    else void harness.render()[action as "stop" | "reset"]();
    start.resolve();
    await starting;
    expect(recordStop).toHaveBeenCalledTimes(1);
    if (action !== "unmount") expect(harness.render().mode).toBe("idle");
  });

  it("keeps thinking on channel completion, appends once, and ignores late callbacks after unmount", async () => {
    const response = deferred<AssistantReply>();
    let onEvent!: (event: AssistantEvent) => void;
    const speak = spyOn(api, "voiceSpeak").mockResolvedValue(undefined);
    spies.push(spyOn(api, "voiceRecordStop").mockResolvedValue("Halo"), speak,
      spyOn(api, "assistantSend").mockImplementation((_text, callback) => {
        onEvent = callback;
        return response.promise;
      }));
    await mountListening();
    const recording = harness!.render().toggleMic();
    await harness!.settle();
    onEvent({ type: "done", data: reply.message });
    expect(harness!.render().mode).toBe("thinking");
    expect(harness!.render().messages).toHaveLength(2);
    onEvent({ type: "done", data: reply.message });
    expect(harness!.render().messages).toHaveLength(2);
    harness!.dispose();
    onEvent({ type: "delta", data: "Stale caption" });
    response.resolve(reply);
    await recording;
    expect(speak).not.toHaveBeenCalled();
  });

  it("keeps a new recording listening when stopped speech completes late", async () => {
    const speech = deferred<void>();
    spies.push(spyOn(api, "voiceRecordStop").mockResolvedValue("Halo"),
      spyOn(api, "assistantSend").mockResolvedValue(reply),
      spyOn(api, "voiceSpeak").mockReturnValue(speech.promise));
    await mountListening();
    const recording = harness!.render().toggleMic();
    await harness!.settle();
    expect(harness!.render().mode).toBe("speaking");
    await harness!.render().toggleMic();
    await harness!.render().toggleMic();
    expect(harness!.render().mode).toBe("listening");
    speech.resolve();
    await recording;
    expect(harness!.render().mode).toBe("listening");
  });

  it("refreshes missing voice components on a mic press without remounting", async () => {
    const status = spyOn(api, "voiceStatus").mockResolvedValueOnce(missingVoiceStatus)
      .mockResolvedValue(installedVoiceStatus);
    spies.push(status, spyOn(api, "voiceRecordStart").mockResolvedValue(undefined));
    harness = hookHarness(() => useAssistant());
    harness.render();
    await harness.settle();
    await harness.render().toggleMic();
    expect(harness.render().mode).toBe("listening");
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("waits for a cancelled start to drain before starting a new recording", async () => {
    const oldStart = deferred<void>();
    const oldStop = deferred<string>();
    const start = spyOn(api, "voiceRecordStart").mockReturnValueOnce(oldStart.promise).mockResolvedValue(undefined);
    const recordStop = spyOn(api, "voiceRecordStop").mockReturnValue(oldStop.promise);
    spies.push(start, recordStop, spyOn(api, "voiceStatus").mockResolvedValue(installedVoiceStatus));
    harness = hookHarness(() => useAssistant());
    harness.render();
    await harness.settle();
    const first = harness.render().toggleMic();
    const stopping = harness.render().stop();
    const next = harness.render().toggleMic();
    oldStart.resolve();
    await harness.settle();
    expect(recordStop).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(harness.render().mode).toBe("thinking");
    oldStop.resolve("Discard old interaction");
    await Promise.all([first, stopping, next]);
    expect(start).toHaveBeenCalledTimes(2);
    expect(harness.render().mode).toBe("listening");
  });

  it("ignores a late reply failure and channel events while a newer recording listens", async () => {
    const oldReply = deferred<AssistantReply>();
    let onEvent!: (event: AssistantEvent) => void;
    const speak = spyOn(api, "voiceSpeak").mockResolvedValue(undefined);
    spies.push(spyOn(api, "voiceRecordStop").mockResolvedValue("Halo"), speak,
      spyOn(api, "assistantSend").mockImplementation((_text, callback) => {
        onEvent = callback;
        return oldReply.promise;
      }));
    await mountListening();
    const first = harness!.render().toggleMic();
    await harness!.settle();
    await harness!.render().stop();
    await harness!.render().toggleMic();
    onEvent({ type: "delta", data: "Stale" });
    onEvent({ type: "proposal", data: proposal });
    onEvent({ type: "done", data: reply.message });
    onEvent({ type: "error", data: "Stale channel error" });
    oldReply.reject(new Error("Stale reply failure"));
    await first;
    expect(harness!.render().mode).toBe("listening");
    expect(harness!.render().messages).toEqual([{ role: "user", content: "Halo" }]);
    expect(harness!.render().error).toBeNull();
    expect(harness!.render().streamingCaption).toBe("");
    expect(harness!.render().pendingProposals).toEqual([]);
    expect(speak).not.toHaveBeenCalled();
  });
});
