import type { ItemSummary } from "../api";
import { relativeTime } from "../format";
import { Card } from "../shell/Card";
import { ItemRow } from "../shell/ItemRow";

export function RecentWidget({ items, onOpen }: Readonly<{ items?: ItemSummary[]; onOpen: (id: string) => void }>) {
  const now = Date.now();
  return (
    <Card title="Item terbaru">
      {items?.length === 0 && <p className="text-sm text-muted">Belum ada item</p>}
      {items?.map((i) => (
        <ItemRow key={i.id} item={i} detail={relativeTime(i.lastActivityAt, now)} onOpen={onOpen} />
      ))}
    </Card>
  );
}
