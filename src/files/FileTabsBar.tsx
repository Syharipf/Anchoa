import type { FileTab } from "./useFileTabs";

/** Short label for a tab: the last folder name, or the remote name at its root. */
export function tabLabel(path: string): string {
  if (!path) return "Berkas";
  const remote = /^rclone:([^:]+):(.*)$/.exec(path);
  const rest = remote ? remote[2] : path;
  const trimmed = rest.replace(/\/+$/, "");
  const last = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  if (last) return last;
  return remote ? remote[1] : "/";
}

export function FileTabsBar({
  tabs,
  activeId,
  onActivate,
  onClose,
  onNewTab,
}: Readonly<{
  tabs: readonly FileTab[];
  activeId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab?: () => void;
}>) {
  if (tabs.length < 2 && !onNewTab) return null;
  return (
    <div role="tablist" aria-label="Tab berkas" className="flex min-w-0 gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const active = tab.id === activeId;
        const label = tabLabel(tab.path);
        return (
          <div
            key={tab.id}
            className={`flex shrink-0 items-center rounded-lg border text-xs transition-colors ${
              active ? "border-field-focus bg-surface-2 text-ink" : "border-line text-muted hover:bg-surface"
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              title={tab.path}
              onClick={() => onActivate(tab.id)}
              className="max-w-[180px] truncate py-1.5 pr-1 pl-2.5"
            >
              {label}
            </button>
            <button
              type="button"
              aria-label={`Tutup tab ${label}`}
              onClick={() => onClose(tab.id)}
              className="flex h-6 w-6 items-center justify-center rounded-md hover:text-ink"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        );
      })}
      {onNewTab && (
        <button
          type="button"
          onClick={onNewTab}
          aria-label="Tab baru"
          title="Tab baru (Ctrl+T)"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
    </div>
  );
}
