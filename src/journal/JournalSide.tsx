import { useState } from "react";
import {
  api,
  errorMessage,
  type Entry,
  type EntrySummary,
  type Side,
  type TrendDay,
} from "../api";
import { useToast } from "../shell/toast";
import { JournalCalendar } from "./JournalCalendar";
import { PROMPTS, nextPrompt } from "./view";
const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

function formatTrendStartDate(dateStr?: string): string {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length < 3) return dateStr;
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const monthName = SHORT_MONTHS[monthIdx] ?? "";
  return `${day} ${monthName}`;
}

function barProps(t: TrendDay, isToday: boolean): { h: number; c: string } {
  if (!t.wrote) {
    return { h: 3, c: "#3A4150" };
  }
  if (t.mood === null) {
    return { h: 6, c: "#5B6475" };
  }
  const height = 6 + t.mood * 9;
  const color = isToday ? "#C6F36B" : "#86B33A";
  return { h: height, c: color };
}

function IdeaButton({
  idea,
  onClick,
}: Readonly<{
  idea: EntrySummary;
  onClick: (id: string) => void;
}>) {
  return (
    <button
      type="button"
      onClick={() => onClick(idea.id)}
      className="flex w-full items-center gap-2 rounded-lg p-1.5 text-left text-xs text-ink transition-colors hover:bg-surface-2"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{idea.title || "Tanpa judul"}</span>
      <span className="shrink-0 font-mono text-[11px] text-muted">{idea.time}</span>
    </button>
  );
}

