import { useRef, useState } from "react";
import { api, errorMessage, type EmailDraft } from "../api";

/** Compose and reply share send state, without clearing a failed draft. */
export function useEmailSend() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(draft: EmailDraft, onSuccess: () => void) {
    if (pending.current || !draft.to.length || !draft.body.trim()) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await api.emailSend(draft);
      onSuccess();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return { busy, error, send };
}
