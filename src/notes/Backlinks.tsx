import type { JSX } from "react";
import type { Backlink } from "../api";

function formatItemType(type: string): string {
  switch (type) {
    case "page":
      return "Catatan halaman";
    case "note":
      return "Jurnal";
    case "task":
      return "Tugas";
    case "project":
      return "Proyek";
    case "habit":
      return "Kebiasaan";
    case "account":
      return "Akun";
    case "transaction":
      return "Transaksi";
    case "bill":
      return "Tagihan";
    case "download":
      return "Unduhan";
    default:
      return "Item";
  }
}

export function Backlinks({
  items,
  onOpenItem,
}: Readonly<{
  items: readonly Backlink[];
  onOpenItem: (id: string) => void;
}>): JSX.Element {
  return (
    <aside
      aria-label="Panel tautan balik"
      className="flex min-h-0 flex-col rounded-[14px] border border-line bg-surface p-4"
    >
      <h2 className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        Disebut di
      </h2>

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          Belum ada yang menautkan halaman ini.
        </p>
      ) : (
        <ul className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpenItem(item.id)}
                className="flex w-full flex-col gap-1 rounded-lg border border-line bg-surface-2/40 p-2.5 text-left transition-colors hover:bg-surface-2 hover:border-muted/30"
              >
                <span className="truncate text-xs font-medium text-ink">
                  {item.title}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted">
                  {formatItemType(item.type)}
                </span>
                {item.excerpt && (
                  <span className="line-clamp-2 text-[11px] leading-tight text-muted">
                    {item.excerpt}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
