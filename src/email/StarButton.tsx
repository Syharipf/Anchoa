import type { EmailMessage } from "../api";

export function StarButton({ message, busy, onStar }: Readonly<{
  message: EmailMessage; busy: boolean; onStar: (message: EmailMessage) => void;
}>) {
  return (
    <button type="button" disabled={busy} aria-label={`${message.starred ? "Hapus bintang" : "Bintangi"} ${message.subject}`}
      aria-pressed={message.starred} onClick={() => onStar(message)}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-surface-2 disabled:opacity-50 ${message.starred ? "text-cat-bill" : "text-muted"}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill={message.starred ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />
      </svg>
    </button>
  );
}
