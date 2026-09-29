import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Kind = "info" | "error";
type Toast = { id: number; text: string; kind: Kind };

const ToastContext = createContext<(text: string, kind?: Kind) => void>(() => {});
let nextId = 0;

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((text: string, kind: Kind = "info") => {
    const id = ++nextId;
    setToasts((list) => [...list, { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-[10px] border px-4 py-2 text-sm ${
              t.kind === "error" ? "border-danger bg-danger-row text-danger" : "border-line bg-surface-2 text-ink"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
