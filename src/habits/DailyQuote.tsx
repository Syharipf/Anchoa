import { useState } from "react";

export interface Quote {
  text: string;
  author: string;
  source?: string;
}

export const HABIT_QUOTES: Quote[] = [
  {
    text: "Kamu tidak naik ke tingkat sasaranmu. Kamu jatuh ke tingkat sistem yang kamu miliki.",
    author: "James Clear",
    source: "Atomic Habits",
  },
  {
    text: "Disiplin hari ini adalah kebebasan di masa depan.",
    author: "Seneca",
    source: "Letters from a Stoic",
  },
  {
    text: "Kita adalah apa yang kita lakukan berulang-ulang. Keunggulan adalah sebuah kebiasaan.",
    author: "Will Durant",
  },
  {
    text: "Fokus pada konsistensi kecil daripada intensitas sesaat yang cepat memudar.",
    author: "Marcus Aurelius",
    source: "Meditations",
  },
  {
    text: "Perjalanan seribu mil dimulai dengan satu langkah kecil yang disiplin.",
    author: "Lao Tzu",
  },
  {
    text: "Kemajuan 1% setiap hari akan membuatmu 37 kali lebih baik dalam setahun.",
    author: "James Clear",
    source: "Atomic Habits",
  },
  {
    text: "Kebiasaan baik membuat waktu menjadi sekutumu, kebiasaan buruk membuat waktu menjadi musuhmu.",
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
        title="Ganti kutipan"
        aria-label="Kutipan lain"
        className="flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-muted hover:border-accent hover:text-accent transition-colors"
      >
        <span>↻</span>
        <span className="text-[10px]">Kutipan</span>
      </button>
    </div>
  );
}
