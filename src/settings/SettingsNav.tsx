import type { KeyboardEvent } from "react";
import {
  SETTINGS_SECTIONS,
  sectionStatus,
  type SettingsSection,
  type StatusContext,
} from "./view";

export interface SettingsNavProps {
  readonly current: SettingsSection;
  readonly onSelect: (section: SettingsSection) => void;
  readonly statusContext?: StatusContext;
}

export function SettingsNav({
  current,
  onSelect,
  statusContext,
}: Readonly<SettingsNavProps>) {
  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (e.key === "ArrowDown") {
      nextIndex = (index + 1) % SETTINGS_SECTIONS.length;
    } else if (e.key === "ArrowUp") {
      nextIndex = (index - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length;
    } else if (e.key === "Home") {
      nextIndex = 0;
    } else if (e.key === "End") {
      nextIndex = SETTINGS_SECTIONS.length - 1;
    }

    if (nextIndex !== null) {
      e.preventDefault();
      const target = SETTINGS_SECTIONS[nextIndex];
      onSelect(target.id);
      const buttons = (e.currentTarget.parentElement?.querySelectorAll("button") ??
        []) as NodeListOf<HTMLButtonElement>;
      buttons[nextIndex]?.focus();
    }
  }

  return (
    <nav
      aria-label="Bagian pengaturan"
      className="flex w-[212px] shrink-0 self-start flex-col gap-0.5 rounded-[14px] border border-line bg-surface p-2"
    >
      {SETTINGS_SECTIONS.map((s, index) => {
        const active = current === s.id;
        const sub = sectionStatus(s.id, statusContext);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 text-left transition-colors ${
              active
                ? "bg-surface-2 text-ink"
                : "text-ink hover:bg-surface-2/60"
            }`}
          >
            <span className={`flex shrink-0 ${active ? "text-accent" : "text-muted"}`}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={s.icon} />
              </svg>
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[13px] leading-tight font-medium">
                {s.label}
              </span>
              <span
                className={`truncate text-[11px] leading-tight ${
                  active && sub === "Terhubung"
                    ? "text-accent"
                    : "text-muted"
                }`}
              >
                {sub}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
