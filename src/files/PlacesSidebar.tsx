import type { FolderMeta, Place } from "../api";
import { RemoteBadge } from "./RemoteBadge";

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

interface SectionData {
  readonly title: string;
  readonly items: readonly Place[];
  readonly remote?: boolean;
  /** Muted note under the section, e.g. how to install rclone. */
  readonly note?: string | null;
  readonly tooltip?: string;
}

function PlaceIcon({
  place,
  remote,
  active,
  meta,
}: Readonly<{ place: Place; remote: boolean; active: boolean; meta: FolderMeta | undefined }>) {
  if (meta?.emoji) {
    return (
      <span aria-hidden="true" className="w-4 text-center text-sm leading-none">
        {meta.emoji}
      </span>
    );
  }
  if (remote) {
    return <RemoteBadge className={active ? "text-accent" : undefined} />;
  }
  let stroke = "currentColor";
  if (meta?.color) stroke = meta.color;
  else if (active) stroke = "#c6f36b";
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PLACE_ICONS[place.icon] ?? PLACE_ICONS.folder} />
    </svg>
  );
}

function PlacesSection({
  section,
  markers,
  currentPath,
  onSelectPlace,
}: Readonly<{
  section: SectionData;
  markers: ReadonlyMap<string, FolderMeta>;
  currentPath: string;
  onSelectPlace: (path: string) => void;
}>) {
  if (section.items.length === 0 && !section.note) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span
        title={section.tooltip}
        className="px-2.5 pt-1 pb-1.5 text-[11px] uppercase tracking-[0.08em] text-muted"
      >
        {section.title}
      </span>
      {section.items.map((p) => {
        const active = currentPath === p.path;
        return (
          <button
            key={p.path}
            type="button"
            title={p.path}
            onClick={() => onSelectPlace(p.path)}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
              active
                ? "bg-surface-2 font-semibold text-ink"
                : "text-[#c9ced8] hover:bg-surface-2"
            }`}
          >
            <PlaceIcon
              place={p}
              remote={section.remote ?? false}
              active={active}
              meta={markers.get(p.path)}
            />
            <span className="truncate">{p.name}</span>
          </button>
        );
      })}
      {section.note && (
        <p className="m-0 px-2.5 pb-1 text-[11px] leading-snug text-muted">{section.note}</p>
      )}
    </div>
  );
}

function bookmarkPlace(meta: FolderMeta): Place {
  const trimmed = meta.path.replace(/\/+$/, "");
  const name = trimmed.slice(trimmed.lastIndexOf("/") + 1) || meta.path;
  return { name, path: meta.path, icon: "folder" };
}

export function PlacesSidebar({
  places,
  devices,
  bookmarks,
  remotes,
  remoteHint,
  remoteVersion,
  markers,
  currentPath,
  onSelectPlace,
}: Readonly<{
  places: readonly Place[];
  devices: readonly Place[];
  /** Pinned folders, most recent first. */
  bookmarks: readonly FolderMeta[];
  /** rclone remotes and browsable network mounts. */
  remotes: readonly Place[];
  remoteHint: string | null;
  remoteVersion: string | null;
  markers: ReadonlyMap<string, FolderMeta>;
  currentPath: string;
  onSelectPlace: (path: string) => void;
}>) {
  const sections: readonly SectionData[] = [
    { title: "Tempat", items: places },
    { title: "Markah", items: bookmarks.map(bookmarkPlace) },
    { title: "Perangkat", items: devices },
    {
      title: "Remote",
      items: remotes,
      remote: true,
      note: remoteHint,
      tooltip: remoteVersion ?? undefined,
    },
  ];

  return (
    <aside
      aria-label="Tempat"
      className="flex w-[200px] shrink-0 flex-col gap-3 overflow-y-auto"
    >
      {sections.map((sec) => (
        <PlacesSection
          key={sec.title}
          section={sec}
          markers={markers}
          currentPath={currentPath}
          onSelectPlace={onSelectPlace}
        />
      ))}
    </aside>
  );
}
