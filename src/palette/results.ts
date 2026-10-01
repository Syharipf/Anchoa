import type { ItemSummary, SearchHit } from "../api";
import { PAGES, type PageId } from "../shell/nav";

export type PaletteOption =
  | { kind: "action"; id: string; label: string; sub: string; action: "new-transaction" }
  | { kind: "page"; id: string; label: string; sub: string; page: PageId }
  | { kind: "item"; id: string; label: string; sub: string; itemId: string; snippet?: string }
  | { kind: "capture"; id: string; label: string; sub: string; text: string }
  | { kind: "task"; id: string; label: string; sub: string; text: string };

export interface PaletteGroup {
  title: string;
  options: PaletteOption[];
}

const RECENT_IN_PALETTE = 5;

/** "Aksi cepat". `sub` stays empty so that typing a page name (e.g. "keu") never picks an action first. */
const ACTIONS: PaletteOption[] = [
  { kind: "action", id: "action-new-transaction", label: "Catat transaksi", sub: "", action: "new-transaction" },
];

export function itemKindLabel(type: string): string {
  switch (type) {
    case "page":
      return "Catatan";
    case "note":
      return "Jurnal";
    case "task":
      return "Tugas";
    case "habit":
      return "Habit";
    case "project":
      return "Proyek";
    default:
      return "Item";
  }
}

export function searchItemOption(hit: SearchHit): PaletteOption {
  return {
    kind: "item",
    id: `item-${hit.id}`,
    label: hit.title || "Tanpa judul",
    sub: itemKindLabel(hit.type),
    itemId: hit.id,
    snippet: hit.snippet,
  };
}

/**
 * Computes the next active index when navigating options with arrow keys.
 * Clamps within [0, total - 1].
 */
export function nextActiveIndex(current: number, total: number, delta: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(current + delta, total - 1));
}

/**
 * Groups shown in the command palette (spec UI lanjutan U4, Fase 4B spec §5).
 * A non-empty query filters by case-insensitive substring, includes search hits
 * in the "Item" group after command groups, and always ends with the "Simpan" group
 * offering Jurnal capture and task creation.
 */
export function paletteResults(
  query: string,
  recent: ItemSummary[],
  searchHits: readonly SearchHit[] = [],
): PaletteGroup[] {
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

  const itemOptions = searchHits.map(searchItemOption);

  const groups: PaletteGroup[] = [
    { title: "Aksi cepat", options: ACTIONS.filter(matches) },
    { title: "Buka halaman", options: pages.filter(matches) },
  ];

  if (itemOptions.length > 0) {
    groups.push({ title: "Item", options: itemOptions });
  } else if (!text || items.some(matches)) {
    groups.push({ title: "Terbaru", options: items.filter(matches) });
  }

  if (text) {
    groups.push({
      title: "Simpan",
      options: [
        { kind: "capture", id: "capture", label: `Simpan ke Jurnal: “${text}”`, sub: "Enter", text },
        { kind: "task", id: "task", label: `Buat tugas: “${text}”`, sub: "", text },
      ],
    });
  }
  return groups.filter((g) => g.options.length > 0);
}
