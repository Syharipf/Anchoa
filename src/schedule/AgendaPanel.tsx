import type { ScheduleItem } from "../api";
import {
  addDays,
  agendaGroups,
  agendaTitle,
  isBillDone,
  KIND_COLORS,
} from "./layout";

function ItemCheckbox({
  item,
  onToggleTask,
  onPayBill,
}: {
  item: ScheduleItem;
  onToggleTask: (item: ScheduleItem) => void;
  onPayBill: (item: ScheduleItem) => void;
}) {
  if (!item.checkable) {
    return <div className="h-4 w-4 shrink-0" />;
  }
  const disabled = isBillDone(item);
  return (
    <input
      type="checkbox"
      checked={item.status === "done"}
      disabled={disabled}
      onChange={() => {
        if (item.source === "task") {
          onToggleTask(item);
        } else if (!disabled) {
          onPayBill(item);
        }
      }}
      aria-label={`Tandai selesai: ${item.title}`}
      className="h-4 w-4 shrink-0 cursor-pointer accent-accent disabled:cursor-not-allowed"
    />
  );
}

export function AgendaPanel({
  selectedDate,
  today,
  items,
  onToggleTask,
  onPayBill,
  onOpenItem,
  onOpenFinance,
}: Readonly<{
  selectedDate: string;
  today: string;
  items: readonly ScheduleItem[];
  onToggleTask: (item: ScheduleItem) => void;
  onPayBill: (item: ScheduleItem) => void;
  onOpenItem: (id: string) => void;
  onOpenFinance: () => void;
}>) {
  const { late, due, next } = agendaGroups(items, selectedDate, today);
  const isToday = selectedDate === today;

  const nextDays: { date: string; label: string; items: ScheduleItem[] }[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = addDays(selectedDate, i);
    const dayItems = next.filter((it) => it.dueDate === d);
    if (dayItems.length > 0) {
      const [y, m, day] = d.split("-").map(Number);
      const dt = new Date(y, m - 1, day);
      const label = dt.toLocaleDateString("id-ID", {
        weekday: "long",
        day: "numeric",
        month: "short",
      });
      nextDays.push({ date: d, label, items: dayItems });
    }
  }

  return (
    <aside
      aria-labelledby="agenda-judul"
      className="flex min-h-0 flex-col gap-3 rounded-[14px] border border-line bg-surface p-4 overflow-y-auto"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2
          id="agenda-judul"
          aria-live="polite"
          className="m-0 font-display text-[17px] font-semibold text-ink"
        >
          {agendaTitle(selectedDate)}
        </h2>
        {isToday && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-canvas">
            Hari ini
          </span>
        )}
      </div>

      {late.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-danger">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v6M12 16.5h.01" />
            </svg>
            Terlambat
          </div>
          {late.map((item) => {
            const [y, m, d] = item.dueDate.split("-").map(Number);
            const dt = new Date(y, m - 1, d);
            const when = `${d} ${dt.toLocaleDateString("id-ID", { month: "short" })}`;

            return (
              <div
                key={item.key}
                className="flex items-center gap-2.5 rounded-lg bg-danger-row p-2 text-ink"
              >
                <ItemCheckbox
                  item={item}
                  onToggleTask={onToggleTask}
                  onPayBill={onPayBill}
                />
                <span
                  className="h-7 w-[3px] shrink-0 rounded-[1px]"
                  style={{ backgroundColor: KIND_COLORS[item.kind] }}
                />
                <button
                  type="button"
                  onClick={() =>
                    item.source === "task"
                      ? onOpenItem(item.id)
                      : onOpenFinance()
                  }
                  className="flex min-w-0 flex-1 flex-col text-left cursor-pointer"
                >
                  <span
                    className={`truncate text-[13px] ${
                      item.status === "done"
                        ? "text-done line-through"
                        : "text-ink"
                    }`}
                  >
                    {item.title}
                  </span>
                  <span className="truncate text-[11px] text-muted">
                    {item.groupName}
                  </span>
                </button>
                <span className="shrink-0 font-mono text-[11px] text-danger">
                  {when}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted">
          {isToday ? "Tenggat hari ini" : "Tenggat hari itu"}
        </span>
        {due.length === 0 ? (
          <span className="py-2.5 text-[13px] text-muted">
            Tidak ada tenggat di tanggal ini.
          </span>
        ) : (
          due.map((item) => (
            <div
              key={item.key}
              className="flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-surface-2"
            >
              <ItemCheckbox
                item={item}
                onToggleTask={onToggleTask}
                onPayBill={onPayBill}
              />
              <span
                className="h-7 w-[3px] shrink-0 rounded-[1px]"
                style={{ backgroundColor: KIND_COLORS[item.kind] }}
              />
              <button
                type="button"
                onClick={() =>
                  item.source === "task"
                    ? onOpenItem(item.id)
                    : onOpenFinance()
                }
                className="flex min-w-0 flex-1 flex-col text-left cursor-pointer"
              >
                <span
                  className={`truncate text-[13px] ${
                    item.status === "done"
                      ? "text-done line-through"
                      : "text-ink"
                  }`}
                >
                  {item.title}
                </span>
                <span className="truncate text-[11px] text-muted">
                  {item.groupName}
                </span>
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted">
          7 hari berikutnya
        </span>
        {nextDays.length === 0 ? (
          <span className="py-2.5 text-[13px] text-muted">
            Kosong. Minggu yang tenang.
          </span>
        ) : (
          nextDays.map((g) => (
            <div key={g.date} className="flex flex-col gap-0.5">
              <span className="py-1 font-mono text-[11px] text-muted">
                {g.label}
              </span>
              {g.items.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center gap-2.5 rounded px-1 py-1 transition-colors hover:bg-surface-2"
                >
                  <ItemCheckbox
                    item={item}
                    onToggleTask={onToggleTask}
                    onPayBill={onPayBill}
                  />
                  <span
                    className="h-4 w-[3px] shrink-0 rounded-[1px]"
                    style={{ backgroundColor: KIND_COLORS[item.kind] }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      item.source === "task"
                        ? onOpenItem(item.id)
                        : onOpenFinance()
                    }
                    className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
                  >
                    <span
                      className={`truncate text-[13px] ${
                        item.status === "done"
                          ? "text-done line-through"
                          : "text-ink"
                      }`}
                    >
                      {item.title}
                    </span>
                  </button>
                  <span className="shrink-0 text-[11px] text-muted">
                    {item.groupName}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
