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
  { id: "jurnal", label: "Jurnal" },
  { id: "catatan", label: "Catatan" },
  {
    id: "email",
    label: "Email",
  },
  {
    id: "jadwal",
    label: "Jadwal",
  },
  { id: "habit", label: "Habit" },
  { id: "keuangan", label: "Keuangan" },
  { id: "proyek", label: "Proyek" },
  { id: "berkas", label: "Berkas" },
  { id: "unduhan", label: "Unduhan" },
  {
    id: "profil",
    label: "Profil",
    bottom: true,
  },
  { id: "settings", label: "Pengaturan", bottom: true },
];

const BY_ID = Object.fromEntries(PAGES.map((p) => [p.id, p])) as Record<PageId, NavPage>;

export function pageInfo(id: PageId): NavPage {
  return BY_ID[id];
}

/** One line for the mini assistant on each page. */
export function assistantHint(page: NavPage | null): string {
  return page
    ? `Ada yang ingin dibantu di ${page.label}? Ketik pesan atau ketuk mikrofon.`
    : "Ketik pesan atau ketuk mikrofon untuk bicara dengan asisten.";
}
