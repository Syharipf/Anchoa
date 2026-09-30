import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { api, errorMessage, type ItemSummary } from "../api";
import type { PageId } from "../shell/nav";
import { useToast } from "../shell/toast";
import { paletteResults, type PaletteOption } from "./results";

const OPTION_ICON: Record<PaletteOption["kind"], ReactNode> = {
  action: <path d="M4 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4zM4 7l10-3v3M16 13h1" />,
  page: <path d="M5 12h14M13 6l6 6-6 6" />,
  item: <path d="M6 3h9l3 3v15H6zM9 11h6M9 15h6" />,
  capture: <path d="M12 5v14M5 12h14" />,
  task: <path d="M4 12l5 5L20 6" />,
};

const KBD = "rounded border border-disabled px-[5px] font-mono";

/** Ctrl K palette (docs/design/artboards/CommandPalette.dc.html, spec UI lanjutan U4). */
export function CommandPalette({
  recent,
  onClose,
  onNavigate,
  onOpenItem,
  onCaptured,
  onNewTransaction,
}: Readonly<{
  recent: ItemSummary[];
  onClose: () => void;
  onNavigate: (page: PageId) => void;
  onOpenItem: (id: string) => void;
  onCaptured: () => void;
  onNewTransaction: () => void;
}>) {
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const saving = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => paletteResults(query, recent), [query, recent]);
  const flat = groups.flatMap((g) => g.options);
  const current = Math.min(active, flat.length - 1);

  // Focus the input, then give focus back to whatever had it before the palette opened.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => previous?.focus();
  }, []);

  // Keep the highlighted option inside the scrolling list.
  useEffect(() => {
    const id = flat[current]?.id;
    if (id) document.getElementById(`palette-${id}`)?.scrollIntoView({ block: "nearest" });
  }, [flat, current]);

  async function run(option: PaletteOption) {
    if (option.kind === "action") {
      onNewTransaction();
      onClose();
    } else if (option.kind === "page") {
      onNavigate(option.page);
      onClose();
    } else if (option.kind === "item") {
      onOpenItem(option.itemId);
      onClose();
    } else if (option.kind === "task") {
      if (!saving.current) {
        saving.current = true;
        try {
          const task = await api.createTask({ title: option.text, status: "plan" });
          toast("Tugas dibuat", "info", {
            label: "Buka",
            run: () => onOpenItem(task.id),
          });
          onCaptured();
          onClose();
        } catch (e) {
          toast(errorMessage(e), "error");
        } finally {
          saving.current = false;
        }
      }
    } else if (!saving.current) {
      saving.current = true;
      try {
        await api.captureNote(option.text);
        toast("Tersimpan ke Inbox");
        onCaptured();
        onClose();
      } catch (e) {
        // Stay open with the text in place so nothing typed is lost.
        toast(errorMessage(e), "error");
      } finally {
        saving.current = false;
      }
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(current + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const option = flat[current];
      if (option) void run(option);
    } else if (e.key === "Tab") {
      e.preventDefault(); // the input is the only stop inside the modal dialog
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-40">
      <button aria-label="Tutup command palette" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-[#05070a]/80" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={onKeyDown}
        onMouseDown={(e) => {
          // Keep focus in the combobox when clicking non-focusable spots, so the keys keep working.
          if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
        }}
        data-anim
        style={{ animation: "anchoa-pop 0.16s ease-out" }}
        className="absolute top-[110px] left-1/2 -ml-[320px] flex w-[640px] flex-col overflow-hidden rounded-2xl border border-[#2e3440] bg-surface shadow-[0_24px_60px_rgb(0_0_0/0.65)]"
      >
        <div className="flex h-[58px] items-center gap-3 border-b border-line pr-3 pl-[18px]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-muted" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="palette-list"
            aria-activedescendant={flat[current] ? `palette-${flat[current].id}` : undefined}
            aria-label="Cari perintah atau halaman"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Ketik halaman, catatan, atau tulis ide…"
            className="min-w-0 flex-1 border-0 bg-transparent text-base text-ink outline-none placeholder:text-muted focus-visible:outline-none"
          />
          <kbd className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted">Esc</kbd>
        </div>

        <div id="palette-list" role="listbox" aria-label="Hasil" className="max-h-[440px] overflow-y-auto px-2 pt-1.5 pb-2">
          {groups.map((g) => (
            <div key={g.title} role="group" aria-label={g.title}>
              <div role="presentation" className="px-2.5 pt-2.5 pb-1 text-[11px] tracking-[0.08em] text-muted uppercase">
                {g.title}
              </div>
              {g.options.map((o) => {
                const index = flat.indexOf(o);
                const on = index === current;
                return (
                  <div
                    key={o.id}
                    id={`palette-${o.id}`}
                    role="option"
                    aria-selected={on}
                    tabIndex={-1}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => void run(o)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void run(o);
                      }
                    }}
                    className={`flex min-h-10 cursor-pointer items-center gap-3 rounded-[9px] px-2.5 text-sm ${on ? "bg-[#232833]" : ""}`}
                  >
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${on ? "bg-[#2e3440] text-accent" : "bg-surface-2 text-muted"}`}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        {OPTION_ICON[o.kind]}
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    <span className="text-xs text-muted">{o.sub}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <span className="sr-only" aria-live="polite">
          {flat.length} hasil
        </span>

        <div aria-hidden="true" className="flex items-center gap-4 border-t border-line bg-stage px-[18px] py-2.5 text-xs text-muted">
          <span>
            <kbd className={KBD}>↑↓</kbd> pilih
          </span>
          <span>
            <kbd className={KBD}>Enter</kbd> jalankan
          </span>
          <span>
            <kbd className={KBD}>Esc</kbd> tutup
          </span>
        </div>
      </div>
    </div>
  );
}
