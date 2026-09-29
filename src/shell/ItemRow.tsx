import type { ItemSummary } from "../api";
import { ROW } from "./ui";

export function ItemRow({ item, detail, onOpen }: Readonly<{ item: ItemSummary; detail: string; onOpen: (id: string) => void }>) {
  return (
    <button
      onClick={() => onOpen(item.id)}
      className={`${ROW} flex w-full items-center justify-between gap-4 px-2.5 py-2 text-left text-sm text-ink`}
    >
      <span className="truncate">{item.title || "Tanpa judul"}</span>
      <span className="shrink-0 font-mono text-xs text-muted">{detail}</span>
    </button>
  );
}
