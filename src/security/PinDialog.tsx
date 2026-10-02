import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../api";
import { Dialog, DialogActions } from "../shell/Dialog";
import { PinFields, type PinFormMode } from "./PinFields";

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

export function PinDialog({
  mode,
  onClose,
  onSuccess,
}: Readonly<{
  mode: PinFormMode;
  onClose: () => void;
  onSuccess: () => void;
}>) {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const title =
    mode === "create" ? "Buat PIN" : mode === "change" ? "Ganti PIN" : "Matikan PIN";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;

    if (mode === "create" || mode === "change") {
      if (!isValidPin(newPin)) {
        setError("PIN harus 4–8 digit angka");
        return;
      }
      if (newPin !== confirmPin) {
        setError("Konfirmasi PIN tidak cocok");
        return;
      }
    }

    if (mode === "change" && !currentPin) {
      setError("PIN saat ini harus diisi");
      return;
    }

    if (mode === "disable" && !currentPin) {
      setError("PIN saat ini harus diisi");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (mode === "create") {
        await api.setPin(null, newPin);
      } else if (mode === "change") {
        await api.setPin(currentPin, newPin);
      } else {
        await api.disablePin(currentPin);
      }
      onSuccess();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-danger/40 bg-danger-row p-3 text-xs text-danger"
          >
            {error}
          </div>
        )}
        <PinFields
          mode={mode}
          currentPin={currentPin}
          newPin={newPin}
          confirmPin={confirmPin}
          onCurrentPinChange={(val) => {
            setCurrentPin(val);
            setError(null);
          }}
          onNewPinChange={(val) => {
            setNewPin(val);
            setError(null);
          }}
          onConfirmPinChange={(val) => {
            setConfirmPin(val);
            setError(null);
          }}
          disabled={busy}
        />
        <DialogActions busy={busy} onCancel={onClose} />
      </form>
    </Dialog>
  );
}
