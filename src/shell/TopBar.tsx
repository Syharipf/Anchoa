import { Clock } from "./Clock";

/** Search-style button that opens the command palette, plus the clock (DESIGN.md §1). */
export function TopBar({ onOpenPalette }: Readonly<{ onOpenPalette: () => void }>) {
  return (
    <div className="flex items-center gap-4">
      <button
        onClick={onOpenPalette}
        aria-haspopup="dialog"
        className="flex h-[42px] flex-1 items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3.5 text-left text-sm text-muted transition-colors hover:border-field-focus"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <span className="flex-1">Cari atau jalankan perintah…</span>
        <kbd className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px]">Ctrl K</kbd>
      </button>
      <Clock />
    </div>
  );
}
