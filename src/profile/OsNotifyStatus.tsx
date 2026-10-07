import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, onNotifyDelivered, type NotifyStatus } from "../api";
import { relativeTime } from "../format";
import { SECONDARY } from "../shell/ui";
import { DELIVERY_STATE_LABEL, OS_PERMISSION_LABEL, RECENT_DELIVERIES_SHOWN } from "./view";

/** OS permission, why reminders are not shown, and the latest deliveries. */
export function OsNotifyStatus() {
  const [status, setStatus] = useState<NotifyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    () =>
      api.notifyStatus().then(
        (next) => {
          setStatus(next);
          setError(null);
        },
        (e) => setError(errorMessage(e)),
      ),
    [],
  );

  useEffect(() => {
    void refresh();
    let unlisten: (() => void) | undefined;
    let active = true;
    onNotifyDelivered(() => void refresh()).then(
      (stop) => (active ? (unlisten = stop) : stop()),
      () => {},
    );
    return () => {
      active = false;
      unlisten?.();
    };
  }, [refresh]);

  const requestPermission = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setStatus(await api.notifyRequestPermission());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const now = Date.now();
  const recent = status?.recent.slice(0, RECENT_DELIVERIES_SHOWN) ?? [];

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
      <span className="text-sm text-ink">
        {status ? OS_PERMISSION_LABEL[status.permission] : "Notifikasi sistem: memuat…"}
      </span>
      {status?.reason && <p className="m-0 text-xs leading-relaxed text-muted">{status.reason}</p>}
      {status?.permission === "prompt" && (
        <button
          type="button"
          className={`${SECONDARY} self-start`}
          disabled={busy}
          onClick={() => void requestPermission()}
        >
          {busy ? "Meminta izin…" : "Izinkan notifikasi"}
        </button>
      )}
      {error && (
        <p role="alert" className="m-0 text-xs text-danger">
          {error}
        </p>
      )}
      <p className="m-0 text-xs leading-relaxed text-muted">
        Pengingat dikirim ke sistem selama Anchoa berjalan, termasuk saat jendelanya diminimalkan. Setelah
        Anchoa ditutup, pengingat menunggu sampai Anchoa dibuka lagi.
      </p>
      {status && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted">Pengiriman terakhir</span>
          {recent.length === 0 ? (
            <p className="m-0 text-xs text-muted">Belum ada pengingat yang dikirim ke sistem.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {recent.map((entry) => (
                <li key={`${entry.at}-${entry.id}-${entry.state}`} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-ink">{entry.title || entry.id}</span>
                  <span className="shrink-0 text-muted">
                    {`${DELIVERY_STATE_LABEL[entry.state]} · ${relativeTime(entry.at, now)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
