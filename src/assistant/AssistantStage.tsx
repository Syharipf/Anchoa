import { useState, type KeyboardEvent } from "react";
import { FIELD } from "../shell/ui";
import { AssistantFeedback, STATUS } from "./AssistantFeedback";
import { OllamaOfflineCard } from "./OllamaOfflineCard";
import { School } from "./School";
import { useAssistant } from "./useAssistant";
import { usePageVisible } from "./usePageVisible";

export interface AssistantStageProps {
  readonly onOpenAiSettings?: () => void;
  readonly onChanged?: () => void;
}

const WAVE_DELAYS = ["-0.1s", "-0.4s", "-0.65s", "-0.25s"];

const ROUND =
  "flex items-center justify-center rounded-full transition-transform hover:scale-105 active:scale-95 cursor-pointer";

export function AssistantStage({
  onOpenAiSettings,
  onChanged,
}: Readonly<AssistantStageProps>) {
  const assistant = useAssistant({ onChanged });
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const visible = usePageVisible();

  const mode = assistant.mode;
  const listening = mode === "listening";
  const thinking = mode === "thinking";
  const running = mode !== "idle" && visible;
  const status = STATUS[mode];
  const ollamaOffline = assistant.aiStatus !== null && !assistant.aiStatus.available;

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
          Avatar Live2D
        </span>

        <div className="absolute right-3 bottom-3 left-3 flex flex-col gap-1.5 rounded-[14px] border border-line bg-sidebar/90 px-3.5 py-3">
          {ollamaOffline && !thinking ? (
            <OllamaOfflineCard onOpenAiSettings={onOpenAiSettings} />
          ) : listening ? (
            <>
              <span className="text-xs text-danger">Mikrofon aktif</span>
              <span className="text-sm leading-snug">
                Pengenalan suara hadir di Fase 5. Ketuk lagi untuk berhenti.
              </span>
            </>
          ) : thinking ? (
            <>
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
              <span className="text-sm leading-snug">
                {assistant.streamingCaption || "Memproses permintaan…"}
              </span>
            </>
          ) : assistant.streamingCaption ? (
            <>
              <span className="text-xs text-muted">Asisten suara</span>
              <span className="text-sm leading-snug">
                {assistant.streamingCaption}
              </span>
            </>
          ) : (
            <>
              <span className="text-xs text-muted">Asisten suara</span>
              <span className="text-sm leading-snug">
                Aku siap membantu tugas, jadwal, keuangan, dan catatanmu. Ketik
                pesan atau ketuk mikrofon.
              </span>
            </>
          )}
        </div>
      </div>

      <AssistantFeedback assistant={assistant} showHistory={showHistory} />

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
            className="flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-muted focus-visible:outline-none"
          />
          {thinking ? (
            <button
              type="button"
              aria-label="Hentikan"
              onClick={assistant.stop}
              className="flex h-9 items-center justify-center rounded-lg bg-danger/15 px-2.5 text-xs font-semibold text-danger hover:bg-danger/25 cursor-pointer"
            >
              Hentikan
            </button>
          ) : (
            <button
              type="button"
              aria-label="Kirim"
              onClick={handleSend}
              disabled={!text.trim()}
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-canvas disabled:bg-surface-2 disabled:text-disabled cursor-pointer transition-transform hover:scale-105 active:scale-95"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-center gap-6">
        <button
          type="button"
          aria-label="Ketik pesan"
          aria-pressed={typing}
          onClick={() => setTyping((t) => !t)}
          className={`${ROUND} h-12 w-12 border border-line ${
            typing ? "bg-surface-2 text-accent" : "text-muted"
          }`}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
          </svg>
        </button>
        <div className="relative h-16 w-16">
          {listening && (
            <span
              data-anim
              aria-hidden="true"
              className="absolute inset-0 rounded-full bg-danger opacity-0"
              style={{
                animation: "anchoa-pulse 1.6s ease-out infinite",
                animationPlayState: visible ? "running" : "paused",
              }}
            />
          )}
          <button
            type="button"
            aria-label={
              listening ? "Berhenti mendengarkan" : "Ketuk untuk bicara"
            }
            aria-pressed={listening}
            disabled={thinking}
            onClick={() => assistant.setMode(listening ? "idle" : "listening")}
            className={`${ROUND} relative h-16 w-16 text-canvas disabled:opacity-50 disabled:cursor-not-allowed ${
              listening
                ? "bg-danger"
                : "bg-accent ring-4 ring-accent/20"
            }`}
          >
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <path d="M12 18v3" />
            </svg>
          </button>
        </div>
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
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M4 6h16M4 12h16M4 18h10" />
          </svg>
        </button>
      </div>
    </section>
  );
}
