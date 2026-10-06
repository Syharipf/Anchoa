import { useCallback, useEffect, useRef, useState } from "react";
import {
  AI_CONFIG_CHANGED,
  api,
  errorMessage,
  type AiStatus,
  type AssistantDecision,
  type AssistantEvent,
  type AssistantMessage,
  type AssistantProposal,
  type VoiceStatus,
} from "../api";
import { isVoiceInstalled } from "../settings/view";

export type AssistantMode = "idle" | "thinking" | "listening" | "speaking";

export interface AssistantState {
  readonly mode: AssistantMode;
  readonly messages: readonly AssistantMessage[];
  readonly streamingCaption: string;
  readonly pendingProposals: readonly AssistantProposal[];
  readonly error: string | null;
  readonly currentSendId: number;
  readonly voiceMissing: boolean;
}

export type AssistantAction =
  | { type: "send"; text: string; sendId: number }
  | { type: "speak"; text: string; sendId: number }
  | { type: "delta"; data: string; sendId: number }
  | { type: "proposal"; data: AssistantProposal; sendId: number }
  | { type: "done"; data: AssistantMessage; sendId: number; mode?: AssistantMode }
  | { type: "begin_interaction"; sendId: number }
  | { type: "error"; error: string; sendId: number }
  | { type: "pending"; data: AssistantProposal[]; sendId: number }
  | { type: "failure"; error: string; sendId: number }
  | { type: "decided"; proposalId: string; summary: string; approved: boolean }
  | { type: "set_mode"; mode: AssistantMode }
  | { type: "stop" }
  | { type: "clear_error" }
  | { type: "reset" }
  | { type: "voice_missing"; missing: boolean }
  | { type: "clear_voice_missing" };

export const initialAssistantState: AssistantState = {
  mode: "idle",
  messages: [],
  streamingCaption: "",
  pendingProposals: [],
  error: null,
  currentSendId: 0,
  voiceMissing: false,
};

export function assistantReducer(
  state: AssistantState,
  action: AssistantAction,
): AssistantState {
  switch (action.type) {
    case "begin_interaction":
      return { ...state, mode: "thinking", currentSendId: action.sendId, error: null, voiceMissing: false };
    case "speak":
      return { ...state, mode: "speaking", streamingCaption: action.text, currentSendId: action.sendId, error: null, voiceMissing: false };
    case "send":
      return {
        ...state,
        mode: "thinking",
        currentSendId: action.sendId,
        streamingCaption: "",
        pendingProposals: [],
        error: null,
        voiceMissing: false,
        messages: [...state.messages, { role: "user", content: action.text }],
      };
    case "delta":
      if (action.sendId !== state.currentSendId) return state;
      return {
        ...state,
        streamingCaption: state.streamingCaption + action.data,
      };
    case "proposal":
      if (action.sendId !== state.currentSendId) return state;
      if (state.pendingProposals.some((p) => p.id === action.data.id)) return state;
      return {
        ...state,
        pendingProposals: [...state.pendingProposals, action.data],
      };
    case "done": {
      if (action.sendId !== state.currentSendId) return state;
      const nextMessages = action.data.content
        ? [...state.messages, action.data]
        : state.messages;
      return {
        ...state,
        mode: action.mode ?? "idle",
        streamingCaption: action.data.content || state.streamingCaption,
        messages: nextMessages,
      };
    }
    case "error":
      if (action.sendId !== state.currentSendId) return state;
      return {
        ...state,
        mode: "idle",
        error: action.error,
      };
    case "pending":
      if (action.sendId !== state.currentSendId) return state;
      return { ...state, pendingProposals: action.data };
    case "failure":
      if (action.sendId !== state.currentSendId) return state;
      return {
        ...state,
        error: action.error,
      };
    case "decided": {
      // The model is not asked again after a decision, so the caption confirms what happened.
      const note = action.approved ? `✓ ${action.summary}` : `Dibatalkan: ${action.summary}`;
      return {
        ...state,
        streamingCaption: note,
        pendingProposals: state.pendingProposals.filter((p) => p.id !== action.proposalId),
        error: null,
        messages: [...state.messages, { role: "assistant", content: note }],
      };
    }
    case "set_mode":
      return {
        ...state,
        mode: action.mode,
        voiceMissing: action.mode !== "idle" ? false : state.voiceMissing,
      };
    case "stop":
      return {
        ...state,
        mode: "idle",
        voiceMissing: false,
        currentSendId: state.currentSendId + 1,
      };
    case "clear_error":
      return {
        ...state,
        error: null,
      };
    case "reset":
      return {
        ...initialAssistantState,
        currentSendId: state.currentSendId + 1,
      };
    case "voice_missing":
      return {
        ...state,
        voiceMissing: action.missing,
      };
    case "clear_voice_missing":
      return {
        ...state,
        voiceMissing: false,
      };
    default:
      return state;
  }
}

