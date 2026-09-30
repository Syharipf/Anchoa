import type { AccountView } from "../api";
import { formatDigits, parseRupiah } from "../money";
import { Field } from "../shell/Dialog";
import { FIELD } from "../shell/ui";

/** Rupiah text field: accepts "25000", "25.000" or "Rp 25.000" and regroups the digits on blur. */
export function MoneyField({
  label,
  value,
  onChange,
}: Readonly<{ label: string; value: string; onChange: (value: string) => void }>) {
  return (
    <Field label={label}>
      <input
        inputMode="numeric"
        value={value}
        placeholder="0"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          const amount = parseRupiah(value);
          if (amount !== null) onChange(formatDigits(amount));
        }}
        className={FIELD}
      />
    </Field>
  );
}

export function AccountSelect({
  label,
  accounts,
  value,
  onChange,
}: Readonly<{ label: string; accounts: AccountView[]; value: string; onChange: (id: string) => void }>) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={FIELD}>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Mutually exclusive buttons, e.g. Pengeluaran | Pemasukan | Transfer. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: Readonly<{
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: (value: T) => boolean;
}>) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-[10px] border border-line p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          disabled={disabled?.(o.value)}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] disabled:text-disabled ${
            value === o.value ? "bg-surface-2 text-ink" : "text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
