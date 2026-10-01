const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function greeting(hour: number): string {
  if (hour >= 4 && hour < 11) return "Selamat pagi";
  if (hour >= 11 && hour < 15) return "Selamat siang";
  if (hour >= 15 && hour < 18) return "Selamat sore";
  return "Selamat malam";
}

/** "Selasa, 29 September" */
export function fullDate(ms: number): string {
  return new Date(ms).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" });
}

/** "Rab 30 Sep · 00:48" for the header clock. */
export function clockLabel(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const weekday = d.toLocaleDateString("id-ID", { weekday: "short" });
  return `${weekday} ${shortDate(ms)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "12 Sep" */
export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

export function relativeTime(then: number, now: number): string {
  const diff = now - then;
  if (diff < MINUTE) return "baru saja";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} menit lalu`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} jam lalu`;
  // Math.round absorbs 23/25-hour days around DST changes.
  const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY);
  if (days <= 1) return "kemarin";
  if (days < 7) return `${days} hari lalu`;
  return shortDate(then);
}

/** `<input type="date">` value ("2026-10-01") to local midnight in epoch ms. */
export function dateInputToMs(value: string): number | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
}

export function msToDateInput(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-10-01" (a local date from the backend) to { weekday: "Kam", day: 1 }. */
export function upcomingLabel(date: string): { weekday: string; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).toLocaleDateString("id-ID", { weekday: "short" });
  return { weekday, day };
}

const BYTE_FMT = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 });

/** Formats byte sizes using Indonesian conventions: "0 B", "1023 B", "1,5 KB", "12,3 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${BYTE_FMT.format(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${BYTE_FMT.format(bytes / (1024 * 1024))} MB`;
  return `${BYTE_FMT.format(bytes / (1024 * 1024 * 1024))} GB`;
}

