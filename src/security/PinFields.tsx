import { Field } from "../shell/Dialog";
import { FIELD } from "../shell/ui";

export type PinFormMode = "create" | "change" | "disable";

export function PinFields({
  mode,
  currentPin,
  newPin,
  confirmPin,
  onCurrentPinChange,
  onNewPinChange,
  onConfirmPinChange,
  disabled = false,
}: Readonly<{
  mode: PinFormMode;
  currentPin: string;
  newPin: string;
  confirmPin: string;
  onCurrentPinChange: (value: string) => void;
  onNewPinChange: (value: string) => void;
  onConfirmPinChange: (value: string) => void;
  disabled?: boolean;
}>) {
  return (
    <div className="flex flex-col gap-3">
      {(mode === "change" || mode === "disable") && (
        <Field label={mode === "change" ? "PIN saat ini" : "Masukkan PIN saat ini"}>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            autoComplete="current-password"
            aria-label="PIN saat ini"
            placeholder="••••"
            value={currentPin}
            onChange={(e) => onCurrentPinChange(e.target.value)}
            disabled={disabled}
            className={FIELD}
          />
        </Field>
      )}
      {(mode === "create" || mode === "change") && (
        <>
          <Field label={mode === "create" ? "PIN (4–8 digit)" : "PIN baru (4–8 digit)"}>
            <input
              type="password"
              inputMode="numeric"
              autoFocus={mode === "create"}
              autoComplete="new-password"
              aria-label={mode === "create" ? "PIN" : "PIN baru"}
              placeholder="••••"
              value={newPin}
              onChange={(e) => onNewPinChange(e.target.value)}
              disabled={disabled}
              className={FIELD}
            />
          </Field>
          <Field label="Konfirmasi PIN">
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              aria-label="Konfirmasi PIN"
              placeholder="••••"
              value={confirmPin}
              onChange={(e) => onConfirmPinChange(e.target.value)}
              disabled={disabled}
              className={FIELD}
            />
          </Field>
        </>
      )}
    </div>
  );
}
