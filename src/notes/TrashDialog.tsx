import { useState, type JSX } from "react";
import type { TrashEntry } from "../api";
import { relativeTime } from "../format";
import { Dialog } from "../shell/Dialog";
import { SECONDARY } from "../shell/ui";

export function TrashDialog({
  entries,
  onClose,
  onRestore,
}: Readonly<{
  entries: readonly TrashEntry[];
  onClose: () => void;
  onRestore: (id: string) => Promise<void>;
}>): JSX.Element {
  const [restoringId, setRestoringId] = useState<string | null>(null);

  async function handleRestore(id: string) {
    setRestoringId(id);
    try {
      await onRestore(id);
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <Dialog title="Sampah" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {entries.length === 0 ? (
          <p className="m-0 text-sm text-muted">Sampah kosong.</p>
        ) : (
          <ul className="flex max-h-[360px] flex-col gap-2 overflow-y-auto pr-1">
            {entries.map((entry) => {
              const isRestoring = restoringId === entry.id;
              return (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/40 p-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-ink">
                      {entry.title}
                    </span>
                    <span className="text-xs text-muted">
                      Dihapus {relativeTime(entry.deletedAt, Date.now())}
                      {entry.descendants > 0 ? ` · ${entry.descendants} subhalaman` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={isRestoring}
                    onClick={() => void handleRestore(entry.id)}
                    className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-accent transition-colors hover:bg-surface-2 disabled:text-muted"
                  >
                    {isRestoring ? "Memulihkan…" : "Pulihkan"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-2 flex items-center justify-end">
          <button type="button" onClick={onClose} className={SECONDARY}>
            Tutup
          </button>
        </div>
      </div>
    </Dialog>
  );
}
