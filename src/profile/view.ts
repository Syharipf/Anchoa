// Helper functions and metadata for the profile page.
import type { NotifyDelivery, NotifyPrefs, NotifyStatus, ProfileStats } from "../api";

export function profileInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return "K";
  return parts
    .map((part) => Array.from(part)[0])
    .join("")
    .toLocaleUpperCase("id-ID");
}

export function formatSince(since: number | null): string {
  if (since === null) return "Memakai Anchoa baru saja";
  const d = new Date(since);
  const monthYear = d.toLocaleDateString("id-ID", { month: "short", year: "numeric" });
  return `Memakai Anchoa sejak ${monthYear}`;
}

export interface StatItem {
  readonly label: string;
  readonly value: number;
}

export function profileStatsList(stats?: ProfileStats | null): readonly StatItem[] {
  return [
    { label: "hari streak", value: stats?.habitStreak ?? 0 },
    { label: "tugas selesai", value: stats?.tasksDone ?? 0 },
    { label: "entri jurnal", value: stats?.journalEntries ?? 0 },
    { label: "catatan", value: stats?.notes ?? 0 },
  ];
}

export interface NotifyPrefOption {
  readonly key: Exclude<keyof NotifyPrefs, "journalAt">;
  readonly label: string;
  readonly description: string;
}

export const NOTIFY_PREF_OPTIONS: readonly NotifyPrefOption[] = [
  {
    key: "task",
    label: "Tugas",
    description: "Pengingat tenggat dan tugas hari ini",
  },
  {
    key: "bill",
    label: "Tagihan",
    description: "Jatuh tempo dan terlambat",
  },
  {
    key: "budget",
    label: "Batas anggaran",
    description: "Peringatan saat melebihi 80% batas",
  },
  {
    key: "habit",
    label: "Habit",
    description: "Pengingat kebiasaan harian yang belum dicentang",
  },
  {
    key: "journal",
    label: "Jurnal",
    description: "Pengingat menulis jurnal harian",
  },
] as const;

export const OS_PERMISSION_LABEL: Readonly<Record<NotifyStatus["permission"], string>> = {
  granted: "Notifikasi sistem: aktif",
  denied: "Notifikasi sistem: ditolak",
  prompt: "Notifikasi sistem: belum diizinkan",
};

export const DELIVERY_STATE_LABEL: Readonly<Record<NotifyDelivery["state"], string>> = {
  shown: "Terkirim",
  denied: "Ditolak sistem",
  failed: "Gagal dikirim",
  skipped: "Dilewati, kategori mati",
};

/** Rows of the delivery log shown under the notification switches. */
export const RECENT_DELIVERIES_SHOWN = 5;
