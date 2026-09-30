import type { NavPage } from "./nav";
import { H1, PANEL, SECONDARY } from "./ui";

/** Placeholder for a page that a later fase builds (spec UI lanjutan U1, U11). */
export function ComingSoon({ page, onOpenSettings }: Readonly<{ page: NavPage; onOpenSettings: () => void }>) {
  return (
    <div className="flex max-w-3xl flex-col gap-[18px]">
      <h1 className={H1}>{page.label}</h1>
      <section className={`${PANEL} flex flex-col items-start gap-2`}>
        <span className="text-xs tracking-[0.08em] text-accent uppercase">
          {page.fase ? `Hadir di Fase ${page.fase}` : "Menyusul"}
        </span>
        <p className="m-0 text-sm leading-relaxed text-ink">{page.about}</p>
        {page.id === "profil" && (
          <button onClick={onOpenSettings} className={`${SECONDARY} mt-2`}>
            Buka Pengaturan
          </button>
        )}
      </section>
    </div>
  );
}
