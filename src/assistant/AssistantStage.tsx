import { useState } from "react";
import { AssistantCaption, AssistantFeedback, STATUS } from "./AssistantFeedback";
import { School } from "./School";
import { useAssistant } from "./useAssistant";
import { usePageVisible } from "./usePageVisible";
import {
  AssistantComposer,
  AssistantIcon,
  AssistantMicButton,
  AssistantTypingButton,
  useAssistantComposer,
} from "./AssistantControls";

export interface AssistantStageProps {
  readonly onOpenAiSettings?: () => void;
  readonly onOpenVoiceSettings?: () => void;
  readonly onChanged?: () => void;
}

const WAVE_DELAYS = ["-0.1s", "-0.4s", "-0.65s", "-0.25s"];

export function AssistantStage({
  onOpenAiSettings,
  onOpenVoiceSettings,
  onChanged,
}: Readonly<AssistantStageProps>) {
  const assistant = useAssistant({ onChanged });
  const composer = useAssistantComposer(assistant);
  const [showHistory, setShowHistory] = useState(false);
  const visible = usePageVisible();

  const mode = assistant.mode;
  const running = mode !== "idle" && visible;
  const status = STATUS[mode];

  return (
    <section
      aria-label="Asisten suara"
      className="flex min-h-0 flex-1 flex-col gap-3 px-5 pt-4 pb-[18px]"
    >
      <div className="relative flex min-h-[220px] flex-1 items-end justify-center overflow-hidden rounded-[18px] border border-line bg-stage">
        <div className="absolute bottom-[143px] left-1/2 -ml-[130px] h-[260px] w-[260px] rounded-full bg-stage-disc" />
        <School
          color={status.color}
          dimmed={mode === "idle"}
          running={running}
          className="absolute bottom-[123px] left-1/2 -ml-[150px]"
        />
        <svg
          width="250"
          height="384"
          viewBox="0 0 150 230"
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth="1.6"
          className="relative -mb-2"
          aria-hidden="true"
        >
          <path
            d="M40 230c0-58 16-110 35-110s35 52 35 110"
            fill="var(--color-surface-2)"
          />
          <circle cx="75" cy="62" r="34" fill="var(--color-surface-2)" />
          <path
            d="M41 58c4-30 64-34 68 0"
            fill="var(--color-disabled)"
          />
          <circle cx="63" cy="66" r="3" fill="var(--color-muted)" />
          <circle cx="87" cy="66" r="3" fill="var(--color-muted)" />
          <path d="M67 80c5 4 11 4 16 0" />
        </svg>

        <div className="absolute top-3 left-3 flex items-center gap-2 rounded-full border border-line bg-sidebar px-2.5 py-[5px] text-xs">
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
        <span className="absolute top-4 right-3.5 text-[11px] text-muted">
          Avatar statis
        </span>

        <div className="absolute right-3 bottom-3 left-3 flex flex-col gap-1.5 rounded-[14px] border border-line bg-sidebar/90 px-3.5 py-3">
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
