import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  errorMessage,
  type AiStatus,
  type AssistantDecision,
  type AssistantEvent,
  type AssistantMessage,
  type AssistantProposal,
} from "../api";

export type AssistantMode = "idle" | "thinking" | "listening" | "speaking";

export interface AssistantState {
  readonly mode: AssistantMode;
  readonly messages: readonly AssistantMessage[];
  readonly streamingCaption: string;
  readonly pendingProposals: readonly AssistantProposal[];
  readonly error: string | null;
  readonly currentSendId: number;
}

export type AssistantAction =
  | { type: "send"; text: string; sendId: number }
  | { type: "delta"; data: string; sendId: number }
  | { type: "proposal"; data: AssistantProposal; sendId: number }
  | { type: "done"; data: AssistantMessage; sendId: number }
  | { type: "error"; error: string; sendId: number }
  | { type: "pending"; data: AssistantProposal[]; sendId: number }
  | { type: "failure"; error: string; sendId: number }
  | { type: "decided"; proposalId: string; summary: string; approved: boolean }
  | { type: "set_mode"; mode: AssistantMode }
  | { type: "stop" }
  | { type: "clear_error" }
  | { type: "reset" };

export const initialAssistantState: AssistantState = {
  mode: "idle",
  messages: [],
  streamingCaption: "",
  pendingProposals: [],
  error: null,
  currentSendId: 0,
};

export function assistantReducer(
  state: AssistantState,
  action: AssistantAction,
): AssistantState {
  switch (action.type) {
    case "send":
      return {
        ...state,
        mode: "thinking",
        currentSendId: action.sendId,
        streamingCaption: "",
        pendingProposals: [],
        error: null,
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
        mode: "idle",
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
      };
    case "stop":
      return {
        ...state,
        mode: "idle",
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
    default:
      return state;
  }
}

export interface UseAssistantOptions {
  readonly onChanged?: () => void;
}

export function useAssistant(options?: UseAssistantOptions) {
  const [state, setState] = useState<AssistantState>(initialAssistantState);
  const dispatch = useCallback((action: AssistantAction) => {
    setState((prev) => assistantReducer(prev, action));
  }, []);
  const sendIdRef = useRef(0);
  const sendingRef = useRef(false);
  const proposalsRef = useRef(state.pendingProposals);
  proposalsRef.current = state.pendingProposals;
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const statusCheckIdRef = useRef(0);

  const checkStatus = useCallback(async () => {
    const checkId = ++statusCheckIdRef.current;
    try {
      const status = await api.aiStatus();
      if (checkId === statusCheckIdRef.current) setAiStatus(status);
      return status;
    } catch (e) {
      const fallback: AiStatus = {
        available: false,
        models: [],
        error: errorMessage(e),
      };
      if (checkId === statusCheckIdRef.current) setAiStatus(fallback);
      return fallback;
    }
  }, []);

  useEffect(() => {
    void checkStatus();
    const onFocus = () => { void checkStatus(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [checkStatus]);

  useEffect(() => {
    if (aiStatus?.available !== false) return;
    const timer = window.setInterval(() => { void checkStatus(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [aiStatus?.available, checkStatus]);

  useEffect(() => {
    let mounted = true;
    const sendId = sendIdRef.current;
    api.assistantPending().then(
      (data) => {
        if (mounted) dispatch({ type: "pending", data, sendId });
      },
      (e) => {
        if (mounted) dispatch({ type: "failure", error: errorMessage(e), sendId });
      },
    );
    return () => { mounted = false; };
  }, [dispatch]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sendingRef.current) return;
      sendingRef.current = true;
      const sendId = ++sendIdRef.current;
      dispatch({ type: "send", text: trimmed, sendId });

      try {
        await api.assistantSend(trimmed, (event: AssistantEvent) => {
          switch (event.type) {
            case "delta":
              dispatch({ type: "delta", data: event.data, sendId });
              break;
            case "proposal":
              dispatch({ type: "proposal", data: event.data, sendId });
              break;
            case "done":
              dispatch({ type: "done", data: event.data, sendId });
              break;
            case "error":
              dispatch({ type: "error", error: event.data, sendId });
              break;
          }
        });
        void checkStatus();
      } catch (e) {
        dispatch({ type: "error", error: errorMessage(e), sendId });
        void checkStatus();
      } finally {
        sendingRef.current = false;
      }
    },
    [checkStatus],
  );

  const stop = useCallback(async () => {
    sendIdRef.current++;
    dispatch({ type: "stop" });
    try {
      await api.assistantStop();
    } catch {
      // ignore
    }
  }, []);

  const decide = useCallback(
    async (id: string, approve: boolean): Promise<AssistantDecision> => {
      const summary = proposalsRef.current.find((p) => p.id === id)?.summary ?? "Usulan";
      const sendId = sendIdRef.current;
      let result: AssistantDecision;
      try {
        result = await api.assistantDecide(id, approve);
      } catch (e) {
        dispatch({ type: "failure", error: errorMessage(e), sendId });
        throw e;
      }
      dispatch({ type: "decided", proposalId: id, summary, approved: approve });
      if (approve) options?.onChanged?.();
      return result;
    },
    [options],
  );

  const setMode = useCallback((mode: AssistantMode) => {
    if (sendingRef.current) return;
    dispatch({ type: "set_mode", mode });
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: "clear_error" });
  }, [dispatch]);

  const reset = useCallback(async () => {
    sendIdRef.current++;
    dispatch({ type: "reset" });
    try {
      await api.assistantReset();
    } catch {
      // ignore
    }
  }, []);

  return {
    ...state,
    aiStatus,
    checkStatus,
    send,
    stop,
    decide,
    setMode,
    clearError,
    reset,
  };
}
