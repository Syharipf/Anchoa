// Rupiah amounts are whole numbers (spec Fase 2 K2). Months are "YYYY-MM" strings.

const DIGITS = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const MINUS = "−";
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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

/**
 * Safely calculates simple math expression (+, -, *, /) without eval/Function.
 * Operates strictly on integers and valid safe math symbols.
 */
export function evaluateSafeMath(expr: string): number | null {
  const cleaned = expr.replaceAll(/\s+/g, "").replaceAll("Rp", "").replaceAll("rp", "");
  // Strictly allow only digits, periods, and operators + - * /
  if (!/^[0-9.+\-*/]+$/.test(cleaned)) return null;
  // Split tokens while preserving delimiters
  const tokens = cleaned.match(/([0-9.]+|[+\-*/])/g);
  if (!tokens || tokens.length === 0) return null;

  // First pass: replace numbers without dots into integers
  const parsedTokens: (number | string)[] = [];
  for (const tok of tokens) {
    if (tok === "+" || tok === "-" || tok === "*" || tok === "/") {
      parsedTokens.push(tok);
    } else {
      const num = Number(tok.replaceAll(".", ""));
      if (!Number.isSafeInteger(num) || isNaN(num)) return null;
      parsedTokens.push(num);
    }
  }

  // Pass 1: handle multiplication and division left to right
  const intermediate: (number | string)[] = [];
  let i = 0;
  while (i < parsedTokens.length) {
    const curr = parsedTokens[i];
    if (curr === "*" || curr === "/") {
      const prev = intermediate.pop();
      const next = parsedTokens[i + 1];
      if (typeof prev !== "number" || typeof next !== "number") return null;
      if (curr === "/" && next === 0) return null;
      const res = curr === "*" ? prev * next : Math.round(prev / next);
      if (!Number.isSafeInteger(res)) return null;
      intermediate.push(res);
      i += 2;
    } else {
      intermediate.push(curr);
      i++;
    }
  }

  // Pass 2: handle addition and subtraction
  if (intermediate.length === 0 || typeof intermediate[0] !== "number") return null;
  let total = intermediate[0];
  let j = 1;
  while (j < intermediate.length) {
    const op = intermediate[j];
    const nextVal = intermediate[j + 1];
    if (typeof nextVal !== "number") return null;
    if (op === "+") total += nextVal;
    else if (op === "-") total -= nextVal;
    else return null;
    if (!Number.isSafeInteger(total)) return null;
    j += 2;
  }
  return total;
}

/** "25000", "25.000", "Rp 25.000", "-25.000", or safe math "15000 + 25000". */
export function parseRupiah(text: string): number | null {
  const trimmed = text.trim();
  // Try plain amount first
  const match = AMOUNT.exec(trimmed);
  if (match) {
    const value = Number(match[2].replaceAll(".", ""));
    if (!Number.isSafeInteger(value)) return null;
    return match[1] ? -value : value;
  }
  // Fallback to safe math evaluation
  if (/[+\-*/]/.test(trimmed)) {
    return evaluateSafeMath(trimmed);
  }
  return null;
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
