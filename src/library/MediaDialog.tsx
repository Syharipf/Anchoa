import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { MediaInput, MediaKind, MediaRow, MediaStatus } from "../api";
import { KIND_LABEL, UNITS } from "./view";

const KINDS: MediaKind[] = ["film", "series", "anime", "book", "manga"];
const STATUSES: MediaStatus[] = ["want", "active", "finished", "dropped"];

export function MediaDialog({
  initial,
  onClose,
  onSave,
  onDelete,
}: Readonly<{
  initial: MediaRow | null;
  onClose: () => void;
  onSave: (input: MediaInput) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}>) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [creator, setCreator] = useState(initial?.creator ?? "");
  const [year, setYear] = useState(initial?.year !== null && initial?.year !== undefined ? String(initial.year) : "");
  const [kind, setKind] = useState<MediaKind>(initial?.kind ?? "film");
  const [status, setStatus] = useState<MediaStatus>(initial?.status ?? "want");
  const [progress, setProgress] = useState(
    initial?.progress !== null && initial?.progress !== undefined ? String(initial.progress) : "",
  );
  const [progressTotal, setProgressTotal] = useState(
    initial?.progressTotal !== null && initial?.progressTotal !== undefined ? String(initial.progressTotal) : "",
  );
  const [rating, setRating] = useState<number>(initial?.rating ?? 0);
  const [tags, setTags] = useState(initial?.tags ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    boxRef.current
      ?.querySelector<HTMLElement>("input, select, textarea")
      ?.focus();
    return () => prev?.focus();
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Title is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const parsedYear = year.trim() ? Number.parseInt(year.trim(), 10) : null;
      const parsedProg = kind === "film" ? null : progress.trim() ? Number.parseInt(progress.trim(), 10) : null;
      const parsedTotal = kind === "film" ? null : progressTotal.trim() ? Number.parseInt(progressTotal.trim(), 10) : null;
      const payload: MediaInput = {
        id: initial?.id,
        title: cleanTitle,
        body,
        kind,
        status,
        progress: Number.isNaN(parsedProg) ? null : parsedProg,
        progressTotal: Number.isNaN(parsedTotal) ? null : parsedTotal,
        rating: rating > 0 ? rating : null,
        year: Number.isNaN(parsedYear) ? null : parsedYear,
        creator: creator.trim(),
        tags: tags.trim(),
      };
      await onSave(payload);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!initial?.id || !onDelete) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(initial.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const unit = UNITS[kind];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-16" onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-label="Close modal overlay"
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-[#05070a]/80"
      />
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lib-dialog-title"
        data-anim
        className="relative z-10 flex w-full max-w-[480px] flex-col gap-3.5 rounded-2xl border border-[#313B45] bg-[#171A21] p-5 text-ink shadow-[0_24px_60px_rgba(0,0,0,0.65)]"
      >
        <div className="flex items-center gap-2">
          <h2 id="lib-dialog-title" className="m-0 flex-1 font-display text-lg font-semibold">
            {initial ? "Edit media" : "Add media"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-lg leading-none text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          {error ? <div className="text-xs text-danger">{error}</div> : null}

          <label className="flex flex-col gap-1 text-xs text-muted">
            Title
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="h-[38px] rounded-[10px] border border-line bg-[#131820] px-3 text-[13px] text-ink outline-none transition-colors focus:border-field-focus"
            />
          </label>

          <div className="grid grid-cols-[1fr_96px] gap-2.5">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Creator
              <input
                value={creator}
                onChange={(e) => setCreator(e.target.value)}
                placeholder="Director, author, or creator"
                className="h-[38px] rounded-[10px] border border-line bg-[#131820] px-3 text-[13px] text-ink outline-none transition-colors focus:border-field-focus"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Year
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="2026"
                className="h-[38px] rounded-[10px] border border-line bg-[#131820] px-3 font-mono text-[13px] text-ink outline-none transition-colors focus:border-field-focus"
              />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">Kind</span>
            <div role="group" aria-label="Kind" className="flex gap-1 rounded-[10px] border border-line bg-[#0F1115] p-1">
              {KINDS.map((k) => {
                const active = kind === k;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setKind(k)}
                    className={`flex-1 rounded-[7px] py-1 text-xs transition-colors ${
                      active ? "bg-[#1D2129] font-medium text-ink" : "text-muted hover:text-ink"
                    }`}
                  >
                    {KIND_LABEL[k]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">Status</span>
            <div role="group" aria-label="Status" className="flex gap-1 rounded-[10px] border border-line bg-[#0F1115] p-1">
              {STATUSES.map((s) => {
                const active = status === s;
                const label = s === "want" ? "Want" : s === "active" ? (kind === "book" || kind === "manga" ? "Reading" : "Watching") : s === "finished" ? "Finished" : "Dropped";
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setStatus(s)}
                    className={`flex-1 rounded-[7px] py-1 text-xs transition-colors ${
                      active ? "bg-[#1D2129] font-medium text-ink" : "text-muted hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {kind !== "film" ? (
            <div className="flex items-center gap-2.5">
              <span className="w-16 text-xs text-muted">Progress</span>
              <input
                type="number"
                aria-label="Progress"
                value={progress}
                onChange={(e) => setProgress(e.target.value)}
                placeholder="0"
                className="h-9 w-20 rounded-[10px] border border-line bg-[#131820] px-2.5 font-mono text-[13px] text-ink outline-none transition-colors focus:border-field-focus"
              />
              <span className="text-[#556C73]">/</span>
              <input
                type="number"
                aria-label="Progress total"
                value={progressTotal}
                onChange={(e) => setProgressTotal(e.target.value)}
                placeholder="Total"
                className="h-9 w-20 rounded-[10px] border border-line bg-[#131820] px-2.5 font-mono text-[13px] text-ink outline-none transition-colors focus:border-field-focus"
              />
              <span className="text-xs text-muted">{unit}</span>
              <span className="flex-1" />
              <div role="group" aria-label="Rating" className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    aria-label={`${star} of 5`}
                    aria-pressed={rating >= star}
                    onClick={() => setRating((prev) => (prev === star ? 0 : star))}
                    className={`p-0.5 text-lg leading-none transition-transform hover:scale-110 ${
                      rating >= star ? "text-accent" : "text-[#3A4150]"
                    }`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <span className="w-16 text-xs text-muted">Rating</span>
              <div role="group" aria-label="Rating" className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    aria-label={`${star} of 5`}
                    aria-pressed={rating >= star}
                    onClick={() => setRating((prev) => (prev === star ? 0 : star))}
                    className={`p-0.5 text-lg leading-none transition-transform hover:scale-110 ${
                      rating >= star ? "text-accent" : "text-[#3A4150]"
                    }`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="flex flex-col gap-1 text-xs text-muted">
            Tags (comma-separated)
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="sci-fi, drama, work"
              className="h-[38px] rounded-[10px] border border-line bg-[#131820] px-3 text-[13px] text-ink outline-none transition-colors focus:border-field-focus"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-muted">
            Your review
            <textarea
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Personal notes or impressions…"
              className="resize-none rounded-[10px] border border-line bg-[#131820] p-3 text-[13px] leading-relaxed text-ink outline-none transition-colors focus:border-field-focus"
            />
          </label>

          <div className="flex items-center gap-2 pt-2">
            {initial?.id && onDelete ? (
              <button
                type="button"
                disabled={busy}
                onClick={handleDelete}
                className="h-[34px] rounded-[9px] px-3 text-[13px] text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
              >
                Delete
              </button>
            ) : null}
            <span className="flex-1" />
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="h-[34px] rounded-[9px] border border-[#3A4150] px-3.5 text-[13px] text-[#C9CED8] transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="h-[34px] rounded-[9px] bg-accent px-4 text-[13px] font-semibold text-canvas transition-transform hover:scale-105 active:scale-95 disabled:bg-disabled disabled:text-muted"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
