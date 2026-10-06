import { useState } from "react";
import { AssistantCaption, AssistantFeedback, STATUS } from "./AssistantFeedback";
import { AnchoaPet, type PetStatus } from "../pet/AnchoaPet";
import { LautAko } from "../pet/LautAko";
import { useAssistant } from "./useAssistant";
import { usePageVisible } from "./usePageVisible";
import { useAssistantRequest, type AssistantRequest } from "./useAssistantRequest";
import {
  AssistantComposer,
  AssistantIcon,
  AssistantMicButton,
  AssistantTypingButton,
  useAssistantComposer,
} from "./AssistantControls";

export interface AssistantStageProps {
  readonly request?: AssistantRequest;
  readonly onOpenAiSettings?: () => void;
  readonly onOpenVoiceSettings?: () => void;
  readonly onChanged?: () => void;
}

const WAVE_DELAYS = ["-0.1s", "-0.4s", "-0.65s", "-0.25s"];

export function AssistantStage({
  request,
  onOpenAiSettings,
  onOpenVoiceSettings,
  onChanged,
}: Readonly<AssistantStageProps>) {
  const assistant = useAssistant({ onChanged });
  const composer = useAssistantComposer(assistant);
  const [showHistory, setShowHistory] = useState(false);
  const visible = usePageVisible();

  useAssistantRequest(request, assistant, composer, () => setShowHistory(true));

  const mode = assistant.mode;
  const running = mode !== "idle" && visible;
  const status = STATUS[mode];
  const petStatus: PetStatus =
    assistant.error
      ? "sad"
      : mode === "listening"
      ? "listening"
      : mode === "thinking"
      ? "thinking"
      : mode === "speaking"
      ? "speaking"
      : "idle";

  return (
    <section
      aria-label="Asisten suara"
      className="flex min-h-0 flex-1 flex-col gap-3 px-5 pt-4 pb-[18px]"
    >
      <div className="relative flex min-h-[220px] flex-1 items-end justify-center overflow-hidden rounded-[18px] border border-line bg-stage">
        <LautAko paused={!running && mode === "idle"} />
        <AnchoaPet
          status={petStatus}
          size={240}
          shadow={false}
          paused={!running && mode === "idle"}
          className="relative z-10 -mb-2"
        />

        <div className="absolute top-3 left-3 z-20 flex items-center gap-2 rounded-full border border-line bg-sidebar px-2.5 py-[5px] text-xs">
          <div aria-hidden="true" className="flex h-3 items-center gap-0.5">
            {WAVE_DELAYS.map((delay) => (
              <span
                key={delay}
                data-anim
                className="h-3 w-[3px] rounded-sm"
                style={{
                  background: status.color,
                  transition: "background-color 0.4s",
                  animation: `anchoa-wave 0.9s ease-in-out ${delay} infinite`,
                  animationPlayState: running ? "running" : "paused",
                }}
              />
            ))}
          </div>
          <span aria-live="polite">{status.text}</span>
        </div>
        <span className="absolute top-4 right-3.5 z-20 text-[11px] text-muted">
          Avatar statis
        </span>

        <div className="absolute right-3 bottom-3 left-3 z-20 flex flex-col gap-1.5 rounded-[14px] border border-line bg-sidebar/90 px-3.5 py-3">
          <AssistantCaption assistant={assistant} onOpenAiSettings={onOpenAiSettings} onOpenVoiceSettings={onOpenVoiceSettings} />
        </div>
      </div>

      <AssistantFeedback assistant={assistant} showHistory={showHistory} />

      <AssistantComposer assistant={assistant} composer={composer} />

      <div className="flex items-center justify-center gap-6">
        <AssistantTypingButton composer={composer} />
        <AssistantMicButton assistant={assistant} visible={visible} />
        <button
          type="button"
          aria-label="Riwayat obrolan"
          aria-pressed={showHistory}
          onClick={() => setShowHistory((h) => !h)}
          className={`flex h-12 w-12 items-center justify-center rounded-full border border-line cursor-pointer transition-colors ${
            showHistory
              ? "bg-surface-2 text-accent"
              : "text-muted hover:bg-surface-2 hover:text-ink"
          }`}
        >
          <AssistantIcon size={20} strokeWidth={1.8}>
            <path d="M4 6h16M4 12h16M4 18h10" />
          </AssistantIcon>
        </button>
      </div>
    </section>
  );
}
