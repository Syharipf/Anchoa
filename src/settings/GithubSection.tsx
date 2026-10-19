import { useEffect, useState, type FormEvent } from "react";
import { api, errorMessage, type GithubStatus } from "../api";
import { useToast } from "../shell/toast";
import { FIELD, H2, PANEL } from "../shell/ui";

/** Connect a GitHub token for the contributions heatmap. The token never comes back to the UI. */
export function GithubSection({ onChanged }: Readonly<{ onChanged: () => void }>) {
  const toast = useToast();
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.githubStatus().then(setStatus, (e) => toast(errorMessage(e), "error"));
  }, [toast]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  function connect(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    void run(async () => {
      const next = await api.connectGithub(token);
      setStatus(next);
      setToken("");
      toast(`Tersambung sebagai @${next.login}`);
    });
  }

  const refresh = () =>
    run(async () => {
      const result = await api.getContributions(true);
      toast(result.error ?? "Data kontribusi diperbarui", result.error ? "error" : "info");
    });

  const disconnect = () =>
    run(async () => {
      await api.disconnectGithub();
      setStatus({ connected: false, login: null });
      toast("GitHub diputus, token dihapus");
    });

  return (
    <section className={`${PANEL} flex flex-col gap-3`}>
      <h2 className={H2}>GitHub</h2>
      {status?.connected ? (
        <>
          <p className="m-0 text-sm">
            Tersambung sebagai <span className="font-mono text-accent">@{status.login}</span>
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => void refresh()}
              disabled={busy}
              className="flex h-8 items-center rounded-[9px] border border-line bg-surface px-3 text-xs text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              Muat ulang data
            </button>
            <button
              onClick={() => void disconnect()}
              disabled={busy}
              className="flex h-8 items-center rounded-[9px] border border-line bg-surface px-3 text-xs text-danger transition-colors hover:bg-danger-row disabled:opacity-50"
            >
              Putuskan
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={connect} className="flex flex-col gap-2">
          <label htmlFor="github-token" className="text-sm">
            Token GitHub
          </label>
          <div className="flex gap-2">
            <input
              id="github-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_…"
              className={`${FIELD} flex-1 font-mono placeholder:text-muted`}
            />
            <button
              type="submit"
              disabled={busy || !token.trim()}
              className="flex h-8 items-center rounded-[9px] bg-accent px-3.5 text-xs font-semibold text-canvas transition-colors hover:brightness-105 disabled:bg-disabled disabled:text-muted self-start"
            >
              {busy ? "Memeriksa…" : "Sambungkan"}
            </button>
          </div>
          <p className="m-0 text-xs text-muted">
            Buat token di GitHub → Settings → Developer settings → Personal access tokens. Token klasik dengan izin
            read:user sudah cukup. Token disimpan di file lokal yang hanya bisa dibaca akunmu, tidak masuk database
            maupun backup.
          </p>
        </form>
      )}
    </section>
  );
}
