import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, errorMessage, type CalendarStatus } from "../api";
import { relativeTime } from "../format";
import { H2, PANEL, PRIMARY, SECONDARY } from "../shell/ui";

/** Google Kalender, pulled read-only into Jadwal. Tokens stay in the OS keyring and never reach the UI. */
export function CalendarSection({ onChanged }: Readonly<{ onChanged: () => void }>) {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    let active = true;
    api.calendarStatus().then((next) => { if (active) setStatus(next); }, (e) => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, []);

  async function run(action: () => Promise<CalendarStatus>) {
    if (pending.current) return;
    pending.current = true;
    cancelled.current = false;
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
      onChanged();
    } catch (e) {
      if (!cancelled.current) setError(errorMessage(e));
      // A failed pull may have dropped a revoked grant; show what the backend now knows.
      await api.calendarStatus().then(setStatus, () => {});
    } finally {
      pending.current = false;
      setBusy(false);
      setWaiting(false);
    }
  }

  const connect = () => {
    setWaiting(true);
    void run(api.calendarConnect);
  };

  const cancelConnect = () => {
    cancelled.current = true;
    api.calendarCancelConnect().catch((e) => setError(errorMessage(e)));
  };

  function body(): ReactNode {
    if (!status) return <p className="m-0 text-xs text-muted">Memuat status Google Kalender…</p>;
    if (waiting) {
      return (
        <div className="flex items-center gap-3">
          <p className="m-0 text-sm text-ink">Menunggu login di browser…</p>
          <button type="button" onClick={cancelConnect} className={SECONDARY}>Batal</button>
        </div>
      );
    }
    if (status.connected) {
      return (
        <>
          <p className="m-0 break-all text-sm">{`Terhubung sebagai ${status.account ?? "akun Google"}`}</p>
          {status.fetchedAt !== null && (
            <p className="m-0 text-xs text-muted">{`Diperbarui ${relativeTime(status.fetchedAt, Date.now())}`}</p>
          )}
          {status.readOnly && (
            <div className="flex flex-col items-start gap-1">
              <p className="m-0 text-xs text-muted">Sambungkan ulang untuk sinkron dua arah</p>
              <button type="button" disabled={busy} onClick={connect} className={PRIMARY}>
                Sambungkan ulang untuk sinkron dua arah
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void run(api.calendarRefresh)} className={SECONDARY}>
              {busy ? "Memuat…" : "Muat ulang"}
            </button>
            <button type="button" disabled={busy} onClick={() => void run(api.calendarDisconnect)} className={SECONDARY}>Putuskan</button>
          </div>
        </>
      );
    }
    return (
      <>
        <button type="button" disabled={busy} onClick={connect} className={PRIMARY}>Sambungkan Google Kalender</button>
        <p className="m-0 text-xs text-muted">
          Acara kalender utama dan tugas Anchoa terhubung dengan sinkron dua arah.
        </p>
      </>
    );
  }

  const shownError = error ?? status?.lastError ?? null;
  return (
    <section className={`${PANEL} flex flex-col items-start gap-3`}>
      <div className="flex items-center gap-2">
        <h2 className={H2}>Google Kalender</h2>
        {status?.readOnly && (
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">Hanya baca</span>
        )}
      </div>
      {body()}
      {shownError && <p role="alert" className="m-0 text-sm text-danger">{shownError}</p>}
    </section>
  );
}