export function JournalSide({
  side,
  onIdeaSelect,
  onSelectIdea,
  onSelectEntry,
  onSummaryCreated,
  onPromptSelect,
  onSelectPrompt,
  selectedDate,
  onSelectDate,
  refreshKey,
}: Readonly<{
  side: Side | null;
  onIdeaSelect?: (id: string) => void;
  onSelectIdea?: (id: string) => void;
  onSelectEntry?: (id: string) => void;
  onSummaryCreated?: (entry: Entry) => void;
  onPromptSelect?: (text: string) => void;
  onSelectPrompt?: (promptText: string) => void;
  selectedDate?: string;
  onSelectDate?: (date: string) => void;
  refreshKey?: number;
}>) {
  const [promptIdx, setPromptIdx] = useState(0);
  const [summarizing, setSummarizing] = useState(false);
  const toast = useToast();

  const handleIdea = onIdeaSelect ?? onSelectIdea ?? (() => {});
  const handlePrompt = onPromptSelect ?? onSelectPrompt ?? (() => {});

  const trend = side?.trend ?? [];
  const writeDays = side?.writeDays ?? 0;
  const ideas = side?.ideas ?? [];
  const memories = side?.memories ?? [];
  const promptText = PROMPTS[promptIdx];
  const startDateLabel = formatTrendStartDate(trend[0]?.date);

  async function handleWeeklySummary() {
    if (summarizing) return;
    setSummarizing(true);
    try {
      const summary = await api.journalWeeklySummary();
      onSummaryCreated?.(summary);
      toast("Ringkasan mingguan dibuat", "info");
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setSummarizing(false);
    }
  }

  return (
    <aside aria-label="Informasi jurnal" className="flex min-h-0 flex-col gap-3.5 overflow-y-auto">
      <JournalCalendar
        selectedDate={selectedDate}
        onSelectDate={onSelectDate ?? (() => {})}
        refreshKey={refreshKey ?? side}
      />
      {memories.length > 0 && (
        <section
          aria-labelledby="j-memories-heading"
          className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-3.5"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="j-memories-heading" className="m-0 font-display text-[15px] font-semibold text-ink">
              Hari ini di masa lalu
            </h2>
            <span className="text-[11px] text-muted">Kenangan</span>
          </div>
          <div className="flex flex-col gap-2">
            {memories.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelectEntry?.(m.id)}
                className="group flex flex-col gap-1 rounded-lg border border-line bg-surface-2 p-2.5 text-left transition-colors hover:border-line-hover"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-ink group-hover:text-accent">
                    {m.title || "Tanpa judul"}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted">
                    {m.time}
                  </span>
                </div>
                {m.preview ? (
                  <p className="m-0 line-clamp-2 text-xs leading-relaxed text-muted">
                    {m.preview}
                  </p>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      )}
      {/* 30-day Mood Trend */}
      <section
        aria-labelledby="j-trend-heading"
        className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-3.5"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="j-trend-heading" className="m-0 font-display text-[15px] font-semibold text-ink">
            Suasana 30 hari
          </h2>
          <span className="text-[11px] text-muted">{writeDays} hari menulis</span>
        </div>

        <div
          role="img"
          aria-label={`Suasana hati 30 hari terakhir: menulis ${writeDays} hari`}
          className="flex h-14 items-end gap-0.5 border-b border-line pb-0.5"
        >
          {trend.map((t, idx) => {
            const isToday = idx === trend.length - 1;
            const { h, c } = barProps(t, isToday);
            return (
              <span
                key={t.date}
                style={{ height: `${h}px`, backgroundColor: c }}
                className="flex-1 rounded-t-xs"
              />
            );
          })}
        </div>

        <div
          aria-hidden="true"
          className="flex justify-between font-mono text-[10px] text-muted"
        >
          <span>{startDateLabel}</span>
          <span>Hari ini</span>
        </div>

        <p className="m-0 text-xs text-muted">
          Tinggi batang = suasana hati (1 berat – 5 senang). Titik = tidak menulis.
        </p>
      </section>

      {/* Prompts */}
      <section
        aria-labelledby="j-prompt-heading"
        className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-3.5"
      >
        <h2 id="j-prompt-heading" className="m-0 font-display text-[15px] font-semibold text-ink">
          Pemantik
        </h2>
        <p className="m-0 text-sm leading-relaxed text-[#DADDE3]">“{promptText}”</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handlePrompt(promptText)}
            className="min-h-8 rounded-lg border border-[#4E6A26] bg-transparent px-3 text-xs text-accent transition-colors hover:bg-surface-2"
          >
            Tulis dari sini
          </button>
          <button
            type="button"
            onClick={() => setPromptIdx((prev) => nextPrompt(prev))}
            className="min-h-8 rounded-lg border border-line bg-transparent px-3 text-xs text-[#C9CED8] transition-colors hover:bg-surface-2"
          >
            Ganti
          </button>
        </div>
      </section>

      {/* Weekly summary */}
      <section
        aria-labelledby="j-summary-heading"
        className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-surface p-3.5"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="j-summary-heading" className="m-0 font-display text-[15px] font-semibold text-ink">
            Ringkasan mingguan
          </h2>
        </div>
        <p className="m-0 text-xs leading-relaxed text-muted">
          Asisten lokal merangkum tema dan suasana hati dari entri 7 hari terakhir.
        </p>
        <div>
          <button
            type="button"
            disabled={summarizing}
            onClick={handleWeeklySummary}
            className="flex items-center justify-center gap-2 rounded-lg border border-[#4E6A26] bg-[#151C12] px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {summarizing ? "Meringkas…" : "Ringkas minggu ini"}
          </button>
        </div>
      </section>

      {/* Ideas not yet converted to tasks */}
      <section
        aria-labelledby="j-ideas-heading"
        className="flex min-h-0 flex-1 flex-col gap-1.5 rounded-[14px] border border-line bg-surface p-3.5"
      >
        <h2 id="j-ideas-heading" className="m-0 mb-1 font-display text-[15px] font-semibold text-ink">
          Ide belum ditindaklanjuti
        </h2>

        {ideas.length === 0 ? (
          <p className="m-0 text-xs text-muted">Belum ada ide yang terbuka.</p>
        ) : (
          <div className="flex flex-col gap-1 overflow-y-auto">
            {ideas.map((idea) => (
              <IdeaButton key={idea.id} idea={idea} onClick={handleIdea} />
            ))}
          </div>
        )}

        <div className="mt-auto flex items-start gap-1.5 pt-2 pr-16 text-[11px] leading-relaxed text-muted">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="mt-0.5 shrink-0"
          >
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          <span>Asisten hanya membaca entri 7 hari terakhir saat kamu meminta ringkasan, atau entri yang kamu minta tanggapannya.</span>
        </div>
      </section>
    </aside>
  );
}
