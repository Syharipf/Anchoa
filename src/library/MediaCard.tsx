import type { MediaRow } from "../api";
import { KIND_LABEL, hasProgress, progressPercent, progressText, statusLabel } from "./view";

export function MediaCard({
  media,
  onOpen,
}: Readonly<{
  media: MediaRow;
  onOpen: (media: MediaRow) => void;
}>) {
  const showProgress = hasProgress(media);
  const pct = progressPercent(media);
  const progText = progressText(media);
  const rating = media.rating ?? 0;
  const starsFull = "★".repeat(rating);
  const starsEmpty = "☆".repeat(Math.max(0, 5 - rating));

  const statusChipClasses: Record<MediaRow["status"], string> = {
    want: "text-muted bg-[#1D2129]/70 border-[#262B35]",
    active: "text-accent bg-accent/10 border-field-focus",
    finished: "text-[#86B33A] bg-[#86B33A]/10 border-[#3C5A22]",
    dropped: "text-danger bg-danger/10 border-[#5C322C]",
  };

  const barColor =
    media.status === "finished"
      ? "bg-[#4E6A26]"
      : media.status === "dropped"
        ? "bg-[#3A4150]"
        : "bg-[#86B33A]";

  const metaParts: string[] = [];
  if (media.creator) metaParts.push(media.creator);
  if (media.year !== null && media.year !== undefined) metaParts.push(String(media.year));
  const metaText = metaParts.join(" · ");

  return (
    <button
      type="button"
      onClick={() => onOpen(media)}
      className="flex flex-col gap-1.5 overflow-hidden rounded-[14px] border border-line bg-surface p-3.5 text-left text-ink transition-[background-color,border-color] hover:border-[#31474E] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
    >
      <div className="flex shrink-0 items-center gap-2">
        <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase text-muted">
          {KIND_LABEL[media.kind]}
        </span>
        <span className="flex-1" />
        <span
          aria-label={media.rating ? `${media.rating} of 5` : "Not rated"}
          className="whitespace-nowrap text-[11px] tracking-wider"
        >
          <span className="text-accent">{starsFull}</span>
          <span className="text-[#3A4150]">{starsEmpty}</span>
        </span>
      </div>

      <span className="shrink-0 line-clamp-2 font-display text-[15px] font-semibold leading-snug">
        {media.title}
      </span>

      {metaText ? (
        <span className="shrink-0 truncate text-xs text-muted">
          {metaText}
        </span>
      ) : null}

      {showProgress ? (
        <div className="flex shrink-0 flex-col gap-1 py-0.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-mono text-[10.5px] text-muted">
            {progText}
          </span>
        </div>
      ) : null}

      {media.body ? (
        <span className="shrink-0 line-clamp-1 text-[11.5px] italic text-muted">
          {media.body}
        </span>
      ) : null}

      <div className="mt-auto flex shrink-0 items-center gap-2 pt-1">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${
            statusChipClasses[media.status]
          }`}
        >
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-current"
          />
          {statusLabel(media.kind, media.status)}
        </span>
        {media.tags ? (
          <span className="ml-auto truncate text-[11px] text-[#556C73]">
            {media.tags}
          </span>
        ) : null}
      </div>
    </button>
  );
}
