import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorMessage, type SecurityStatus } from "../api";
import { FIELD, H1, PRIMARY } from "../shell/ui";
import { LautAko } from "../pet/LautAko";
import { AnchoaPet } from "../pet/AnchoaPet";

type Method = "pin" | "password";

const COOLDOWN_RE = /\d+\s+detik/;

export function LockScreen({
  onUnlocked,
  status,
}: Readonly<{
  onUnlocked: () => void;
  status?: SecurityStatus | null;
}>) {
  const [method, setMethod] = useState<Method>("pin");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const hadCooldown = useRef(false);
  const needsFocus = useRef(false);

  const disabled = busy || cooldown > 0;
  const pinEnabled = status?.pinEnabled ?? true;
  const passwordEnabled = status?.passwordEnabled ?? false;
  const showToggle = pinEnabled && passwordEnabled;
  const active: Method = !pinEnabled && passwordEnabled ? "password" : method;

  useEffect(() => {
    if (cooldown > 0) {
      hadCooldown.current = true;
      const timer = window.setInterval(() => {
        setCooldown((prev) => (prev > 1 ? prev - 1 : 0));
      }, 1000);
      return () => window.clearInterval(timer);
    }
    if (hadCooldown.current) {
      hadCooldown.current = false;
      setError(null);
      needsFocus.current = true;
    }
  }, [cooldown]);

  useEffect(() => {
    if (!disabled && needsFocus.current) {
      needsFocus.current = false;
      inputRef.current?.focus();
    }
  });

  async function handleUnlock(e: FormEvent) {
    e.preventDefault();
    if (busy || cooldown > 0 || !secret) return;

    setBusy(true);
    setError(null);
    try {
      if (active === "password") {
        await api.unlockPassword(secret);
      } else {
        await api.unlock(secret);
      }
      onUnlocked();
    } catch (err) {
      const msg = errorMessage(err);
      setError(msg);
      const match = msg.match(/(\d+)\s+detik/);
      if (match) {
        setCooldown(Number.parseInt(match[1], 10));
      } else {
        needsFocus.current = true;
      }
      setSecret("");
    } finally {
      setBusy(false);
    }
  }

  const displayError =
    cooldown > 0
      ? error?.replace(COOLDOWN_RE, `${cooldown} detik`) ??
        `Terlalu banyak percobaan. Coba lagi dalam ${cooldown} detik.`
      : error && !COOLDOWN_RE.test(error)
      ? error
      : null;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-stage p-6 text-ink">
      {/* ponytail: the water and Ako are decoration; the form below stays a plain labelled input so screen readers and the existing tests keep the same contract. */}
      <LautAko className="z-0" />
      <AnchoaPet
        status={cooldown > 0 ? "idle" : busy ? "thinking" : "idle"}
        crop="full"
        size={230}
        shadow={false}
        className="pointer-events-none absolute bottom-0 left-1/2 z-[1] -translate-x-1/2 opacity-[0.55]"
      />

      <div className="laut-card relative z-10 flex w-full max-w-[380px] flex-col items-center gap-5 rounded-[18px] border border-line/70 bg-surface/90 p-6 backdrop-blur-md">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <h1 className={H1}>Anchoa terkunci</h1>
          <p className="m-0 text-xs text-muted">
            {active === "password"
              ? "Masukkan kata sandi untuk membuka aplikasi"
              : "Masukkan PIN Anda untuk membuka aplikasi"}
          </p>
        </div>

        {showToggle && (
          <div role="group" aria-label="Metode buka" className="flex gap-1 rounded-full bg-canvas p-1">
            {(["pin", "password"] as const).map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={active === id}
                onClick={() => {
                  setMethod(id);
                  setSecret("");
                  setError(null);
                  needsFocus.current = true;
                }}
                disabled={disabled}
                className={`min-h-8 rounded-full px-3.5 text-[13px] transition-colors ${
                  active === id ? "bg-accent font-semibold text-canvas" : "text-muted hover:text-ink"
                }`}
              >
                {id === "pin" ? "PIN" : "Kata sandi"}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleUnlock} className="flex w-full flex-col gap-4">
          {displayError && (
            <div
              role="alert"
              className="rounded-lg border border-danger/40 bg-danger-row p-3 text-xs text-danger"
            >
              {displayError}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="lock-secret" className="text-xs text-muted">
              {active === "password" ? "Kata sandi" : "PIN"}
            </label>
            <input
              id="lock-secret"
              ref={inputRef}
              type="password"
              inputMode={active === "password" ? "text" : "numeric"}
              autoFocus
              autoComplete="current-password"
              aria-label={active === "password" ? "Kata sandi" : "PIN"}
              placeholder={active === "password" ? "Masukkan kata sandi" : "Masukkan PIN"}
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
                setError(null);
              }}
              disabled={disabled}
              className={`${FIELD} w-full text-center text-lg ${
                active === "password" ? "" : "tracking-widest"
              }`}
            />
          </div>

          <button
            type="submit"
            disabled={disabled || !secret}
            className={`${PRIMARY} w-full`}
          >
            {busy ? "Membuka…" : "Buka"}
          </button>
        </form>

        <details className="w-full text-center text-xs text-muted">
          <summary className="cursor-pointer hover:text-ink">Lupa PIN?</summary>
          <div className="mt-3 rounded-lg border border-line bg-surface p-3 text-left text-xs leading-relaxed text-muted">
            <p className="m-0 font-medium text-ink">Reset PIN lewat terminal:</p>
            <ol className="m-0 mt-2 list-decimal space-y-1.5 pl-4">
              <li>Tutup aplikasi Anchoa (close Anchoa).</li>
              <li>
                Buka terminal, lalu jalankan perintah sqlite3 pada berkas{" "}
                <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-ink">
                  anchoa.db
                </code>{" "}
                di folder data aplikasi (app data dir) untuk menghapus baris pengaturan{" "}
                <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-ink">
                  security.pin_hash
                </code>
                :
              </li>
            </ol>
            <pre className="mt-2 overflow-x-auto rounded border border-line bg-canvas p-2 font-mono text-[11px] text-ink">
              sqlite3 ~/.local/share/io.github.syharipf.anchoa/anchoa.db "DELETE FROM settings WHERE key = 'security.pin_hash';"
            </pre>
            <p className="m-0 mt-2">
              Setelah baris security.pin_hash dihapus, buka kembali Anchoa. PIN akan nonaktif.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}