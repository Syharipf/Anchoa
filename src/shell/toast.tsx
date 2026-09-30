import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Kind = "info" | "error";

/** A button inside the toast, e.g. "Ubah" after "Tandai lunas". */
export interface ToastAction {
  label: string;
  run: () => void;
}

type Toast = { id: number; text: string; kind: Kind; action?: ToastAction };
type Show = (text: string, kind?: Kind, action?: ToastAction) => void;

const PLAIN_MS = 3000;
/** Longer, so there is time to press the action. */
const ACTION_MS = 6000;

const ToastContext = createContext<Show>(() => {});
let nextId = 0;

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback<Show>(
    (text, kind = "info", action) => {
      const id = ++nextId;
      setToasts((list) => [...list, { id, text, kind, action }]);
      setTimeout(() => dismiss(id), action ? ACTION_MS : PLAIN_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-3 rounded-[10px] border px-4 py-2 text-sm ${
              t.kind === "error" ? "border-danger bg-danger-row text-danger" : "border-line bg-surface-2 text-ink"
            }`}
          >
            {t.text}
            {t.action && (
              <button
                onClick={() => {
                  t.action?.run();
                  dismiss(t.id);
                }}
                className="font-semibold text-accent hover:text-accent-hover"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
