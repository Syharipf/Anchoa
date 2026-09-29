import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../shell/toast";
import { FIELD } from "../shell/ui";

export function QuickCapture({ onSaved, focusSignal }: Readonly<{ onSaved: () => void; focusSignal: number }>) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusSignal > 0) input.current?.focus();
  }, [focusSignal]);

  async function save() {
    if (!text.trim() || saving) return;
    setSaving(true);
    try {
      await api.captureNote(text);
      setText("");
      toast("Tersimpan ke Inbox");
      onSaved();
    } catch (e) {
      // Leave the text in place so nothing typed is lost.
      toast(errorMessage(e), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      ref={input}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) void save();
      }}
      placeholder="Tulis ide cepat… (Enter = simpan ke Inbox, Ctrl+N dari mana saja)"
      aria-label="Quick capture"
      className={`${FIELD} w-full placeholder:text-muted`}
    />
  );
}
