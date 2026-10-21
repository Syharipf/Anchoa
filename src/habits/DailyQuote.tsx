import { useState } from "react";

export interface Quote {
  text: string;
  author: string;
  source?: string;
}

export const HABIT_QUOTES: Quote[] = [
  {
    text: "You do not rise to the level of your goals. You fall to the level of your systems.",
    author: "James Clear",
    source: "Atomic Habits",
  },
  {
    text: "Discipline today is freedom tomorrow.",
    author: "Seneca",
    source: "Letters from a Stoic",
  },
  {
    text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.",
    author: "Will Durant",
  },
  {
    text: "Focus on small consistency rather than fleeting intensity that fades quickly.",
    author: "Marcus Aurelius",
    source: "Meditations",
  },
  {
    text: "A journey of a thousand miles begins with a single disciplined step.",
    author: "Lao Tzu",
  },
  {
    text: "Getting 1% better every day counts for a lot in the long run.",
    author: "James Clear",
    source: "Atomic Habits",
  },
  {
    text: "Good habits make time your ally; bad habits make time your enemy.",
    author: "Epictetus",
  },
];

export function getQuoteForDate(dateStr: string): number {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = (hash << 5) - hash + dateStr.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % HABIT_QUOTES.length;
}

export function DailyQuote({
  today,
}: Readonly<{
  today: string;
}>) {
  const [index, setIndex] = useState(() => getQuoteForDate(today));
  const quote = HABIT_QUOTES[index];

  function nextQuote() {
    setIndex((prev) => (prev + 1) % HABIT_QUOTES.length);
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface/80 px-4 py-2.5 shadow-sm">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent/15 font-serif text-xs font-bold text-accent">
          “
        </span>
        <p className="truncate text-xs italic text-ink" title={quote.text}>
          &ldquo;{quote.text}&rdquo;
          <span className="ml-1.5 font-sans not-italic text-muted font-medium">
            — {quote.author}
          </span>
        </p>
      </div>

      <button
        type="button"
        onClick={nextQuote}
        title="Change quote"
        aria-label="Another quote"
        className="flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted hover:border-accent hover:text-accent transition-colors"
      >
        <span>↻</span>
        <span className="text-[10px]">Kutipan</span>
      </button>
    </div>
  );
}
