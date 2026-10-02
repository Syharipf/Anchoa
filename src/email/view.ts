import type { EmailFolder, EmailMessage, EmailStatus } from "../api";

export const FOLDERS: readonly Readonly<{ id: EmailFolder; label: string }>[] = [
  { id: "inbox", label: "Kotak masuk" },
  { id: "starred", label: "Berbintang" },
  { id: "sent", label: "Terkirim" },
];

export function connectionLabel(status: EmailStatus | null): string {
  if (!status) return "Memuat…";
  return status.connected && status.address ? `Terhubung sebagai ${status.address}` : "Belum terhubung";
}

export function parseRecipients(value: string): string[] {
  return value.split(",").map((address) => address.trim()).filter(Boolean);
}

export function replySubject(subject: string): string {
  let title = subject.trim();
  while (/^re:/i.test(title)) title = title.slice(3).trimStart();
  return `Re: ${title}`;
}

export function sender(message: EmailMessage): string {
  return message.fromName || message.fromAddr;
}

export function emailDate(sentAt: number): string {
  return new Date(sentAt).toLocaleString("id-ID", {
    day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export type TextPart = Readonly<{ text: string; offset: number; url?: string }>;

/** Keep every character as text; only standalone web URLs become explicit open actions. */
export function textParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let offset = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    if (match.index > 0 && /[\w/]/.test(text[match.index - 1])) continue;
    let url = match[0];
    while (".,!?:;".includes(url.at(-1) ?? " ")) url = url.slice(0, -1);
    // Sentence parentheses are excluded; balanced parentheses within a URL are preserved.
    let unmatched = url.split(")").length - url.split("(").length;
    while (url.endsWith(")") && unmatched > 0) { url = url.slice(0, -1); unmatched--; }
    try {
      if (!new URL(url).hostname) continue;
    } catch {
      continue;
    }
    if (match.index > offset) parts.push({ text: text.slice(offset, match.index), offset });
    parts.push({ text: url, url, offset: match.index });
    offset = match.index + url.length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), offset });
  return parts;
}
