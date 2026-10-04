import { useEffect, useRef, useState, type KeyboardEvent, type JSX } from "react";

export type MenuEntry =
  | Readonly<{ label: string; onSelect: () => void; danger?: boolean; checked?: boolean }>
  | "separator";

export type MenuAnchor = Readonly<{ x: number; y: number }>;

export function anchorOf(e: Readonly<{ clientX: number; clientY: number; currentTarget: Element }>): MenuAnchor {
  if (e.clientX !== 0 || e.clientY !== 0) return { x: e.clientX, y: e.clientY };
  const rect = e.currentTarget.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
}

const ITEM = "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors";

export interface ContextMenuResult {
  menu: JSX.Element | null;
  open: (anchor: MenuAnchor, entries: readonly MenuEntry[]) => void;
  close: () => void;
}

export function useContextMenu(): ContextMenuResult {
  const [state, setState] = useState<{ anchor: MenuAnchor; entries: readonly MenuEntry[] } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  const close = () => {
    setState(null);
    (opener.current as HTMLElement | null)?.focus?.();
  };
  const open = (anchor: MenuAnchor, entries: readonly MenuEntry[]) => {
    opener.current = typeof document === "undefined" ? null : document.activeElement;
    setState({ anchor, entries });
  };

  useEffect(() => {
    if (!state) return;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus?.();
    const outside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setState(null);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [state]);
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? index + 1 : index - 1;
    items[(next + items.length) % items.length]?.focus();
  }

  const menu = state && (
    <div
      ref={ref}
      role="menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{
        left: Math.min(state.anchor.x, (globalThis.innerWidth ?? 1280) - 200),
        top: Math.min(state.anchor.y, (globalThis.innerHeight ?? 800) - 16 - state.entries.length * 30),
      }}
      className="fixed z-50 flex w-48 flex-col rounded-xl border border-line bg-surface p-1 shadow-lg"
    >
      {state.entries.map((entry, i) =>
        entry === "separator" ? (
          <hr key={`sep-${i}`} className="my-1 border-line" />
        ) : (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            onClick={() => {
              setState(null);
              entry.onSelect();
            }}
            className={`${ITEM} ${entry.danger ? "text-danger hover:bg-danger-row" : "text-ink hover:bg-surface-2"}`}
          >
            {entry.checked ? "✓ " : ""}
            {entry.label}
          </button>
        ),
      )}
    </div>
  );

  return { menu, open, close };
}
