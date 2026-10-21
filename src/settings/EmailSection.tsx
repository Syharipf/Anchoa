import { useEffect, useRef, useState } from "react";
import { api, errorMessage, type EmailStatus } from "../api";
import { connectionLabel } from "../email/view";
import { H2, PANEL } from "../shell/ui";

export function EmailSection({ onChanged }: Readonly<{ onChanged: () => void }>) {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    api.emailStatus().then((next) => { if (active) setStatus(next); }, (e) => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, []);

  async function disconnect() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.emailDisconnect();
      setStatus({ connected: false, address: null });
      setConfirming(false);
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <section className={`${PANEL} flex flex-col items-start gap-3`}>
      <h2 className={H2}>Email</h2>
      <p className="m-0 break-all text-sm">{connectionLabel(status)}</p>
      {status?.connected ? (
        confirming ? <div className="flex flex-col gap-2">
          <p className="m-0 text-sm text-muted">Disconnect Gmail? App Password and local emails will be removed from Anchoa.</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="flex h-8 items-center rounded-[9px] border border-line bg-surface px-3 text-xs text-ink transition-colors hover:bg-surface-2"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={disconnect}
              className="flex h-8 items-center rounded-[9px] border border-line bg-surface px-3 text-xs text-danger transition-colors hover:bg-danger-row disabled:opacity-50"
            >
              {busy ? "Disconnecting…" : "Yes, disconnect"}
            </button>
          </div>
        </div> : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex h-8 items-center rounded-[9px] border border-line bg-surface px-3 text-xs text-danger transition-colors hover:bg-danger-row"
          >
            Disconnect
          </button>
        )
      ) : <p className="m-0 text-xs text-muted">Open Email menu to connect Gmail with an App Password.</p>}
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
    </section>
  );
}
