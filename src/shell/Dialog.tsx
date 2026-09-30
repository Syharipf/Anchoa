import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { H2, PRIMARY, SECONDARY } from "./ui";

const FOCUSABLE = "input, select, textarea, button:not([disabled])";

/** Modal form: focus stays inside, Esc closes, focus returns to the opener (spec Fase 2 §5). */
export function Dialog({ title, onClose, children }: Readonly<{ title: string; onClose: () => void; children: ReactNode }>) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    return () => previous?.focus();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      const items = box.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div className="fixed inset-0 z-40" onKeyDown={onKeyDown}>
      <button aria-label="Tutup" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-[#05070a]/80" />
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-anim
        style={{ animation: "anchoa-pop 0.16s ease-out" }}
        className="absolute top-[90px] left-1/2 -ml-[240px] flex w-[480px] flex-col gap-4 rounded-2xl border border-[#2e3440] bg-surface p-6 shadow-[0_24px_60px_rgb(0_0_0/0.65)]"
      >
        <h2 id={titleId} className={H2}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/** A labelled form control. */
export function Field({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-muted">
      {label}
      {children}
    </label>
  );
}

/** Hapus (asks once more), Batal and Simpan. Pass `onDelete` only when editing. */
export function DialogActions({
  busy,
  onCancel,
  onDelete,
  deleteLabel = "Hapus",
}: Readonly<{ busy: boolean; onCancel: () => void; onDelete?: () => void; deleteLabel?: string }>) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2">
      {onDelete && (
        <button
          type="button"
          disabled={busy}
          onClick={() => (confirming ? onDelete() : setConfirming(true))}
          className="min-h-10 rounded-full px-3 text-[13px] text-danger transition-colors hover:bg-danger-row"
        >
          {confirming ? "Yakin hapus?" : deleteLabel}
        </button>
      )}
      <button type="button" onClick={onCancel} className={`${SECONDARY} ml-auto`}>
        Batal
      </button>
      <button type="submit" disabled={busy} className={PRIMARY}>
        Simpan
      </button>
    </div>
  );
}
