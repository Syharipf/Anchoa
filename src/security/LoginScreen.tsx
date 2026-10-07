import { useEffect, useState } from "react";
import { api, type SyncProvider } from "../api";
import { PRIMARY, SECONDARY } from "../shell/ui";

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
            className={`${PRIMARY} w-full`}
          >
            {busy ? "Memproses…" : "Lanjutkan dengan Google"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => signIn("github")}
            className={`${SECONDARY} w-full`}
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
            className="w-full rounded-lg border border-line bg-surface p-3 text-left text-sm text-muted hover:bg-surface-2 transition-colors"
          >
            <div className="flex items-center gap-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5a3 3 0 0 0-.9-2.4c3-.3 6-1.4 6-6.5a5 5 0 0 0-1.4-3.5 4.6 4.6 0 0 0-.1-3.5s-1.1-.3-3.6 1.4a12.5 12.5 0 0 0-6.6 0C5.9 1.3 4.8 1.6 4.8 1.6a4.6 4.6 0 0 0-.1 3.5A5 5 0 0 0 3.3 8.6c0 5.1 3 6.2 6 6.5a3 3 0 0 0-.9 2.4V21" />
              </svg>
              <span>Lewati — pakai lokal saja</span>
            </div>
          </button>

          <p className="m-0 text-center text-xs text-muted leading-relaxed">
            Pendaftaran akun baru ditutup — Anchoa hanya untuk akunmu. Sesi disimpan di keyring perangkat, bukan di file biasa.
          </p>
        </div>
      </div>
    </div>
  );
}