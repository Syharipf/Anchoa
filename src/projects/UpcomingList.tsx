import type { TaskCard } from "../api";
import { shortDate } from "../format";

export function UpcomingList({
  tasks,
  onOpenItem,
}: Readonly<{
  tasks: TaskCard[];
  onOpenItem: (id: string) => void;
}>) {
  return (
    <section
      aria-labelledby="tenggat-judul"
      className="flex flex-col gap-1 rounded-[14px] border border-line bg-surface p-4"
    >
      <h2 id="tenggat-judul" className="m-0 mb-1 font-display text-[15px] font-semibold">
        Tenggat terdekat
      </h2>
      {tasks.length === 0 ? (
        <p className="m-0 py-2 text-xs text-muted">Tidak ada tenggat terdekat</p>
      ) : (
        tasks.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onOpenItem(t.id)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                t.overdue ? "bg-danger" : "bg-muted"
              }`}
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] text-ink">{t.title || "Tanpa judul"}</span>
              <span className="truncate text-[11px] text-muted">
                {t.projectName ?? "Tugas lepas"}
              </span>
            </span>
            {t.dueAt !== null && (
              <span
                className={`shrink-0 font-mono text-xs ${
                  t.overdue ? "text-danger" : "text-muted"
                }`}
              >
                {shortDate(t.dueAt)}
              </span>
            )}
          </button>
        ))
      )}
    </section>
  );
}
