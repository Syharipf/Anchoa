import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, errorMessage, onSyncChanged, type SyncProvider, type SyncStatus } from "../api";
import { formatBytes, relativeTime } from "../format";
import { Dialog, Field } from "../shell/Dialog";
import { FIELD, H2, PANEL, PRIMARY, SECONDARY } from "../shell/ui";

const MIN_PASSPHRASE = 12;

/** The message to show when a new passphrase may not be used, or null when it is fine. */
export function passphraseProblem(pass: string, again: string): string | null {
  if (Array.from(pass).length < MIN_PASSPHRASE) return `Frasa sandi minimal ${MIN_PASSPHRASE} karakter.`;
  if (pass !== again) return "Kedua frasa sandi harus sama.";
  return null;
}

type Dialogs = "passphrase" | "signOut" | null;

export function SyncSection({
  onChanged,
}: Readonly<{ onChanged?: () => void }> = {}) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [oldPass, setOldPass] = useState("");
  const [unlock, setUnlock] = useState("");
  // The recovery key lives only here, from creation until "Lanjut".
  const [recovery, setRecovery] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [deleteCloud, setDeleteCloud] = useState(false);
  const pending = useRef(false);
  const cancelled = useRef(false);

  const refresh = useCallback(() => {
    return api.syncStatus().then(
      (s) => {
        setStatus(s);
        onChanged?.();
      },
      (e) => setError(errorMessage(e)),
    );
  }, [onChanged]);

  useEffect(() => {
    void refresh();
    let unlisten: (() => void) | undefined;
    let active = true;
    onSyncChanged(() => void refresh()).then(
      (stop) => (active ? (unlisten = stop) : stop()),
      () => {},
    );
    return () => {
      active = false;
      unlisten?.();
    };
  }, [refresh]);

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      await refresh();
      pending.current = false;
      setBusy(false);
    }
  }

  function clearFields() {
    setPass("");
    setAgain("");
    setOldPass("");
    setUnlock("");
  }

  const signIn = (provider: SyncProvider) =>
    run(async () => {
      cancelled.current = false;
      setWaiting(true);
      try {
        await api.syncSignIn(provider);
      } catch (e) {
        if (!cancelled.current) throw e;
      } finally {
        setWaiting(false);
      }
    });

  const cancelSignIn = () => {
    cancelled.current = true;
    api.syncCancelSignIn().catch((e) => setError(errorMessage(e)));
  };

  function createKey(e: FormEvent) {
    e.preventDefault();
    const problem = passphraseProblem(pass, again);
    if (problem) return setError(problem);
    return run(async () => {
      const { recoveryKey } = await api.syncCreateKey(pass);
      clearFields();
      setSaved(false);
      setRecovery(recoveryKey);
    });
  }

  function unlockKey(e: FormEvent) {
    e.preventDefault();
    if (!unlock.trim()) return setError("Isi frasa sandi atau recovery key.");
    return run(async () => {
      await api.syncUnlockKey(unlock.trim());
      clearFields();
    });
  }

  function changePassphrase(e: FormEvent) {
    e.preventDefault();
    if (!oldPass) return setError("Isi frasa sandi yang lama.");
    const problem = passphraseProblem(pass, again);
    if (problem) return setError(problem);
    return run(async () => {
      await api.syncChangePassphrase(oldPass, pass);
      clearFields();
      setDialog(null);
      setNote("Frasa sandi sudah diganti.");
    });
  }

  const syncNow = () =>
    run(async () => {
      const report = await api.syncNow();
      setNote(
        report.stoppedByQuota
          ? "Kuota cloud penuh: sebagian data belum terkirim."
          : `Selesai: ${report.pushed} terkirim, ${report.pulled} diterima.`,
      );
    });

  const signOut = () =>
    run(async () => {
      await api.syncSignOut(deleteCloud);
      setDialog(null);
      setDeleteCloud(false);
    });

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setDeleteCloud(false);
    setError(null);
    clearFields();
  }

  const copy = () => {
    if (recovery) navigator.clipboard.writeText(recovery).then(() => setNote("Recovery key disalin."), (e) => setError(errorMessage(e)));
  };

  const alert = error && (
    <p role="alert" className="m-0 text-sm text-danger">
      {error}
    </p>
  );
  const noteLine = note && <p className="m-0 text-sm text-muted">{note}</p>;

  function body(): ReactNode {
    if (!status) return <p className="m-0 text-xs text-muted">Memuat status sync…</p>;
    if (!status.configured) return <p className="m-0 text-sm text-muted">Sync belum tersedia di build ini.</p>;
    if (!status.signedIn) {
      if (waiting) {
        return (
          <div className="flex items-center gap-3">
            <p className="m-0 text-sm text-ink">Menunggu login di browser…</p>
            <button type="button" onClick={cancelSignIn} className={SECONDARY}>
              Batal
            </button>
          </div>
        );
      }
      return (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void signIn("google")} className={PRIMARY}>
            Masuk dengan Google
          </button>
          <button type="button" disabled={busy} onClick={() => void signIn("github")} className={SECONDARY}>
            Masuk dengan GitHub
          </button>
        </div>
      );
    }
    if (recovery !== null) {
      return (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-sm text-ink">
            Simpan recovery key ini di tempat aman. Kunci ini hanya tampil sekali dan tidak disimpan di Anchoa.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 select-all break-all rounded-[10px] border border-line bg-surface-2 px-3.5 py-2.5 font-mono text-sm text-ink">
              {recovery}
            </code>
            <button type="button" onClick={copy} className={SECONDARY}>
              Salin
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            Sudah saya simpan
          </label>
          <div>
            <button
              type="button"
              disabled={!saved}
              onClick={() => {
                setRecovery(null);
                setSaved(false);
              }}
              className={PRIMARY}
            >
              Lanjut
            </button>
          </div>
        </div>
      );
    }
    if (status.needsUnlockKey && status.vaultExists === false) {
      return (
        <form onSubmit={createKey} className="flex flex-col gap-3">
          <p className="m-0 text-sm text-ink">
            Buat frasa sandi sync (minimal {MIN_PASSPHRASE} karakter). Data dienkripsi dengan frasa sandi ini sebelum dikirim.
          </p>
          <Field label="Frasa sandi sync">
            <input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} className={FIELD} />
          </Field>
          <Field label="Ulangi frasa sandi">
            <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={FIELD} />
          </Field>
          <div>
            <button type="submit" disabled={busy} className={PRIMARY}>
              {busy ? "Membuat kunci…" : "Buat kunci"}
            </button>
          </div>
        </form>
      );
    }
    if (status.needsUnlockKey && status.vaultExists === true) {
      return (
        <form onSubmit={unlockKey} className="flex flex-col gap-3">
          <p className="m-0 text-sm text-ink">Akun ini sudah punya kunci sync. Buka kunci di perangkat ini.</p>
          <Field label="Frasa sandi atau recovery key">
            <input type="password" autoComplete="off" value={unlock} onChange={(e) => setUnlock(e.target.value)} className={FIELD} />
          </Field>
          <div>
            <button type="submit" disabled={busy} className={PRIMARY}>
              {busy ? "Membuka…" : "Buka kunci"}
            </button>
          </div>
        </form>
      );
    }
    if (status.needsUnlockKey) {
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 text-sm text-muted">Status kunci di cloud belum bisa diperiksa. Periksa koneksi lalu coba lagi.</p>
          <button type="button" disabled={busy} onClick={() => void run(async () => {})} className={SECONDARY}>
            Coba lagi
          </button>
        </div>
      );
    }
    const ratio = status.quotaBytes > 0 ? Math.min(1, status.bytesUsed / status.quotaBytes) : 0;
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 break-all text-sm text-ink">Masuk sebagai {status.email ?? "akun Anda"}</p>
        <p className="m-0 text-xs text-muted">
          Sinkron terakhir: {status.lastSyncAt ? relativeTime(status.lastSyncAt, Date.now()) : "belum pernah"}
        </p>
        {status.lastError && (
          <p role="alert" className="m-0 text-xs text-danger">
            Sync terakhir gagal: {status.lastError}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <div
            role="progressbar"
            aria-label="Pemakaian cloud"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratio * 100)}
            className="h-2 overflow-hidden rounded-full bg-surface-2"
          >
            <div className={`h-full ${ratio >= 0.9 ? "bg-danger" : "bg-accent"}`} style={{ width: `${ratio * 100}%` }} />
          </div>
          <span className="font-mono text-xs text-muted">
            {formatBytes(status.bytesUsed)} dari {formatBytes(status.quotaBytes)}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void syncNow()} className={PRIMARY}>
            {busy ? "Menyinkronkan…" : "Sinkronkan sekarang"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setDialog("passphrase");
            }}
            className={SECONDARY}
          >
            Ganti frasa sandi
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setError(null);
              setDialog("signOut");
            }}
            className={`${SECONDARY} text-danger`}
          >
            Matikan sync
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className={`${PANEL} flex flex-col items-start gap-3`}>
      <h2 className={H2}>Sinkron antarperangkat</h2>
      {status?.configured && (
        <p className="m-0 text-xs text-muted">
          Login Google atau GitHub hanya menunjukkan akun mana yang dipakai; frasa sandi sync itu terpisah dan tidak pernah
          meninggalkan perangkat ini. Kalau frasa sandi dan recovery key sama-sama hilang, salinan di cloud tidak bisa
          dibuka lagi. Data lokal di perangkat ini tetap aman.
        </p>
      )}
      <div className="w-full">{body()}</div>
      {dialog === null && alert}
      {noteLine}

      {dialog === "passphrase" && (
        <Dialog title="Ganti frasa sandi" onClose={closeDialog}>
          <form onSubmit={changePassphrase} className="flex flex-col gap-3">
            <Field label="Frasa sandi lama">
              <input type="password" autoComplete="current-password" value={oldPass} onChange={(e) => setOldPass(e.target.value)} className={FIELD} />
            </Field>
            <Field label="Frasa sandi baru">
              <input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} className={FIELD} />
            </Field>
            <Field label="Ulangi frasa sandi baru">
              <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={FIELD} />
            </Field>
            {alert}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={closeDialog} className={SECONDARY}>
                Batal
              </button>
              <button type="submit" disabled={busy} className={PRIMARY}>
                {busy ? "Menyimpan…" : "Ganti"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {dialog === "signOut" && (
        <Dialog title="Matikan sync" onClose={closeDialog}>
          <p className="m-0 text-sm text-muted">
            Perangkat ini berhenti menyinkronkan. Data lokal tetap ada.
          </p>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={deleteCloud} onChange={(e) => setDeleteCloud(e.target.checked)} />
            Hapus juga data di cloud
          </label>
          {alert}
          <div className="flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={closeDialog} className={SECONDARY}>
              Batal
            </button>
            <button type="button" disabled={busy} onClick={() => void signOut()} className={`${SECONDARY} text-danger`}>
              {busy ? "Mematikan…" : "Matikan sync"}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
