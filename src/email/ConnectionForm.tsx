import { useRef, useState, type FormEvent } from "react";
import { api, errorMessage, type EmailStatus } from "../api";
import { FIELD, H2, PANEL, PRIMARY } from "../shell/ui";

export function ConnectionForm({ onConnected }: Readonly<{ onConnected: (status: EmailStatus) => void }>) {
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !address.trim() || !password.trim()) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setPassword("");
    try {
      onConnected(await api.emailConnect(address.trim(), password));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <section className={`${PANEL} mx-auto flex w-full max-w-lg flex-col gap-4`} aria-labelledby="email-connect-title">
      <h2 id="email-connect-title" className={H2}>Sambungkan Gmail</h2>
      <p className="m-0 text-sm text-muted">Baca dan kirim email Gmail dengan App Password Google.</p>
      <ol className="m-0 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink">
        <li>Aktifkan 2-Step Verification di akun Google.</li>
        <li>
          Buka {" "}
          <button type="button" className="text-accent underline hover:text-accent-hover"
            onClick={() => void api.openLink("https://myaccount.google.com/apppasswords").catch((e) => setError(errorMessage(e)))}>
            myaccount.google.com/apppasswords
          </button> dan buat App Password untuk Anchoa.
        </li>
        <li>Masukkan alamat Gmail dan password 16 huruf di bawah ini (spasi boleh).</li>
      </ol>
      <form onSubmit={connect} className="flex flex-col gap-3">
        <label htmlFor="email-address" className="text-xs text-muted">Alamat Gmail</label>
        <input id="email-address" type="email" autoComplete="email" autoFocus required disabled={busy} value={address}
          onChange={(e) => setAddress(e.target.value)} className={FIELD} placeholder="nama@gmail.com" />
        <label htmlFor="email-password" className="text-xs text-muted">App Password</label>
        <input id="email-password" type="password" autoComplete="off" required disabled={busy} value={password}
          onChange={(e) => setPassword(e.target.value)} className={FIELD} />
        {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy || !address.trim() || !password.trim()} className={`${PRIMARY} self-start`}>
          {busy ? "Menyambungkan…" : "Sambungkan"}
        </button>
      </form>
    </section>
  );
}
