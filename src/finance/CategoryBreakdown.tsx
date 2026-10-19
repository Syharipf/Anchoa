import { useEffect, useState } from "react";
import { api, type TransactionView } from "../api";
import { formatRupiah } from "../money";
import { H2, PANEL } from "../shell/ui";

const CATEGORY_COLORS = [
  "#C6F36B",
  "#38bdf8",
  "#f472b6",
  "#fbbf24",
  "#a78bfa",
  "#fb923c",
  "#34d399",
  "#94a3b8",
];

export function CategoryBreakdown({
  month,
  version,
}: Readonly<{ month: string; version: number }>) {
  const [items, setItems] = useState<TransactionView[]>([]);

  useEffect(() => {
    let active = true;
    api.listTransactions(month, "out", 0).then(
      (res) => {
        if (active) setItems(res.items);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [month, version]);

  // Aggregate expenses for the current selected month
  const categoryTotals = new Map<string, number>();
  let totalExpense = 0;

  for (const t of items) {
    if (t.amount < 0 && !t.transferId) {
      const cat = t.category?.trim() || "Lain-lain";
      const positiveAmount = Math.abs(t.amount);
      totalExpense += positiveAmount;
      categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + positiveAmount);
    }
  }

  const sortedCategories = [...categoryTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount], index) => {
      const percentage = totalExpense > 0 ? Math.round((amount / totalExpense) * 100) : 0;
      return {
        name,
        amount,
        percentage,
        color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
      };
    });

  if (sortedCategories.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="kategori-judul" className={`${PANEL} flex flex-col gap-3`}>
      <div className="flex items-center justify-between">
        <h2 id="kategori-judul" className={H2}>
          Pengeluaran per Kategori
        </h2>
        <span className="font-mono text-xs text-muted">
          Total: {formatRupiah(totalExpense)}
        </span>
      </div>

      {/* Stacked Progress Bar */}
      <div
        role="progressbar"
        aria-label="Distribusi kategori pengeluaran"
        aria-valuenow={100}
        aria-valuemin={0}
        aria-valuemax={100}
        className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2"
      >
        {sortedCategories.map((c) => (
          <div
            key={c.name}
            style={{
              width: `${c.percentage}%`,
              backgroundColor: c.color,
            }}
            title={`${c.name}: ${c.percentage}% (${formatRupiah(c.amount)})`}
            className="h-full transition-all duration-300"
          />
        ))}
      </div>

      {/* Category List */}
      <div className="flex flex-col gap-2 pt-1">
        {sortedCategories.slice(0, 5).map((c) => (
          <div key={c.name} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 truncate">
              <span
                style={{ backgroundColor: c.color }}
                className="h-2 w-2 shrink-0 rounded-full"
                aria-hidden="true"
              />
              <span className="truncate text-ink">{c.name}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2 font-mono">
              <span className="text-muted">{c.percentage}%</span>
              <span className="text-ink font-medium">{formatRupiah(c.amount)}</span>
            </div>
          </div>
        ))}
        {sortedCategories.length > 5 && (
          <span className="text-right text-[11px] text-muted">
            +{sortedCategories.length - 5} kategori lainnya
          </span>
        )}
      </div>
    </section>
  );
}
