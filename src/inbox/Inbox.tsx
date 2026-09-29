import { useEffect, useState } from "react";
import { api, errorMessage, type ItemSummary } from "../api";
import { relativeTime, shortDate } from "../format";
import { ItemRow } from "../shell/ItemRow";
import { useToast } from "../shell/toast";

export function Inbox({ onOpen }: { onOpen: (id: string) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<ItemSummary[] | null>(null);

  useEffect(() => {
    api.listInbox().then(setItems, (e) => toast(errorMessage(e), "error"));
  }, [toast]);

  const now = Date.now();
  const detail = (i: ItemSummary) =>
    [i.dueAt !== null ? `jatuh tempo ${shortDate(i.dueAt)}` : null, relativeTime(i.lastActivityAt, now)]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-bold">Inbox</h1>
      {items?.length === 0 && <p className="text-sm text-neutral-500">Inbox kosong</p>}
      {items?.map((i) => <ItemRow key={i.id} item={i} detail={detail(i)} onOpen={onOpen} />)}
    </div>
  );
}
