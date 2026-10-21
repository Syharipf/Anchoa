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

/** "Quick actions". `sub` stays empty so that typing a page name (e.g. "fin") never picks an action first. */
const ACTIONS: PaletteOption[] = [
  { kind: "action", id: "action-new-transaction", label: "Record transaction", sub: "", action: "new-transaction" },
];

export function itemKindLabel(type: string): string {
  switch (type) {
    case "page":
      return "Notes";
    case "note":
      return "Journal";
    case "task":
      return "Tasks";
    case "habit":
      return "Habits";
    case "project":
      return "Projects";
    default:
      return "Item";
  }
}

export function searchItemOption(hit: SearchHit): PaletteOption {
  return {
    kind: "item",
    id: `item-${hit.id}`,
    label: hit.title || "Untitled",
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
    sub: "",
    page: p.id,
  }));
  const items: PaletteOption[] = recent.slice(0, RECENT_IN_PALETTE).map((i) => ({
    kind: "item",
    id: `item-${i.id}`,
    label: i.title || "Untitled",
    sub: "Notes",
    itemId: i.id,
  }));

  const itemOptions = searchHits.map(searchItemOption);

  const groups: PaletteGroup[] = [
    { title: "Quick actions", options: ACTIONS.filter(matches) },
    { title: "Open page", options: pages.filter(matches) },
  ];

  if (itemOptions.length > 0) {
    groups.push({ title: "Item", options: itemOptions });
  } else if (!text || items.some(matches)) {
    groups.push({ title: "Recent", options: items.filter(matches) });
  }

  if (text) {
    groups.push({
      title: "Save",
      options: [
        { kind: "capture", id: "capture", label: `Save to Journal: “${text}”`, sub: "Enter", text },
        { kind: "task", id: "task", label: `Create task: “${text}”`, sub: "", text },
      ],
    });
  }
  return groups.filter((g) => g.options.length > 0);
}
