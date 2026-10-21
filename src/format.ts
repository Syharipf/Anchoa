const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function greeting(hour: number): string {
  if (hour >= 4 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 21) return "Good evening";
  return "Good night";
}

/** "Tuesday, September 29" */
export function fullDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" });
}

/** "Wed, Sep 30 · 00:48" for the header clock. */
export function clockLabel(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  return `${weekday}, ${shortDate(ms)} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Sep 12" */
export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function relativeTime(then: number, now: number): string {
  const diff = now - then;
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  }
  // Math.round absorbs 23/25-hour days around DST changes.
  const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY);
  if (days <= 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return shortDate(then);
}

/** `<input type="date">` value ("2026-10-01") to local midnight in epoch ms. */
export function dateInputToMs(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year === 0) return null;
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.getTime();
}

export function msToDateInput(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${String(d.getFullYear()).padStart(4, "0")}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-10-01" (a local date from the backend) to { weekday: "Kam", day: 1 }. */
export function upcomingLabel(date: string): { weekday: string; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).toLocaleDateString("en-US", { weekday: "short" });
  return { weekday, day };
}

const BYTE_FMT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });


/** Formats byte sizes using Indonesian conventions: "0 B", "1023 B", "1,5 KB", "12,3 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${BYTE_FMT.format(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${BYTE_FMT.format(bytes / (1024 * 1024))} MB`;
  return `${BYTE_FMT.format(bytes / (1024 * 1024 * 1024))} GB`;
}
