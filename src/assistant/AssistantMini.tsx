import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { FIELD } from "../shell/ui";
import { AssistantFeedback, STATUS } from "./AssistantFeedback";
import { OllamaOfflineCard } from "./OllamaOfflineCard";
import { School } from "./School";
import { useAssistant } from "./useAssistant";
import { usePageVisible } from "./usePageVisible";

const ROUND =
  "flex items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95 cursor-pointer";
const ICON_BUTTON =
  "flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 cursor-pointer";

function Icon({
  size,
  children,
}: Readonly<{ size: number; children: ReactNode }>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const FACE = (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 10h.01M15 10h.01M9 15c1.7 1.3 4.3 1.3 6 0" />
  </>
);
const MIC = (
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </>
);


export interface AssistantMiniProps {
  readonly hint: string;
  readonly onOpenFull: () => void;
  readonly onOpenAiSettings?: () => void;
  readonly onChanged?: () => void;
}

/**
 * Collapsed assistant for every page except the dashboard (DESIGN.md §1).
 */
export function AssistantMini({
  hint,
  onOpenFull,
  onOpenAiSettings,
  onChanged,
}: Readonly<AssistantMiniProps>) {
  const assistant = useAssistant({ onChanged });
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const visible = usePageVisible();
  const trigger = useRef<HTMLButtonElement>(null);
  const mic = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  const mode = assistant.mode;
  const listening = mode === "listening";
  const thinking = mode === "thinking";
  const running = mode !== "idle" && visible;
  const status = STATUS[mode];
  const ollamaOffline = assistant.aiStatus !== null && !assistant.aiStatus.available;

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
        className={`${ROUND} fixed right-6 bottom-6 z-30 h-[60px] w-[60px] border border-line bg-surface-2 text-muted shadow-[0_16px_40px_rgb(0_0_0/0.45)]`}
      >
        <Icon size={28}>{FACE}</Icon>
        <span className="absolute -top-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-canvas">
          <Icon size={11}>{MIC}</Icon>
        </span>
      </button>
    );
  }

  const collapse = () => {
    setOpen(false);
    if (mode === "listening") assistant.setMode("idle");
    setTyping(false);
  };

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    assistant.send(trimmed);
    setText("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <section
      aria-label="Asisten"
      onKeyDown={(e) => {
        if (e.key === "Escape") collapse();
      }}
      data-anim
      style={{ animation: "anchoa-pop 0.2s ease-out" }}
      className="fixed right-6 bottom-6 z-30 flex w-[304px] flex-col gap-3 rounded-[18px] border border-line bg-surface p-4 shadow-[0_16px_40px_rgb(0_0_0/0.45)]"
    >
      <div className="flex items-center gap-3">
        <div className="relative h-11 w-11 shrink-0">
          <School
            size={72}
            period="12s"
            color={status.color}
            dimmed={mode === "idle"}
            running={running}
            className="absolute top-1/2 left-1/2 -mt-9 -ml-9"
          />
          <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-muted">
            <Icon size={24}>{FACE}</Icon>
          </span>
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

      {ollamaOffline && !thinking ? (
        <OllamaOfflineCard onOpenAiSettings={onOpenAiSettings} />
      ) : listening ? (
        <p className="m-0 text-sm leading-snug text-ink">
          Pengenalan suara hadir di Fase 5. Ketuk lagi untuk berhenti.
        </p>
      ) : thinking ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-accent">Sedang berpikir…</span>
            <button
              type="button"
              aria-label="Hentikan"
              onClick={assistant.stop}
              className="rounded border border-danger/40 bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger hover:bg-danger/20 cursor-pointer"
            >
              Hentikan
            </button>
          </div>
          <p className="m-0 text-sm leading-snug text-ink">
            {assistant.streamingCaption || "Memproses permintaan…"}
          </p>
        </div>
      ) : assistant.streamingCaption ? (
        <p className="m-0 text-sm leading-snug text-ink">
          {assistant.streamingCaption}
        </p>
      ) : (
        <p className="m-0 text-sm leading-snug text-ink">{hint}</p>
      )}

      <AssistantFeedback assistant={assistant} showHistory compact />

      {typing && (
        <div
          className={`${FIELD} flex items-center gap-2 py-1.5 pr-1.5 focus-within:border-field-focus`}
        >
          <input
            aria-label="Ketik pesan ke asisten"
            placeholder="Ketik pesan…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={thinking}
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-muted focus-visible:outline-none"
          />
          {thinking ? (
            <button
              type="button"
              aria-label="Hentikan"
              onClick={assistant.stop}
              className="flex h-8 items-center justify-center rounded-lg bg-danger/15 px-2 text-xs font-semibold text-danger hover:bg-danger/25 cursor-pointer"
            >
              Hentikan
            </button>
          ) : (
            <button
              type="button"
              aria-label="Kirim"
              onClick={handleSend}
              disabled={!text.trim()}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-canvas disabled:bg-surface-2 disabled:text-disabled cursor-pointer transition-transform hover:scale-105 active:scale-95"
            >
              <Icon size={16}>
                <path d="M5 12h14M13 6l6 6-6 6" />
              </Icon>
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => setTyping((t) => !t)}
          aria-label="Ketik pesan"
          aria-pressed={typing}
          className={`${ROUND} h-9 w-9 border border-line ${
            typing ? "bg-surface-2 text-accent" : "text-muted"
          }`}
        >
          <Icon size={17}>
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
          </Icon>
        </button>
        <button
          ref={mic}
          type="button"
          onClick={() => assistant.setMode(listening ? "idle" : "listening")}
          aria-label={
            listening ? "Berhenti mendengarkan" : "Ketuk untuk bicara"
          }
          aria-pressed={listening}
          disabled={thinking}
          className={`${ROUND} h-11 w-11 text-canvas disabled:opacity-50 disabled:cursor-not-allowed ${
            listening ? "bg-danger" : "bg-accent"
          }`}
        >
          <Icon size={20}>{MIC}</Icon>
        </button>
      </div>
    </section>
  );
}
