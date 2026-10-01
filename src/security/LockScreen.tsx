import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorMessage } from "../api";
import { FIELD, H1, PRIMARY } from "../shell/ui";

export function LockScreen({
  onUnlocked,
}: Readonly<{
  onUnlocked: () => void;
}>) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((prev) => {
        if (prev > 1) return prev - 1;
        inputRef.current?.focus();
        return 0;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function handleUnlock(e: FormEvent) {
    e.preventDefault();
    if (busy || cooldown > 0 || !pin) return;

    setBusy(true);
    setError(null);
    try {
      await api.unlock(pin);
      onUnlocked();
    } catch (err) {
      const msg = errorMessage(err);
      setError(msg);
      const match = msg.match(/(\d+)\s+detik/);
      if (match) {
        setCooldown(Number.parseInt(match[1], 10));
      }
      setPin("");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const displayError =
    cooldown > 0
      ? error?.replace(/\d+\s+detik/, `${cooldown} detik`) ??
        `Terlalu banyak percobaan. Coba lagi dalam ${cooldown} detik.`
      : error;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-canvas p-6 text-ink">
      <div className="flex w-full max-w-[360px] flex-col items-center gap-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-surface">
          <svg
            width="40"
            height="40"
            viewBox="0 0 40 40"
            role="img"
            aria-label="Logo Anchoa"
            className="shrink-0"
          >
            <rect width="40" height="40" rx="12" className="fill-accent" />
            <text
              x="20"
              y="26"
              textAnchor="middle"
              className="fill-canvas font-display text-lg font-semibold"
            >
              A
            </text>
          </svg>
        </div>

        <div className="flex flex-col items-center gap-1.5 text-center">
          <h1 className={H1}>Anchoa terkunci</h1>
          <p className="m-0 text-xs text-muted">
            Masukkan PIN Anda untuk membuka aplikasi
          </p>
        </div>

        <form onSubmit={handleUnlock} className="flex w-full flex-col gap-4">
          {displayError && (
            <div
              role="alert"
              className="rounded-lg border border-[#5a2e2b] bg-danger-row p-3 text-xs text-danger"
            >
              {displayError}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              autoFocus
              autoComplete="current-password"
              aria-label="PIN"
              placeholder="Masukkan PIN"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setError(null);
              }}
              disabled={busy || cooldown > 0}
              className={`${FIELD} w-full text-center text-lg tracking-widest`}
            />
          </div>

          <button
            type="submit"
            disabled={busy || cooldown > 0 || !pin}
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
              sqlite3 ~/.local/share/anchoa/anchoa.db "DELETE FROM settings WHERE key = 'security.pin_hash';"
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
