import { useState } from "react";
import type { AssistantProposal } from "../api";

export interface ProposalCardProps {
  readonly proposal: AssistantProposal;
  readonly onDecide: (id: string, approve: boolean) => void;
}

export function ProposalCard({ proposal, onDecide }: Readonly<ProposalCardProps>) {
  const [busy, setBusy] = useState(false);

  const handleDecide = async (approve: boolean) => {
    setBusy(true);
    try {
      await onDecide(proposal.id, approve);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="region"
      aria-label={`Usulan: ${proposal.summary}`}
      className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-4 w-4 shrink-0 text-accent">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </span>
        <span className="flex-1 text-xs font-medium text-ink leading-snug">
          {proposal.summary}
        </span>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => handleDecide(false)}
          className="min-h-7 cursor-pointer rounded-lg border border-line px-3 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50"
        >
          Tolak
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => handleDecide(true)}
          className="min-h-7 cursor-pointer rounded-lg bg-accent px-3 text-xs font-semibold text-canvas transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
        >
          Setujui
        </button>
      </div>
    </div>
  );
}
