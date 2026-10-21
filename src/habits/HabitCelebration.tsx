export function HabitCelebration({
  message = "All habits completed for today!",
  onDismiss,
}: Readonly<{
  message?: string;
  onDismiss?: () => void;
}>) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="relative flex items-center justify-between gap-3 overflow-hidden rounded-2xl border border-accent/60 bg-gradient-to-r from-[#18262B] via-[#1E2A12] to-[#18262B] p-3.5 shadow-lg animate-fade"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-canvas font-bold text-base shadow-[0_0_12px_rgba(198,243,107,0.4)] animate-bounce">
          🎉
        </span>
        <div className="flex flex-col">
          <span className="font-display text-xs font-bold text-accent">
            Today's goals achieved!
          </span>
          <span className="text-[11px] text-ink">{message}</span>
        </div>
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-muted hover:text-ink transition-colors"
        >
          Close
        </button>
      )}
    </div>
  );
}
