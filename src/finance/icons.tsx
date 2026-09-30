import type { ReactNode } from "react";
import type { AccountKind } from "../api";
import type { TransactionIcon } from "./view";

export type Glyph = TransactionIcon | AccountKind;

const PATHS: Record<Glyph, ReactNode> = {
  car: <path d="M5 17h14M6 17v2M18 17v2M4 13l2-5h12l2 5v4H4z" />,
  food: <path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M16 3c-2 1-3 4-3 7h3v11" />,
  bill: <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />,
  bag: <path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2" />,
  income: <path d="M12 19V5M6 11l6-6 6 6" />,
  transfer: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
  other: <circle cx="12" cy="12" r="8" />,
  cash: (
    <>
      <rect x="3" y="7" width="18" height="10" rx="2" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  bank: <path d="M3 10h18M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18M12 4l9 5H3z" />,
  ewallet: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  credit: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18" />
    </>
  ),
};

/** 24×24 stroke icon for finance rows. */
export function FinanceIcon({ name, size = 15 }: Readonly<{ name: Glyph; size?: number }>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
