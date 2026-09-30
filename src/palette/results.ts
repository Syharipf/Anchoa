import type { ItemSummary } from "../api";
import { PAGES, type PageId } from "../shell/nav";

export type PaletteOption =
  | { kind: "page"; id: string; label: string; sub: string; page: PageId }
  | { kind: "item"; id: string; label: string; sub: string; itemId: string }
  | { kind: "capture"; id: string; label: string; sub: string; text: string };

export interface PaletteGroup {
  title: string;
  options: PaletteOption[];
}

export const RECENT_IN_PALETTE = 5;

/**
 * Groups shown in the command palette (spec UI lanjutan U4). A non-empty query
 * filters by case-insensitive substring and always ends with "Simpan ke Inbox",
 * so text that matches nothing is saved by Enter, as quick capture always was.
 */
export function paletteResults(query: string, recent: ItemSummary[]): PaletteGroup[] {
  const text = query.trim();
  const needle = text.toLowerCase();
  const matches = (o: PaletteOption) => `${o.label} ${o.sub}`.toLowerCase().includes(needle);

  const pages: PaletteOption[] = PAGES.map((p) => ({
    kind: "page",
    id: `page-${p.id}`,
    label: p.label,
    sub: p.fase ? `Fase ${p.fase}` : "",
    page: p.id,
  }));
  const items: PaletteOption[] = recent.slice(0, RECENT_IN_PALETTE).map((i) => ({
    kind: "item",
    id: `item-${i.id}`,
    label: i.title || "Tanpa judul",
    sub: "Catatan",
    itemId: i.id,
  }));

  const groups: PaletteGroup[] = [
    { title: "Buka halaman", options: pages.filter(matches) },
    { title: "Terbaru", options: items.filter(matches) },
  ];
  if (text) {
    groups.push({
      title: "Inbox",
      options: [{ kind: "capture", id: "capture", label: `Simpan ke Inbox: “${text}”`, sub: "Enter", text }],
    });
  }
  return groups.filter((g) => g.options.length > 0);
}
