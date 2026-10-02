import { useEffect, useRef } from "react";
import type { useAssistantComposer } from "./AssistantControls";
import type { useAssistant } from "./useAssistant";

export type AssistantActionRequest = Readonly<
  | { kind: "compose"; text: string }
  | { kind: "voice" }
  | { kind: "speak"; text: string }
>;
export type OpenAssistant = (action: AssistantActionRequest) => void;
export type AssistantRequest = Readonly<{ id: number; action: AssistantActionRequest }>;

/** Route page actions through the assistant that is already mounted in the shell. */
export function useAssistantRequest(
  request: AssistantRequest | undefined,
  assistant: ReturnType<typeof useAssistant>,
  composer: ReturnType<typeof useAssistantComposer>,
  onOpen?: () => void,
) {
  const handled = useRef<number | undefined>(undefined);
  const { mode, toggleMic, speak } = assistant;
  const { setTyping, setText } = composer;
  useEffect(() => {
    if (!request || handled.current === request.id) return;
    handled.current = request.id;
    onOpen?.();
    switch (request.action.kind) {
      case "compose":
        setText(request.action.text);
        setTyping(true);
        break;
      case "voice":
        if (mode === "idle") void toggleMic();
        break;
      case "speak":
        void speak(request.action.text);
        break;
    }
  }, [request, mode, toggleMic, speak, setTyping, setText, onOpen]);
}
