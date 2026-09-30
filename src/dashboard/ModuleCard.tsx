import type { NavPage, PageId } from "../shell/nav";
import { H2, PANEL } from "../shell/ui";

/** Bento card for a module that a later fase builds; opens its placeholder page. */
export function ModuleCard({ page, onSelect }: Readonly<{ page: NavPage; onSelect: (id: PageId) => void }>) {
  return (
    <button onClick={() => onSelect(page.id)} className={`${PANEL} flex flex-col items-start gap-1.5 text-left transition-colors hover:bg-surface-2`}>
      <h2 className={H2}>{page.label}</h2>
      <span className="text-xs text-accent">Hadir di Fase {page.fase}</span>
      <span className="line-clamp-2 text-xs leading-relaxed text-muted">{page.about}</span>
    </button>
  );
}
