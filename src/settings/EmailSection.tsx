import { useEffect, useRef, useState } from "react";
import { api, errorMessage, type EmailStatus } from "../api";
import { connectionLabel } from "../email/view";
import { H2, PANEL, SECONDARY } from "../shell/ui";

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
          <p className="m-0 text-sm text-muted">Putuskan Gmail? App Password dan email lokal akan dihapus dari Anchoa.</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={SECONDARY}>Batal</button>
            <button type="button" disabled={busy} onClick={disconnect} className={`${SECONDARY} text-danger`}>{busy ? "Memutuskan…" : "Ya, putuskan"}</button>
          </div>
        </div> : <button type="button" onClick={() => setConfirming(true)} className={SECONDARY}>Putuskan</button>
      ) : <p className="m-0 text-xs text-muted">Buka menu Email untuk menyambungkan Gmail dengan App Password.</p>}
      {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
    </section>
  );
}
