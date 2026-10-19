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
    text: "Kita adalah apa yang kita lakukan berulang-ulang. Keunggulan bukanlah sebuah tindakan, melainkan sebuah kebiasaan.",
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
    text: "Jangan hitung hari-harinya, tapi buatlah setiap hari itu bermakna.",
    author: "Muhammad Ali",
  },
  {
    text: "Kemenangan terbesar adalah kemenangan atas dirimu sendiri setiap hari.",
    author: "Plato",
  },
  {
    text: "Kemajuan 1% setiap hari akan membuatmu 37 kali lebih baik dalam setahun.",
    author: "James Clear",
    source: "Atomic Habits",
  },
  {
    text: "Bukan beban yang menghancurkanmu, tapi caramu memikulnya secara konsisten.",
    author: "Lou Holtz",
  },
  {
    text: "Kebiasaan yang baik membuat waktu menjadi sekutumu, kebiasaan buruk membuat waktu menjadi musuhmu.",
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
    <div className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-line bg-gradient-to-r from-surface via-surface-2 to-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/20 font-serif text-xs font-bold text-accent">
            “
          </span>
          <span className="font-display text-[11px] font-semibold uppercase tracking-wider text-accent">
            Kutipan Inspirasi Harian
          </span>
        </div>
        <button
          type="button"
          onClick={nextQuote}
          title="Ganti kutipan"
          aria-label="Kutipan lain"
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          ↻
        </button>
      </div>

      <p className="my-2.5 text-xs italic leading-relaxed text-ink">
        &ldquo;{quote.text}&rdquo;
      </p>

      <div className="flex items-center justify-between text-[11px] text-muted">
        <span className="font-medium text-[#C3D2D6]">— {quote.author}</span>
        {quote.source && <span className="font-mono text-[10px] text-muted/80">{quote.source}</span>}
      </div>
    </div>
  );
}
