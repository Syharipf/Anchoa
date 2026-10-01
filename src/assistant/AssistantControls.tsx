import { useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { FIELD } from "../shell/ui";
import type { useAssistant } from "./useAssistant";

const ROUND = "flex items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95 cursor-pointer";

export function AssistantIcon({ size, children, strokeWidth = 2 }: Readonly<{
  size: number;
  children: ReactNode;
  strokeWidth?: number;
}>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function useAssistantComposer(assistant: ReturnType<typeof useAssistant>) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const disabled = assistant.mode === "thinking" || assistant.mode === "listening";
  const onSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    void assistant.send(trimmed);
    setText("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };
  return { typing, setTyping, text, setText, disabled, onSend, onKeyDown };
}

export function AssistantComposer({ assistant, composer, compact = false }: Readonly<{
  assistant: ReturnType<typeof useAssistant>;
  composer: ReturnType<typeof useAssistantComposer>;
  compact?: boolean;
}>) {
  if (!composer.typing) return null;
  const size = compact ? "h-8" : "h-9";
  return (
    <div className={`${FIELD} flex items-center gap-2 py-1.5 pr-1.5 focus-within:border-field-focus`}>
      <input
        aria-label="Ketik pesan ke asisten"
        placeholder="Ketik pesan…"
        value={composer.text}
        onChange={(e) => composer.setText(e.target.value)}
        onKeyDown={composer.onKeyDown}
        disabled={composer.disabled}
        className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-muted focus-visible:outline-none"
      />
      {assistant.mode === "thinking" ? (
        <button
          type="button"
          aria-label="Hentikan"
          onClick={assistant.stop}
          className={`flex ${size} items-center justify-center rounded-lg bg-danger/15 px-2.5 text-xs font-semibold text-danger hover:bg-danger/25 cursor-pointer`}
        >Hentikan</button>
      ) : (
        <button
          type="button"
          aria-label="Kirim"
          onClick={composer.onSend}
          disabled={composer.disabled || !composer.text.trim()}
          className={`flex ${size} ${compact ? "w-8" : "w-9"} items-center justify-center rounded-lg bg-accent text-canvas disabled:bg-surface-2 disabled:text-disabled cursor-pointer transition-transform hover:scale-105 active:scale-95`}
        >
          <AssistantIcon size={compact ? 16 : 18}>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </AssistantIcon>
        </button>
      )}
    </div>
  );
}

export function AssistantTypingButton({ composer, compact = false }: Readonly<{
  composer: ReturnType<typeof useAssistantComposer>;
  compact?: boolean;
}>) {
  return (
    <button
      type="button"
      aria-label="Ketik pesan"
      aria-pressed={composer.typing}
      onClick={() => composer.setTyping((typing) => !typing)}
      className={`${ROUND} ${compact ? "h-9 w-9" : "h-12 w-12"} border border-line ${composer.typing ? "bg-surface-2 text-accent" : "text-muted"}`}
    >
      <AssistantIcon size={compact ? 17 : 20} strokeWidth={1.8}>
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
      </AssistantIcon>
    </button>
  );
}

export function AssistantMicButton({ assistant, compact = false, visible = true, ref }: Readonly<{
  assistant: ReturnType<typeof useAssistant>;
  compact?: boolean;
  visible?: boolean;
  ref?: Ref<HTMLButtonElement>;
}>) {
  const listening = assistant.mode === "listening";
  const speaking = assistant.mode === "speaking";
  const size = compact ? "h-11 w-11" : "h-16 w-16";
  return (
    <div className={`relative ${size}`}>
      {listening && !compact && (
        <span data-anim aria-hidden="true" className="absolute inset-0 rounded-full bg-danger opacity-0"
          style={{ animation: "anchoa-pulse 1.6s ease-out infinite", animationPlayState: visible ? "running" : "paused" }} />
      )}
      <button
        ref={ref}
        type="button"
        aria-label={listening ? "Berhenti mendengarkan" : speaking ? "Hentikan suara" : "Ketuk untuk bicara"}
        aria-pressed={listening || speaking}
        disabled={assistant.mode === "thinking"}
        onClick={speaking ? assistant.stop : assistant.toggleMic}
        className={`${ROUND} relative ${size} text-canvas disabled:opacity-50 disabled:cursor-not-allowed ${listening ? "bg-danger" : `bg-accent ${compact ? "" : "ring-4 ring-accent/20"}`}`}
      >
        <AssistantIcon size={compact ? 20 : 26}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </AssistantIcon>
      </button>
    </div>
  );
}
