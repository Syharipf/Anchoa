import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../shell/toast";
import { PRIMARY, SECONDARY } from "../shell/ui";
import { FlowCanvas } from "./FlowCanvas";
import { PrdEditor } from "./PrdEditor";

export function PrdReviewModal({
  projectId,
  initialPrd,
  initialFlow,
  onClose,
  onApproved,
}: Readonly<{
  projectId: string;
  initialPrd: string | null;
  initialFlow: string | null;
  onClose: () => void;
  onApproved: () => void;
}>) {
  const toast = useToast();
  const [prd, setPrd] = useState(initialPrd);
  const [flow, setFlow] = useState(initialFlow);
  const [revision, setRevision] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleRequestRevision(e: FormEvent) {
    e.preventDefault();
    const text = revision.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await api.agentRequest(projectId, `Request PRD/Flow draft revision: ${text}`);
      toast("Revision request sent to harness");
      setRevision("");
      onApproved();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    setBusy(true);
    try {
      if (prd) {
        await api.projectSavePrd(projectId, prd);
      }
      if (flow) {
        await api.projectSaveFlow(projectId, flow);
      }
      toast("Draft approved! Pipeline started.");
      onApproved();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-draft-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="flex h-[92vh] w-[95vw] max-w-6xl flex-col overflow-hidden rounded-2xl border border-line bg-[#0C1417] shadow-2xl">
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-line bg-surface px-5 py-3">
          <div className="flex items-center gap-3">
            <h2
              id="review-draft-title"
              className="font-display text-base font-semibold text-ink"
            >
              Review &amp; Edit AI Draft (Option A)
            </h2>
            <span className="rounded bg-surface-2 px-2 py-0.5 font-mono text-xs text-accent">
              Model: @plan
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-semibold text-muted hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* Notice Callout */}
        <div className="flex items-center gap-3 border-b border-line bg-[#1E2A12]/30 px-5 py-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#1E2A12] text-xs text-accent">
            ✓
          </span>
          <p className="text-xs text-[#C3D2D6]">
            The harness has prepared a draft PRD specification and flow diagram. Review
            or edit the content directly before approving automated execution.
          </p>
        </div>

        {/* Main Split-Pane */}
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-5 md:grid-cols-[440px_minmax(0,1fr)]">
          <PrdEditor
            projectId={projectId}
            initialContent={prd}
            onSaved={setPrd}
          />
          <FlowCanvas
            projectId={projectId}
            initialFlowJson={flow}
            onSaved={setFlow}
          />
        </div>

        {/* Bottom Approval & Revision Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className={`${SECONDARY} text-xs text-danger hover:border-danger`}
          >
            Cancel / Discard Draft
          </button>

          <form
            onSubmit={handleRequestRevision}
            className="flex flex-1 max-w-md items-center gap-2"
          >
            <input
              type="text"
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
              placeholder="Anything missing? Request AI revision (Enter)..."
              disabled={busy}
              className="flex-1 rounded-lg border border-line bg-stage px-3 py-1.5 text-xs text-ink outline-none"
            />
            <button
              type="submit"
              disabled={busy || !revision.trim()}
              className={`${SECONDARY} py-1.5 text-xs`}
            >
              Revise
            </button>
          </form>

          <button
            type="button"
            onClick={handleApprove}
            disabled={busy}
            className={`${PRIMARY} py-1.5 px-4 font-display text-xs font-bold text-[#0C1417] shadow-lg`}
          >
            {busy ? "Processing…" : "Approve & Execute Pipeline ▶"}
          </button>
        </div>
      </div>
    </div>
  );
}