export interface UseAssistantOptions {
  readonly onChanged?: () => void;
}

export function useAssistant(options?: UseAssistantOptions) {
  const [state, setState] = useState<AssistantState>(initialAssistantState);
  const stateRef = useRef(state);
  const mountedRef = useRef(true);
  // One token owns recording, transcription, the reply channel, and playback.
  const interactionRef = useRef(0);
  const recorderTaskRef = useRef<Promise<unknown> | null>(null);
  const recordingRef = useRef(false);
  const cleanupRef = useRef<Promise<void> | null>(null);
  const dispatch = useCallback((action: AssistantAction) => {
    if (!mountedRef.current) return;
    stateRef.current = assistantReducer(stateRef.current, action);
    setState(stateRef.current);
  }, []);
  const isCurrent = useCallback((token: number) =>
    mountedRef.current && interactionRef.current === token, []);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);
  const statusCheckIdRef = useRef(0);
  const voiceCheckIdRef = useRef(0);

  const checkStatus = useCallback(async () => {
    const checkId = ++statusCheckIdRef.current;
    try {
      const status = await api.aiStatus();
      if (mountedRef.current && checkId === statusCheckIdRef.current) setAiStatus(status);
      return status;
    } catch (e) {
      const fallback: AiStatus = { available: false, models: [], error: errorMessage(e) };
      if (mountedRef.current && checkId === statusCheckIdRef.current) setAiStatus(fallback);
      return fallback;
    }
  }, []);

  const checkVoiceStatus = useCallback(async () => {
    const checkId = ++voiceCheckIdRef.current;
    try {
      const status = await api.voiceStatus();
      if (mountedRef.current && checkId === voiceCheckIdRef.current) setVoiceStatus(status);
      return status;
    } catch {
      if (mountedRef.current && checkId === voiceCheckIdRef.current) setVoiceStatus(null);
      return null;
    }
  }, []);

  const cancelOperations = useCallback((reset = false) => {
    // voiceStop only stops speech. Drain pw-record separately and discard STT.
    if (recordingRef.current) {
      recordingRef.current = false;
      recorderTaskRef.current = api.voiceRecordStop().catch(() => {});
    }
    const cleanup = Promise.allSettled([
      cleanupRef.current,
      recorderTaskRef.current,
      reset ? api.assistantReset() : api.assistantStop(),
      api.voiceStop(),
    ]).then(() => {});
    cleanupRef.current = cleanup;
    return cleanup;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void checkStatus();
    void checkVoiceStatus();
    const onFocus = () => {
      void checkStatus();
      void checkVoiceStatus();
    };
    const onConfigChanged = (event: Event) => {
      setAiStatus(null);
      if ((event as CustomEvent<{ reset?: boolean }>).detail?.reset) {
        interactionRef.current++;
        dispatch({ type: "reset" });
        // Rust already reset assistant state; stop only drains local voice/recording.
        void cancelOperations();
      }
      void checkStatus();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(AI_CONFIG_CHANGED, onConfigChanged);
    return () => {
      mountedRef.current = false;
      interactionRef.current++;
      statusCheckIdRef.current++;
      voiceCheckIdRef.current++;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(AI_CONFIG_CHANGED, onConfigChanged);
      void cancelOperations();
    };
  }, [checkStatus, checkVoiceStatus, cancelOperations, dispatch]);

  useEffect(() => {
    if (aiStatus?.available !== false) return;
    const timer = window.setInterval(() => { void checkStatus(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [aiStatus?.available, checkStatus]);

  useEffect(() => {
    const token = interactionRef.current;
    const sendId = stateRef.current.currentSendId;
    api.assistantPending().then(
      (data) => { if (isCurrent(token)) dispatch({ type: "pending", data, sendId }); },
      (e) => { if (isCurrent(token)) dispatch({ type: "failure", error: errorMessage(e), sendId }); },
    );
  }, [dispatch, isCurrent]);

  const sendInteraction = useCallback(async (text: string, token: number, voice: boolean) => {
    if (!isCurrent(token)) return;
    dispatch({ type: "send", text, sendId: token });
    let completed = false;
    let failed = false;
    const complete = (message: AssistantMessage) => {
      if (completed || failed || !isCurrent(token)) return;
      completed = true;
      dispatch({ type: "done", data: message, sendId: token, mode: voice ? "thinking" : "idle" });
    };
    try {
      const reply = await api.assistantSend(text, (event: AssistantEvent) => {
        if (!isCurrent(token) || failed) return;
        switch (event.type) {
          case "delta":
            if (!completed) dispatch({ type: "delta", data: event.data, sendId: token });
            break;
          case "proposal":
            dispatch({ type: "proposal", data: event.data, sendId: token });
            break;
          case "done":
            complete(event.data);
            break;
          case "error":
            failed = true;
            dispatch({ type: "error", error: event.data, sendId: token });
            break;
        }
      });
      if (!isCurrent(token)) return;
      void checkStatus();
      if (failed) return;
      complete(reply.message);
      if (!voice || !reply.message.content.trim()) {
        dispatch({ type: "set_mode", mode: "idle" });
        return;
      }
      dispatch({ type: "set_mode", mode: "speaking" });
      try {
        await api.voiceSpeak(reply.message.content.trim());
        if (!isCurrent(token)) return;
      } catch {
        if (!isCurrent(token)) return;
      }
      dispatch({ type: "set_mode", mode: "idle" });
    } catch (e) {
      if (!isCurrent(token)) return;
      dispatch({ type: "error", error: errorMessage(e), sendId: token });
      void checkStatus();
    }
  }, [checkStatus, dispatch, isCurrent]);

  const startSend = useCallback(async (text: string, voice: boolean) => {
    const trimmed = text.trim();
    if (!trimmed || !mountedRef.current ||
        stateRef.current.mode === "thinking" || stateRef.current.mode === "listening") return;
    if (stateRef.current.mode === "speaking") void cancelOperations();
    const token = ++interactionRef.current;
    dispatch({ type: "begin_interaction", sendId: token });
    if (cleanupRef.current) {
      await cleanupRef.current;
      if (!isCurrent(token)) return;
    }
    await sendInteraction(trimmed, token, voice);
    if (!isCurrent(token)) return;
  }, [cancelOperations, dispatch, isCurrent, sendInteraction]);
  const send = useCallback((text: string) => startSend(text, false), [startSend]);
  const sendVoice = useCallback((text: string) => startSend(text, true), [startSend]);

  const speak = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !mountedRef.current ||
        stateRef.current.mode === "thinking" || stateRef.current.mode === "listening") return;
    if (stateRef.current.mode === "speaking") void cancelOperations();
    const token = ++interactionRef.current;
    dispatch({ type: "begin_interaction", sendId: token });
    if (cleanupRef.current) {
      await cleanupRef.current;
      if (!isCurrent(token)) return;
    }
    const status = voiceStatus ?? await checkVoiceStatus();
    if (!isCurrent(token)) return;
    if (!status?.pwPlay || !status.piper ||
        !status.voices.some((voice) => voice.id === status.settings.id && voice.installed)) {
      dispatch({ type: "set_mode", mode: "idle" });
      dispatch({ type: "voice_missing", missing: true });
      return;
    }
    dispatch({ type: "speak", text: trimmed, sendId: token });
    try {
      await api.voiceSpeak(trimmed);
      if (isCurrent(token)) dispatch({ type: "set_mode", mode: "idle" });
    } catch (e) {
      if (isCurrent(token)) dispatch({ type: "error", error: errorMessage(e), sendId: token });
    }
  }, [cancelOperations, checkVoiceStatus, dispatch, isCurrent, voiceStatus]);

  const stop = useCallback(async () => {
    const token = ++interactionRef.current;
    dispatch({ type: "stop" });
    await cancelOperations();
    if (!isCurrent(token)) return;
    // Cancellation has no completion callback that can change a newer mode.
  }, [cancelOperations, dispatch, isCurrent]);

  const transcribeInteraction = useCallback(async (token: number) => {
    dispatch({ type: "set_mode", mode: "thinking" });
    recordingRef.current = false;
    try {
      const task = api.voiceRecordStop();
      recorderTaskRef.current = task;
      const transcript = await task;
      if (!isCurrent(token)) return;
      if (!transcript.trim()) {
        dispatch({ type: "set_mode", mode: "idle" });
        return;
      }
      await sendInteraction(transcript.trim(), token, true);
      if (!isCurrent(token)) return;
    } catch (e) {
      if (!isCurrent(token)) return;
      dispatch({ type: "error", error: errorMessage(e), sendId: token });
    }
  }, [dispatch, isCurrent, sendInteraction]);

  const recordInteraction = useCallback(async () => {
    const token = ++interactionRef.current;
    dispatch({ type: "begin_interaction", sendId: token });
    // A cancelled start must finish and drain before another start can acquire pw-record.
    if (cleanupRef.current) {
      await cleanupRef.current;
      if (!isCurrent(token)) return;
    }
    let status = voiceStatus;
    if (!isVoiceInstalled(status)) {
      status = await checkVoiceStatus();
      if (!isCurrent(token)) return;
    }
    if (!isVoiceInstalled(status)) {
      dispatch({ type: "set_mode", mode: "idle" });
      dispatch({ type: "voice_missing", missing: true });
      return;
    }
    const task = (async () => {
      try {
        await api.voiceRecordStart();
        if (!isCurrent(token)) {
          return api.voiceRecordStop().catch(() => {});
        }
        recordingRef.current = true;
        dispatch({ type: "set_mode", mode: "listening" });
      } catch (e) {
        if (!isCurrent(token)) return;
        dispatch({ type: "error", error: errorMessage(e), sendId: token });
      }
    })();
    recorderTaskRef.current = task;
    await task;
    if (!isCurrent(token)) return;
  }, [voiceStatus, checkVoiceStatus, dispatch, isCurrent]);

  const toggleMic = useCallback(async () => {
    if (!mountedRef.current) return;
    switch (stateRef.current.mode) {
      case "speaking": return stop();
      case "thinking": return;
      case "listening": return transcribeInteraction(interactionRef.current);
      case "idle": return recordInteraction();
    }
  }, [stop, transcribeInteraction, recordInteraction]);

  const decide = useCallback(
    async (id: string, approve: boolean): Promise<AssistantDecision> => {
      const summary = stateRef.current.pendingProposals.find((p) => p.id === id)?.summary ?? "Usulan";
      const token = interactionRef.current;
      let result: AssistantDecision;
      try {
        result = await api.assistantDecide(id, approve);
        if (!isCurrent(token)) return result;
      } catch (e) {
        if (isCurrent(token)) dispatch({ type: "failure", error: errorMessage(e), sendId: token });
        throw e;
      }
      dispatch({ type: "decided", proposalId: id, summary, approved: approve });
      if (approve) options?.onChanged?.();
      return result;
    }, [options, dispatch, isCurrent],
  );

  const setMode = useCallback((mode: AssistantMode) => {
    if (stateRef.current.mode === "thinking") return;
    dispatch({ type: "set_mode", mode });
  }, [dispatch]);
  const clearError = useCallback(() => { dispatch({ type: "clear_error" }); }, [dispatch]);
  const clearVoiceMissing = useCallback(() => { dispatch({ type: "clear_voice_missing" }); }, [dispatch]);
  const reset = useCallback(async () => {
    const token = ++interactionRef.current;
    dispatch({ type: "reset" });
    await cancelOperations(true);
    if (!isCurrent(token)) return;
  }, [cancelOperations, dispatch, isCurrent]);

  return {
    ...state, aiStatus, voiceStatus, checkStatus, checkVoiceStatus,
    send, sendVoice, speak, toggleMic, stop, decide, setMode, clearError, clearVoiceMissing, reset,
  };
}
