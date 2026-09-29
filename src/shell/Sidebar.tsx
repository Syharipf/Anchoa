export type TopPage = "dashboard" | "inbox";

export function Sidebar({ current, onSelect }: Readonly<{ current: string; onSelect: (page: TopPage) => void }>) {
  const link = (page: TopPage, label: string) => (
    <button
      onClick={() => onSelect(page)}
      aria-current={current === page ? "page" : undefined}
      className={`w-full rounded-md px-3 py-2 text-left text-sm ${
        current === page
          ? "bg-violet-600 text-white"
          : "text-neutral-600 hover:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {label}
    </button>
  );

  return (
    <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-neutral-200 bg-neutral-100 p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-4 px-3 text-lg font-bold">Anchoa</div>
      {link("dashboard", "Dashboard")}
      {link("inbox", "Inbox")}
    </nav>
  );
}
