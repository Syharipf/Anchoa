// Every top-level page, in nav order (docs/design/DESIGN.md §1).

export type PageId =
  | "dashboard"
  | "jurnal"
  | "catatan"
  | "email"
  | "jadwal"
  | "habit"
  | "keuangan"
  | "proyek"
  | "berkas"
  | "unduhan"
  | "profil"
  | "settings";

export interface NavPage {
  id: PageId;
  label: string;
  /** Sits at the bottom of the nav rail. */
  bottom?: true;
}

export const PAGES: readonly NavPage[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "jurnal", label: "Journal" },
  { id: "catatan", label: "Notes" },
  {
    id: "email",
    label: "Email",
  },
  {
    id: "jadwal",
    label: "Schedule",
  },
  { id: "habit", label: "Habits" },
  { id: "keuangan", label: "Finance" },
  { id: "proyek", label: "Projects" },
  { id: "berkas", label: "Files" },
  { id: "unduhan", label: "Downloads" },
  {
    id: "profil",
    label: "Profile",
    bottom: true,
  },
  { id: "settings", label: "Settings", bottom: true },
];

const BY_ID = Object.fromEntries(PAGES.map((p) => [p.id, p])) as Record<PageId, NavPage>;

export function pageInfo(id: PageId): NavPage {
  return BY_ID[id];
}

/** One line for the mini assistant on each page. */
export function assistantHint(page: NavPage | null): string {
  return page
    ? `Need help with ${page.label}? Type a message or tap the microphone.`
    : "Type a message or tap the microphone to talk with the assistant.";
}
