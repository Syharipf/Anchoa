import { FishProgress } from "../components/FishProgress";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, errorMessage, onSyncChanged, type SyncProvider, type SyncStatus } from "../api";
import { formatBytes, relativeTime } from "../format";
import { Dialog, Field } from "../shell/Dialog";
import { FIELD, H2, PANEL, PRIMARY, SECONDARY } from "../shell/ui";

const MIN_PASSPHRASE = 12;

/** The message to show when a new passphrase may not be used, or null when it is fine. */
export function passphraseProblem(pass: string, again: string): string | null {
  if (Array.from(pass).length < MIN_PASSPHRASE) return `Passphrase must be at least ${MIN_PASSPHRASE} characters.`;
  if (pass !== again) return "Both passphrases must match.";
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
    if (!unlock.trim()) return setError("Enter passphrase or recovery key.");
    return run(async () => {
      await api.syncUnlockKey(unlock.trim());
      clearFields();
    });
  }

  function changePassphrase(e: FormEvent) {
    e.preventDefault();
    if (!oldPass) return setError("Enter current passphrase.");
    const problem = passphraseProblem(pass, again);
    if (problem) return setError(problem);
    return run(async () => {
      await api.syncChangePassphrase(oldPass, pass);
      clearFields();
      setDialog(null);
      setNote("Passphrase updated.");
    });
  }

  const syncNow = () =>
    run(async () => {
      const report = await api.syncNow();
      setNote(
        report.stoppedByQuota
          ? "Cloud quota full: some data was not sent."
          : `Done: ${report.pushed} sent, ${report.pulled} received.`,
      );
    });

  const signOut = () =>
    run(async () => {
      const result = await api.syncSignOut(deleteCloud);
      setDialog(null);
      setDeleteCloud(false);
      if (!result.remoteRevoked) {
        setNote("Sync disabled on this device, but session revocation on the server could not be confirmed.");
      }
    });

  function closeDialog() {
    if (busy) return;
    setDialog(null);
    setDeleteCloud(false);
    setError(null);
    clearFields();
  }

  const copy = () => {
    if (recovery) navigator.clipboard.writeText(recovery).then(() => setNote("Recovery key copied."), (e) => setError(errorMessage(e)));
  };

  const alert = error && (
    <p role="alert" className="m-0 text-sm text-danger">
      {error}
    </p>
  );
  const noteLine = note && <p className="m-0 text-sm text-muted">{note}</p>;

  function body(): ReactNode {
    if (!status) return <p className="m-0 text-xs text-muted">Loading sync status…</p>;
    if (!status.configured) return <p className="m-0 text-sm text-muted">Sync is not available in this build.</p>;
    if (!status.signedIn) {
      if (waiting) {
        return (
          <div className="flex items-center gap-3">
            <p className="m-0 text-sm text-ink">Waiting for login in browser…</p>
            <button type="button" onClick={cancelSignIn} className={SECONDARY}>
              Cancel
            </button>
          </div>
        );
      }
      return (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void signIn("google")} className={PRIMARY}>
            Sign in with Google
          </button>
          <button type="button" disabled={busy} onClick={() => void signIn("github")} className={SECONDARY}>
            Sign in with GitHub
          </button>
        </div>
      );
    }
    if (recovery !== null) {
      return (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-sm text-ink">
            Save this recovery key in a safe place. This key is only shown once and is not stored in Anchoa.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 select-all break-all rounded-[10px] border border-line bg-surface-2 px-3.5 py-2.5 font-mono text-sm text-ink">
              {recovery}
            </code>
            <button type="button" onClick={copy} className={SECONDARY}>
              Copy
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            I have saved it
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
              Continue
            </button>
          </div>
        </div>
      );
    }
    if (status.needsUnlockKey && status.vaultExists === false) {
      return (
        <form onSubmit={createKey} className="flex flex-col gap-3">
          <p className="m-0 text-sm text-ink">
            Create a sync passphrase (minimum {MIN_PASSPHRASE} characters). Data is encrypted with this passphrase before being sent.
          </p>
          <Field label="Sync passphrase">
            <input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} className={FIELD} />
          </Field>
          <Field label="Repeat passphrase">
            <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={FIELD} />
          </Field>
          <div>
            <button type="submit" disabled={busy} className={PRIMARY}>
              {busy ? "Creating key…" : "Create key"}
            </button>
          </div>
        </form>
      );
    }
    if (status.needsUnlockKey && status.vaultExists === true) {
      return (
        <form onSubmit={unlockKey} className="flex flex-col gap-3">
          <p className="m-0 text-sm text-ink">This account already has a sync key. Unlock on this device.</p>
          <Field label="Passphrase or recovery key">
            <input type="password" autoComplete="off" value={unlock} onChange={(e) => setUnlock(e.target.value)} className={FIELD} />
          </Field>
          <div>
            <button type="submit" disabled={busy} className={PRIMARY}>
              {busy ? "Unlocking…" : "Unlock"}
            </button>
          </div>
        </form>
      );
    }
    if (status.needsUnlockKey) {
      return (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 text-sm text-muted">Unable to check key status in the cloud. Check connection and try again.</p>
          <button type="button" disabled={busy} onClick={() => void run(async () => {})} className={SECONDARY}>
            Try again
          </button>
        </div>
      );
    }
    const ratio = status.quotaBytes > 0 ? Math.min(1, status.bytesUsed / status.quotaBytes) : 0;
    return (
      <div className="flex flex-col gap-3">
        <p className="m-0 break-all text-sm text-ink">Signed in as {status.email ?? "your account"}</p>
        <p className="m-0 text-xs text-muted">
          Last sync: {status.lastSyncAt ? relativeTime(status.lastSyncAt, Date.now()) : "never"}
        </p>
        {status.lastError && (
          <p role="alert" className="m-0 text-xs text-danger">
            Last sync failed: {status.lastError}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <FishProgress
            role="meter"
            value={Math.round(ratio * 100)}
            label="Cloud usage"
            tone={ratio >= 0.9 ? "danger" : "accent"}
            className="h-2"
          />
          <span className="font-mono text-xs text-muted">
            {formatBytes(status.bytesUsed)} of {formatBytes(status.quotaBytes)}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void syncNow()} className={PRIMARY}>
            {busy ? "Syncing…" : "Sync now"}
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
            Change passphrase
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
            Turn off sync
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className={`${PANEL} flex flex-col items-start gap-3`}>
      <h2 className={H2}>Cross-device sync</h2>
      {status?.configured && (
        <p className="m-0 text-xs text-muted">
          Google or GitHub sign-in only identifies which account is used; the sync passphrase is separate and never
          leaves this device. If both passphrase and recovery key are lost, cloud copies cannot
          be reopened. Local data on this device remains safe.
        </p>
      )}
      <div className="w-full">{body()}</div>
      {dialog === null && alert}
      {noteLine}

      {dialog === "passphrase" && (
        <Dialog title="Change passphrase" onClose={closeDialog}>
          <form onSubmit={changePassphrase} className="flex flex-col gap-3">
            <Field label="Current passphrase">
              <input type="password" autoComplete="current-password" value={oldPass} onChange={(e) => setOldPass(e.target.value)} className={FIELD} />
            </Field>
            <Field label="New passphrase">
              <input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} className={FIELD} />
            </Field>
            <Field label="Repeat new passphrase">
              <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={FIELD} />
            </Field>
            {alert}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={closeDialog} className={SECONDARY}>
                Cancel
              </button>
              <button type="submit" disabled={busy} className={PRIMARY}>
                {busy ? "Saving…" : "Change"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {dialog === "signOut" && (
        <Dialog title="Turn off sync" onClose={closeDialog}>
          <p className="m-0 text-sm text-muted">
            This device will stop syncing. Local data is retained.
          </p>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={deleteCloud} onChange={(e) => setDeleteCloud(e.target.checked)} />
            Also delete cloud data
          </label>
          {alert}
          <div className="flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={closeDialog} className={SECONDARY}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => void signOut()} className={`${SECONDARY} text-danger`}>
              {busy ? "Turning off…" : "Turn off sync"}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
