import type { Place } from "../api";

const PLACE_ICONS: Record<string, string> = {
  home: "M3 11l9-7 9 7M5 10v10h14V10",
  doc: "M6 3h9l3 3v15H6zM9 11h6M9 15h6",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  image:
    "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM21 17l-5-5-9 8",
  video:
    "M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM10 9.5v5l4-2.5z",
  music:
    "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  app: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  drive: "M7 9v12h10V9M9 9V3h6v6",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
};

export function PlacesSidebar({
  places,
  devices,
  currentPath,
  onSelectPlace,
}: Readonly<{
  places: readonly Place[];
  devices: readonly Place[];
  currentPath: string;
  onSelectPlace: (path: string) => void;
}>) {
  return (
    <aside
      aria-label="Tempat"
      className="flex w-[200px] shrink-0 flex-col gap-0.5 overflow-y-auto"
    >
      <span className="px-2.5 pt-1 pb-1.5 text-[11px] uppercase tracking-[0.08em] text-muted">
        Tempat
      </span>
      {places.map((p) => {
        const active = currentPath === p.path;
        return (
          <button
            key={p.path}
            type="button"
            onClick={() => onSelectPlace(p.path)}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
              active
                ? "bg-surface-2 font-semibold text-ink"
                : "text-[#c9ced8] hover:bg-surface-2"
            }`}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke={active ? "#c6f36b" : "currentColor"}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={PLACE_ICONS[p.icon] ?? PLACE_ICONS.folder} />
            </svg>
            <span className="truncate">{p.name}</span>
          </button>
        );
      })}

      {devices.length > 0 && (
        <>
          <span className="px-2.5 pt-4 pb-1.5 text-[11px] uppercase tracking-[0.08em] text-muted">
            Perangkat
          </span>
          {devices.map((d) => {
            const active = currentPath === d.path;
            return (
              <button
                key={d.path}
                type="button"
                onClick={() => onSelectPlace(d.path)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                  active
                    ? "bg-surface-2 font-semibold text-ink"
                    : "text-[#c9ced8] hover:bg-surface-2"
                }`}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={active ? "#c6f36b" : "currentColor"}
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d={PLACE_ICONS.drive} />
                </svg>
                <span className="truncate">{d.name}</span>
              </button>
            );
          })}
        </>
      )}
    </aside>
  );
}
