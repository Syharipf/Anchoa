import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../shell/toast";

/** Search/command bar. For now Enter saves the text as an inbox note. */
export function CommandBar({ onSaved, focusSignal }: Readonly<{ onSaved: () => void; focusSignal: number }>) {
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
    <label className="flex flex-1 items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5 py-[11px] transition-colors focus-within:border-field-focus">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) void save();
        }}
        aria-label="Cari atau jalankan perintah"
        placeholder="Cari, tulis ide, atau jalankan perintah…"
        className="flex-1 border-0 bg-transparent text-sm text-ink outline-none placeholder:text-muted focus-visible:outline-none"
      />
      <kbd className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted">Ctrl K</kbd>
    </label>
  );
}
