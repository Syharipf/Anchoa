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
    mode === "create" ? "Buat kata sandi" : mode === "change" ? "Ganti kata sandi" : "Matikan kata sandi";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;

    if (mode !== "disable") {
      if (!isValidPassword(next)) {
        setError("Kata sandi harus 8–128 karakter");
        return;
      }
      if (next !== confirm) {
        setError("Konfirmasi kata sandi tidak cocok");
        return;
      }
    }
    if ((mode === "change" || mode === "disable") && !current) {
      setError(mode === "disable" ? "Masukkan kata sandi atau PIN saat ini" : "Kata sandi saat ini harus diisi");
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
          <Field label="Kata sandi atau PIN saat ini">
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              aria-label="Kata sandi saat ini"
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
              <Field label="Kata sandi saat ini">
                <input
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  aria-label="Kata sandi saat ini"
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
            <Field label={mode === "create" ? "Kata sandi (8–128 karakter)" : "Kata sandi baru (8–128 karakter)"}>
              <input
                type="password"
                autoFocus={mode === "create"}
                autoComplete="new-password"
                aria-label={mode === "create" ? "Kata sandi" : "Kata sandi baru"}
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
            <Field label="Konfirmasi kata sandi">
              <input
                type="password"
                autoComplete="new-password"
                aria-label="Konfirmasi kata sandi"
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