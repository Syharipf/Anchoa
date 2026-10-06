import {
  useEffect,
  useRef,
  useState,
} from "react";
import { AssistantCaption, AssistantFeedback, STATUS } from "./AssistantFeedback";
import { AnchoaPet, type PetStatus } from "../pet/AnchoaPet";
import { useAssistant } from "./useAssistant";
import { usePageVisible } from "./usePageVisible";
import { useAssistantRequest, type AssistantRequest } from "./useAssistantRequest";
import {
  AssistantComposer,
  AssistantIcon as Icon,
  AssistantMicButton,
  AssistantTypingButton,
  useAssistantComposer,
} from "./AssistantControls";

const ROUND =
  "flex items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95 cursor-pointer";
const ICON_BUTTON =
  "flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 cursor-pointer";

const MIC = (
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </>
);

export interface AssistantMiniProps {
  readonly request?: AssistantRequest;
  readonly hint: string;
  readonly onOpenFull: () => void;
  readonly onOpenAiSettings?: () => void;
  readonly onOpenVoiceSettings?: () => void;
  readonly onChanged?: () => void;
}

/**
 * Collapsed assistant for every page except the dashboard (DESIGN.md §1).
 */
export function AssistantMini({
  request,
  hint,
  onOpenFull,
  onOpenAiSettings,
  onOpenVoiceSettings,
  onChanged,
}: Readonly<AssistantMiniProps>) {
  const assistant = useAssistant({ onChanged });
  const [open, setOpen] = useState(false);
  const composer = useAssistantComposer(assistant);
  const visible = usePageVisible();
  const trigger = useRef<HTMLButtonElement>(null);
  const mic = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useAssistantRequest(request, assistant, composer, () => setOpen(true));

  const mode = assistant.mode;
  const listening = mode === "listening";
  const thinking = mode === "thinking";
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
  useEffect(() => {
    if (open !== wasOpen.current) (open ? mic : trigger).current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (!open) {
    return (
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Buka asisten"
        title="Asisten"
        className={`${ROUND} fixed right-6 bottom-6 z-30 h-[60px] w-[60px] border border-line bg-surface-2 text-muted shadow-[0_16px_40px] shadow-canvas/45`}
      >
        <AnchoaPet
          size={48}
          crop="head"
          status={petStatus}
          paused={!visible}
          shadow={false}
        />
        <span className="absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-canvas">
          <Icon size={11}>{MIC}</Icon>
        </span>
      </button>
    );
  }

  const collapse = () => {
    setOpen(false);
    void assistant.stop();
    composer.setTyping(false);
  };

  return (
    <section
      aria-label="Asisten"
      onKeyDown={(e) => {
        if (e.key === "Escape") collapse();
      }}
      data-anim
      style={{ animation: "anchoa-pop 0.2s ease-out" }}
      className="fixed right-6 bottom-6 z-30 flex w-[304px] flex-col gap-3 rounded-[18px] border border-line bg-surface p-4 shadow-[0_16px_40px] shadow-canvas/45"
    >
      <div className="flex items-center gap-3">
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border border-line bg-surface-2 flex items-center justify-center">
          <AnchoaPet
            size={44}
            crop="head"
            status={petStatus}
            paused={!visible}
            shadow={false}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-display text-sm font-semibold">Anchoa</span>
          <span
            aria-live="polite"
            className={`text-xs ${
              listening
                ? "text-danger"
                : thinking
                  ? "text-accent"
                  : "text-muted"
            }`}
          >
            {status.text}
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenFull}
          aria-label="Buka asisten penuh"
          title="Buka asisten penuh"
          className={ICON_BUTTON}
        >
          <Icon size={16}>
            <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
          </Icon>
        </button>
        <button
          type="button"
          onClick={collapse}
          aria-label="Kecilkan asisten"
          title="Kecilkan"
          className={ICON_BUTTON}
        >
          <Icon size={16}>
            <path d="M5 12h14" />
          </Icon>
        </button>
      </div>

      <AssistantCaption assistant={assistant} hint={hint} compact onOpenAiSettings={onOpenAiSettings} onOpenVoiceSettings={onOpenVoiceSettings} />

      <AssistantFeedback assistant={assistant} showHistory compact />

      <AssistantComposer assistant={assistant} composer={composer} compact />

      <div className="flex items-center justify-center gap-4">
        <AssistantTypingButton composer={composer} compact />
        <AssistantMicButton assistant={assistant} compact ref={mic} />
      </div>
    </section>
  );
}
