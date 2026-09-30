import { useEffect, useState } from "react";
import { api, errorMessage, type ItemSummary } from "../api";
import { relativeTime, shortDate } from "../format";
import { ItemRow } from "../shell/ItemRow";
import { useToast } from "../shell/toast";
import { H1, PANEL } from "../shell/ui";

export function Inbox({ onOpen }: Readonly<{ onOpen: (id: string) => void }>) {
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
    <div className="flex max-w-3xl flex-col gap-[18px]">
      <h1 className={H1}>Inbox</h1>
      <section className={`${PANEL} flex flex-col gap-1`}>
        {items?.length === 0 && <p className="m-0 text-sm text-muted">Inbox kosong</p>}
        {items?.map((i) => <ItemRow key={i.id} item={i} detail={detail(i)} onOpen={onOpen} />)}
      </section>
    </div>
  );
}
