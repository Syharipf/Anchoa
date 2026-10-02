import { useState, type FormEvent } from "react";
import { Dialog } from "../shell/Dialog";
import { FIELD, PRIMARY, SECONDARY } from "../shell/ui";
import { parseRecipients } from "./view";
import { useEmailSend } from "./useEmailSend";

export function ComposeDialog({ onClose, onSent }: Readonly<{ onClose: () => void; onSent: () => void }>) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const { busy, error, send } = useEmailSend();
  const recipients = parseRecipients(to);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await send({ to: recipients, subject, body }, () => { onSent(); onClose(); });
  }

  return (
    <Dialog title="Tulis email" onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label htmlFor="email-to" className="text-xs text-muted">Kepada (pisahkan dengan koma)</label>
        <input id="email-to" required disabled={busy} value={to} onChange={(e) => setTo(e.target.value)} className={FIELD} />
        <label htmlFor="email-subject" className="text-xs text-muted">Subjek</label>
        <input id="email-subject" disabled={busy} value={subject} onChange={(e) => setSubject(e.target.value)} className={FIELD} />
        <label htmlFor="email-body" className="text-xs text-muted">Isi</label>
        <textarea id="email-body" required disabled={busy} rows={7} value={body} onChange={(e) => setBody(e.target.value)} className={`${FIELD} resize-y`} />
        {error && <p role="alert" className="m-0 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className={SECONDARY}>Batal</button>
          <button type="submit" disabled={busy || !recipients.length || !body.trim()} className={PRIMARY}>{busy ? "Mengirim…" : "Kirim"}</button>
        </div>
      </form>
    </Dialog>
  );
}
