import { useState } from "react";
import { errorMessage } from "../api";
import { useToast } from "../shell/toast";

/** Runs one save at a time. A failure shows a toast and keeps the form open with what was typed. */
export function useSave(onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      onDone();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  return { busy, run, toast };
}
