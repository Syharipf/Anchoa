import { GithubSection } from "./GithubSection";
import { H2, PANEL } from "../shell/ui";

export function IntegrationsSection({
  onChanged,
}: Readonly<{ onChanged: () => void }>) {
  return (
    <div className="flex flex-col gap-4">
      <GithubSection onChanged={onChanged} />
      <section className={`${PANEL} flex flex-col items-start gap-2`}>
        <div className="flex items-center gap-2">
          <h2 className={H2}>Laptop dari HP (SFTP)</h2>
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-muted">
            Menyusul
          </span>
        </div>
        <p className="m-0 text-sm leading-relaxed text-ink">
          Akses berkas laptop secara aman dari HP lewat Tailscale dan SFTP tanpa perantara cloud. Hadir bersama versi HP di Fase 9.
        </p>
      </section>
    </div>
  );
}
