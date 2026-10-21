import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../api";
import { Dialog, DialogActions, Field } from "../shell/Dialog";
import { FIELD } from "../shell/ui";

export type PasswordFormMode = "create" | "change" | "disable";

export function isValidPassword(password: string): boolean {
  const length = [...password].length;
  return length >= 8 && length <= 128;
}

export function PasswordDialog({
  mode,
  onClose,
  onSuccess,
}: Readonly<{
  mode: PasswordFormMode;
  onClose: () => void;
  onSuccess: () => void;
}>) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const title =
    mode === "create" ? "Create password" : mode === "change" ? "Change password" : "Disable password";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;

    if (mode !== "disable") {
      if (!isValidPassword(next)) {
        setError("Password must be 8–128 characters");
        return;
      }
      if (next !== confirm) {
        setError("Password confirmation does not match");
        return;
      }
    }
    if ((mode === "change" || mode === "disable") && !current) {
      setError(mode === "disable" ? "Enter current password or PIN" : "Current password is required");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (mode === "create") {
        await api.setPassword(null, next);
      } else if (mode === "change") {
        await api.setPassword(current, next);
      } else {
        await api.disablePassword(current);
      }
      onSuccess();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCurrent("");
      setNext("");
      setConfirm("");
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-danger/40 bg-danger-row p-3 text-xs text-danger"
          >
            {error}
          </div>
        )}

        {mode === "disable" ? (
          <Field label="Current password or PIN">
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              aria-label="Current password"
              placeholder="••••••••"
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value);
                setError(null);
              }}
              disabled={busy}
              className={FIELD}
            />
          </Field>
        ) : (
          <>
            {mode === "change" && (
              <Field label="Current password">
                <input
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  aria-label="Current password"
                  placeholder="••••••••"
                  value={current}
                  onChange={(e) => {
                    setCurrent(e.target.value);
                    setError(null);
                  }}
                  disabled={busy}
                  className={FIELD}
                />
              </Field>
            )}
            <Field label={mode === "create" ? "Password (8–128 characters)" : "New password (8–128 characters)"}>
              <input
                type="password"
                autoFocus={mode === "create"}
                autoComplete="new-password"
                aria-label={mode === "create" ? "Password" : "New password"}
                placeholder="••••••••"
                value={next}
                onChange={(e) => {
                  setNext(e.target.value);
                  setError(null);
                }}
                disabled={busy}
                className={FIELD}
              />
            </Field>
            <Field label="Confirm password">
              <input
                type="password"
                autoComplete="new-password"
                aria-label="Confirm password"
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  setError(null);
                }}
                disabled={busy}
                className={FIELD}
              />
            </Field>
          </>
        )}

        <DialogActions busy={busy} onCancel={onClose} />
      </form>
    </Dialog>
  );
}