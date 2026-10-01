import type { useAssistant, AssistantMode } from "./useAssistant";
import { ProposalCard } from "./ProposalCard";

export const STATUS: Record<AssistantMode, { text: string; color: string }> = {
  idle: { text: "Siap", color: "var(--color-muted)" },
  thinking: { text: "Berpikir…", color: "var(--color-accent)" },
  listening: { text: "Mendengarkan…", color: "var(--color-danger)" },
  speaking: { text: "Berbicara", color: "var(--color-accent)" },
};

export interface AssistantFeedbackProps {
  readonly assistant: ReturnType<typeof useAssistant>;
  readonly showHistory?: boolean;
  readonly compact?: boolean;
}

export function AssistantFeedback({
  assistant,
  showHistory = true,
  compact = false,
}: Readonly<AssistantFeedbackProps>) {
  return (
    <>
      {assistant.error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3 text-xs text-danger"
        >
          <span className="flex-1">{assistant.error}</span>
          <button
            type="button"
            aria-label="Tutup pesan kesalahan"
            onClick={assistant.clearError}
            className="cursor-pointer font-semibold hover:underline"
          >
            Tutup
          </button>
        </div>
      )}

      {assistant.pendingProposals.length > 0 && (
        <div className="flex flex-col gap-2">
          {assistant.pendingProposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} onDecide={assistant.decide} />
          ))}
        </div>
      )}

      {showHistory && assistant.messages.length > 0 && (
        <div
          aria-label="Riwayat pesan"
          className={
            compact
              ? "flex max-h-28 flex-col gap-1.5 overflow-y-auto rounded-lg border border-line bg-surface-2/40 p-2 text-xs"
              : "flex max-h-36 flex-col gap-1.5 overflow-y-auto rounded-xl border border-line bg-surface p-2 text-xs"
          }
        >
          {assistant.messages.map((msg, index) => {
            if (msg.role !== "user" && msg.role !== "assistant") return null;
            if (!msg.content) return null;
            const isUser = msg.role === "user";
            return (
              <div
                key={index}
                className={`max-w-[88%] leading-snug ${
                  compact ? "rounded-md px-2 py-1" : "rounded-lg px-2.5 py-1.5"
                } ${
                  isUser
                    ? "self-end bg-surface-2 text-ink"
                    : "self-start border border-line bg-surface text-ink"
                }`}
              >
                {msg.content}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
