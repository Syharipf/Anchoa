import { useEffect, useRef } from "react";
import type { DayTask, FinanceSummary, HabitReminder } from "../api";
import { reminders, reminderText, type Reminder, type Tone } from "./reminders";

const TONE: Record<Tone, string> = { danger: "text-danger", warn: "text-warn", muted: "text-muted" };

function ReminderCard({ reminder, onOpen }: Readonly<{ reminder: Reminder; onOpen: () => void }>) {
  const text = reminderText(reminder);
  return (
    <div className="flex flex-col gap-1 rounded-[10px] bg-surface px-2.5 py-2.5">
      <span className="text-[13px] font-semibold">{text.title}</span>
      <span className={`text-xs ${TONE[text.tone]}`}>{text.detail}</span>
      <button onClick={onOpen} aria-label={`Buka ${text.title}`} className="self-end text-xs text-accent hover:text-accent-hover">
        Buka ›
      </button>
    </div>
  );
}

/** Panel beside the nav rail (docs/design/artboards/NotifPanel.dc.html, spec UI lanjutan U6, Fase 2 §5). */
export function NotifPanel({
  today,
  finance,
  habitReminders = [],
  onClose,
  onOpenItem,
  onOpenFinance,
  onOpenHabits,
}: Readonly<{
  today: DayTask[];
  finance: FinanceSummary | null;
  habitReminders?: HabitReminder[];
  onClose: () => void;
  onOpenItem: (id: string) => void;
  onOpenFinance: () => void;
  onOpenHabits: () => void;
}>) {
  const groups = reminders(today, finance, habitReminders);
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  // Focus the panel, then give focus back to the bell when it closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    return () => previous?.focus();
  }, []);

  const open = (r: Reminder) => {
    if (r.kind === "task") {
      onOpenItem(r.task.id);
    } else if (r.kind === "habit") {
      onOpenHabits();
    } else {
      onOpenFinance();
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-y-0 right-0 left-[72px] z-40"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if (e.key === "Tab") {
          // aria-modal: keep Tab inside the panel.
          const buttons = panel.current?.querySelectorAll<HTMLButtonElement>("button");
          if (!buttons?.length) return;
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }}
    >
      <button aria-label="Tutup panel notifikasi" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-[#05070a]/60" />
      <aside
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notif-title"
        data-anim
        style={{ animation: "anchoa-slide 0.18s ease-out" }}
        className="absolute inset-y-0 left-0 flex w-[400px] outline-none flex-col border-r border-[#2e3440] bg-stage shadow-[16px_0_40px_rgb(0_0_0/0.4)]"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-[18px] pt-5 pb-3">
          <h2 id="notif-title" className="m-0 font-display text-xl font-semibold">
            Notifikasi
          </h2>
          <span className={`rounded-full px-2 py-px font-mono text-[11px] text-canvas ${count > 0 ? "bg-accent" : "bg-disabled"}`}>{count}</span>
          <button
            ref={closeButton}
            onClick={onClose}
            aria-label="Tutup"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pt-1 pb-3">
          {groups.map((g) => (
            <section key={g.title} aria-label={g.title} className="flex flex-col gap-1">
              <h3 className="m-0 px-2 pt-3 pb-0.5 text-[11px] font-normal tracking-[0.08em] text-muted uppercase">{g.title}</h3>
              {g.items.map((r) => (
                <ReminderCard key={`${r.kind}-${r.id}`} reminder={r} onOpen={() => open(r)} />
              ))}
            </section>
          ))}
          {count === 0 && <p className="m-0 px-4 py-12 text-center text-[13px] text-muted">Tidak ada pengingat.</p>}
        </div>

        <p className="m-0 border-t border-line px-[18px] py-3 text-xs text-muted">
          Pengingat dari tugas, tagihan, dan batas pengeluaran. Notifikasi lain menyusul bersama modulnya.
        </p>
      </aside>
    </div>
  );
}
