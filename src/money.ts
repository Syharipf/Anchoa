// Rupiah amounts are whole numbers (spec Fase 2 K2). Months are "YYYY-MM" strings.

const DIGITS = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const MINUS = "−";
const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const AMOUNT = /^([-−]?)\s*(?:rp\.?\s*)?(\d{1,3}(?:\.\d{3})+|\d+)$/i;

/** 25000 → "25.000", -25000 → "-25.000". The format of the amount fields. */
export function formatDigits(amount: number): string {
  return (amount < 0 ? "-" : "") + DIGITS.format(Math.abs(amount));
}

/** "Rp 25.000". The sign is dropped; see signedRupiah and formatBalance. */
export function formatRupiah(amount: number): string {
  return `Rp ${DIGITS.format(Math.abs(amount))}`;
}

/** "+Rp 25.000", "−Rp 25.000" or "Rp 0", for transaction rows and net flow. */
export function signedRupiah(amount: number): string {
  if (amount > 0) return `+${formatRupiah(amount)}`;
  if (amount < 0) return MINUS + formatRupiah(amount);
  return formatRupiah(0);
}

/** A balance: "Rp 25.000", or "−Rp 25.000" when it is debt. */
export function formatBalance(amount: number): string {
  return amount < 0 ? signedRupiah(amount) : formatRupiah(amount);
}

/** "25000", "25.000", "Rp 25.000" or "-25.000" to whole rupiah. Decimals and text give null. */
export function parseRupiah(text: string): number | null {
  const match = AMOUNT.exec(text.trim());
  if (!match) return null;
  const value = Number(match[2].replaceAll(".", ""));
  if (!Number.isSafeInteger(value)) return null;
  return match[1] ? -value : value;
}

function parts(month: string): [year: number, month: number] {
  const [year, mon] = month.split("-").map(Number);
  return [year, mon];
}

/** "2026-09" → "September 2026". */
export function monthLabel(month: string): string {
  const [year, mon] = parts(month);
  return `${MONTHS[mon - 1]} ${year}`;
}

/** "2026-09" → "Sep". */
export function monthShort(month: string): string {
  return MONTHS_SHORT[parts(month)[1] - 1];
}

/** Local "YYYY-MM" of an epoch-ms date. */
export function monthOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-01" moved by -1 → "2025-12". */
export function addMonths(month: string, n: number): string {
  const [year, mon] = parts(month);
  return monthOf(new Date(year, mon - 1 + n, 1).getTime());
}
