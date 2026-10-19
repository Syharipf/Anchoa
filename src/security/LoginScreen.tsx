import { useEffect, useState } from "react";
import { api, type SyncProvider } from "../api";

export function LoginScreen({
  onSignedIn,
  onSkip,
}: Readonly<{
  onSignedIn: () => void;
  onSkip: () => void;
}>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async (provider: SyncProvider) => {
    setBusy(true);
    setError(null);
    try {
      await api.syncSignIn(provider);
      onSignedIn();
    } catch (err) {
      setError("Masuk gagal. Coba lagi atau pakai opsi lain.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    return () => {
      void api.syncCancelSignIn();
    };
  }, []);

  return (
    <div className="flex h-full w-full items-center justify-center bg-canvas p-6 text-ink">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="font-display text-[34px] font-semibold tracking-[-0.02em]">Anchoa</span>
          <p className="m-0 max-w-[340px] text-sm text-muted leading-relaxed">
            Dashboard pribadi dengan asisten suara. Tugas, jadwal, keuangan, jurnal, dan file laptopmu di satu tempat.
          </p>
          <p className="m-0 text-xs text-muted">
            Data tersimpan di Supabase (Singapura) · file tetap di laptopmu
          </p>
        </div>

        <div className="flex w-full flex-col gap-3">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-danger/40 bg-danger-row p-3 text-xs text-danger"
            >
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => signIn("google")}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-[9px] bg-accent px-4 text-xs font-semibold text-canvas transition-colors hover:brightness-105 disabled:bg-disabled disabled:text-muted"
          >
            {busy ? "Memproses…" : "Lanjutkan dengan Google"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => signIn("github")}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-[9px] border border-line bg-surface px-4 text-xs text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Masuk dengan GitHub
          </button>

          <div
            className="flex w-full items-center gap-3 text-xs text-muted"
            aria-hidden="true"
          >
            <span className="flex-1 h-px bg-line" />
            <span>atau</span>
            <span className="flex-1 h-px bg-line" />
          </div>

          <button
            type="button"
            onClick={onSkip}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-[9px] border border-line bg-surface px-4 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <span>Lewati — pakai lokal saja</span>
          </button>

          <p className="m-0 text-center text-xs text-muted leading-relaxed">
            Pendaftaran akun baru ditutup — Anchoa hanya untuk akunmu. Sesi disimpan di keyring perangkat, bukan di file biasa.
          </p>
        </div>
      </div>
    </div>
  );
}