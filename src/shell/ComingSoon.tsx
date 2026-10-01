import type { NavPage } from "./nav";
import { H1, PANEL, SECONDARY } from "./ui";
import { sensibleSection, type SettingsSection } from "../settings/view";

/** Placeholder for a page that a later fase builds (spec UI lanjutan U1, U11). */
export function ComingSoon({
  page,
  onOpenSettings,
}: Readonly<{
  page: NavPage;
  onOpenSettings: (section?: SettingsSection) => void;
}>) {
  const targetSection = sensibleSection(page.id);

  return (
    <div className="flex max-w-3xl flex-col gap-[18px]">
      <h1 className={H1}>{page.label}</h1>
      <section className={`${PANEL} flex flex-col items-start gap-2`}>
        <span className="text-xs uppercase tracking-[0.08em] text-accent">
          {page.fase ? `Hadir di Fase ${page.fase}` : "Menyusul"}
        </span>
        <p className="m-0 text-sm leading-relaxed text-ink">{page.about}</p>
        {targetSection && (
          <button
            type="button"
            onClick={() => onOpenSettings(targetSection)}
            className={`${SECONDARY} mt-2`}
          >
            Buka Pengaturan
          </button>
        )}
      </section>
    </div>
  );
}
