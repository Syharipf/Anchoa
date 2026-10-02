import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorMessage, type EmailAssistance, type EmailMessage } from "../api";
import { ProposalCard } from "../assistant/ProposalCard";
import { FIELD, PRIMARY, SECONDARY } from "../shell/ui";
import { StarButton } from "./StarButton";
import { emailDate, replySubject, sender, textParts } from "./view";
import { useEmailSend } from "./useEmailSend";

// A proposal the user can no longer see must not stay queued in the backend.
function dropProposal(id: string) {
  api.assistantDecide(id, false).catch(() => undefined);
}

export function ReadingPane({ message, busy, onStar, onArchive, onSent, onChanged }: Readonly<{
  message: EmailMessage; busy: boolean; onStar: (message: EmailMessage) => void;
  onArchive: (message: EmailMessage) => void; onSent: () => void; onChanged?: () => void;
}>) {
  const [reply, setReply] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [assistance, setAssistance] = useState<EmailAssistance | null>(null);
  const [assisting, setAssisting] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const generation = useRef(0);
  const requesting = useRef(false);
  const shownAction = useRef<string | null>(null);
  const sending = useEmailSend();
  const recipients = message.folder === "[Gmail]/Sent Mail" ? message.toAddrs : [message.fromAddr];

  useEffect(() => {
    setAssistance(null);
    setAssisting(false);
    setAssistError(null);
    setActionStatus(null);
    setReply("");
    requesting.current = false;
    return () => {
      generation.current++;
      if (shownAction.current) dropProposal(shownAction.current);
      shownAction.current = null;
    };
  }, [message.id]);

  async function assist() {
    if (busy || requesting.current || assistance?.action) return;
    const token = generation.current;
    requesting.current = true;
    setAssisting(true);
    setAssistError(null);
    setActionStatus(null);
    try {
      const result = await api.emailAssist(message.id);
      if (generation.current !== token) {
        if (result.action) dropProposal(result.action.id);
        return;
      }
      shownAction.current = result.action?.id ?? null;
      setAssistance(result);
    } catch (e) {
      if (generation.current === token) setAssistError(errorMessage(e));
    } finally {
      if (generation.current === token) {
        requesting.current = false;
        setAssisting(false);
      }
    }
  }

  async function decide(id: string, approve: boolean) {
    const token = generation.current;
    setAssistError(null);
    try {
      await api.assistantDecide(id, approve);
      if (shownAction.current === id) shownAction.current = null;
      if (approve) onChanged?.();
      if (generation.current !== token) return;
      setAssistance((current) => current ? { ...current, action: null } : current);
      setActionStatus(approve ? "Usulan disetujui." : "Usulan ditolak.");
    } catch (e) {
      if (generation.current === token) setAssistError(errorMessage(e));
      throw e;
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    await sending.send({ to: recipients, subject: replySubject(message.subject), body: reply, replyToId: message.id }, () => {
      setReply("");
      onSent();
    });
  }

  return (
    <article aria-labelledby="email-reading-subject" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-line bg-surface">
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-[18px]">
        <div className="flex items-start gap-2">
          <h2 id="email-reading-subject" className="m-0 min-w-0 flex-1 break-words font-display text-[19px] font-semibold">{message.subject || "(Tanpa subjek)"}</h2>
          <StarButton message={message} busy={busy || sending.busy} onStar={onStar} />
          <button type="button" disabled={busy || sending.busy} onClick={() => onArchive(message)} className={`${SECONDARY} shrink-0 px-3`}>Arsipkan</button>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 font-display text-sm font-semibold">{sender(message).charAt(0).toUpperCase()}</span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[13px] font-semibold">{sender(message)}</span>
            <span className="break-all font-mono text-[11px] text-muted">{message.fromAddr}</span>
          </div>
          <time dateTime={new Date(message.sentAt).toISOString()} className="text-xs text-muted">{emailDate(message.sentAt)}</time>
        </div>
        <section aria-labelledby="email-assistant-heading" aria-busy={assisting} className="flex flex-col gap-2 rounded-xl border border-line bg-stage px-3.5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="email-assistant-heading" className="m-0 text-xs font-semibold tracking-wider text-accent uppercase">Ringkasan asisten</h3>
            <button type="button" aria-label="Ringkas email" disabled={busy || assisting || !!assistance?.action} onClick={assist}
              className={`${SECONDARY} min-h-8 px-3 text-xs disabled:opacity-50`}>{assistance ? "Ringkas lagi" : "Ringkas email"}</button>
          </div>
          {assisting && <p role="status" className="m-0 text-xs text-muted">Asisten sedang merangkum…</p>}
          {assistance && <ul className="m-0 flex list-disc flex-col gap-1 pl-[18px] text-[13px] leading-relaxed text-ink">
            {assistance.summary.map((point) => <li key={point}>{point}</li>)}
          </ul>}
          {assistance?.action && <ProposalCard proposal={assistance.action} onDecide={decide} />}
          {actionStatus && <p role="status" className="m-0 text-xs text-muted">{actionStatus}</p>}
          {assistError && <p role="alert" className="m-0 text-sm text-danger">{assistError}</p>}
        </section>
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
          {textParts(message.body).map((part) => part.url ? (
            <button key={part.offset} type="button" aria-label={`Buka ${part.url}`} className="inline text-left text-accent underline hover:text-accent-hover"
              onClick={() => { setLinkError(null); void api.openLink(part.url!).catch((e) => setLinkError(errorMessage(e))); }}>{part.text}</button>
          ) : <span key={part.offset}>{part.text}</span>)}
        </div>
        {linkError && <p role="alert" className="m-0 text-sm text-danger">{linkError}</p>}
      </div>
      <form onSubmit={submit} className="flex shrink-0 flex-col gap-2 border-t border-line bg-stage py-3 pr-[88px] pl-5">
        {assistance && <div role="group" aria-label="Saran balasan" className="flex flex-wrap gap-1.5">
          {assistance.replies.map((suggestion) => <button key={suggestion} type="button" disabled={busy || sending.busy}
            onClick={() => setReply(suggestion)} className={`${SECONDARY} min-h-7 px-2.5 text-xs disabled:opacity-50`}>{suggestion}</button>)}
        </div>}
        <label htmlFor="email-reply" className="text-xs text-muted">Balas ke {recipients.join(", ")}</label>
        <div className="flex items-end gap-2">
          <textarea id="email-reply" rows={2} required disabled={busy || sending.busy} value={reply}
            onChange={(e) => setReply(e.target.value)} placeholder="Tulis balasan…" className={`${FIELD} min-w-0 flex-1 resize-y`} />
          <button type="submit" aria-label="Kirim balasan" disabled={busy || sending.busy || !reply.trim()} className={PRIMARY}>{sending.busy ? "Mengirim…" : "Kirim"}</button>
        </div>
        {sending.error && <p role="alert" className="m-0 text-sm text-danger">{sending.error}</p>}
      </form>
    </article>
  );
}
