import type { ItemSummary } from "../api";

export function ItemRow({ item, detail, onOpen }: Readonly<{ item: ItemSummary; detail: string; onOpen: (id: string) => void }>) {
  return (
    <button
      onClick={() => onOpen(item.id)}
      className="flex w-full justify-between gap-4 rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-200 dark:hover:bg-neutral-800"
    >
      <span className="truncate">{item.title || "Tanpa judul"}</span>
      <span className="shrink-0 text-neutral-500">{detail}</span>
    </button>
  );
}
