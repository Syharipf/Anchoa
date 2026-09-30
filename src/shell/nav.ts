// Every top-level page, in nav order (docs/design/DESIGN.md §1).

export type PageId =
  | "dashboard"
  | "inbox"
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
  /** The fase that builds this module. */
  fase?: number;
  /** Set only on pages that are not built yet: shown on their placeholder page. */
  about?: string;
  /** Sits at the bottom of the nav rail. */
  bottom?: true;
}

export const PAGES: readonly NavPage[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "inbox", label: "Inbox" },
  {
    id: "email",
    label: "Email",
    fase: 8,
    about: "Kotak masuk IMAP dengan ringkasan dari asisten, saran balasan, dan dikte suara.",
  },
  {
    id: "jadwal",
    label: "Jadwal",
  },
  { id: "habit", label: "Habit" },
  { id: "keuangan", label: "Keuangan" },
  { id: "proyek", label: "Proyek" },
  {
    id: "berkas",
    label: "Berkas",
    fase: 6,
    about: "Pengelola file dengan pratinjau foto, video, PDF, dan teks.",
  },
  {
    id: "unduhan",
    label: "Unduhan",
    fase: 7,
    about: "Unduh file, video, dan audio lewat antrean dengan status yang jelas.",
  },
  {
    id: "profil",
    label: "Profil",
    about:
      "Profil tumbuh bersama modulnya: akun email, suara asisten, dan notifikasi. Pengaturan GitHub dan backup ada di Pengaturan.",
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
  if (page?.fase) return `${page.label} hadir di Fase ${page.fase}. Asisten suara menyusul di Fase 5.`;
  return "Asisten suara aktif di Fase 5. Untuk sekarang, coba ketuk mikrofon.";
}
