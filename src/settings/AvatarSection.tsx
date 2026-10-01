import { H2, PANEL } from "../shell/ui";

export function AvatarSection() {
  return (
    <div className="flex flex-col gap-4">
      <section className={PANEL}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 className={H2}>Avatar Asisten</h2>
          </div>
          <div
            role="status"
            className="flex items-start gap-3 rounded-xl border border-line bg-surface-2/60 p-4 text-sm"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface text-accent">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </span>
            <div className="flex flex-1 flex-col gap-1">
              <span className="font-medium text-ink">Avatar Statis</span>
              <p className="m-0 text-xs text-muted leading-relaxed">
                Avatar statis (kawanan teri). Live2D menyusul setelah cek lisensi Cubism.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
