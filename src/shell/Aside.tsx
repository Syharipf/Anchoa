import { AssistantStage } from "../assistant/AssistantStage";
import { LABEL } from "./ui";

/** Right panel (380px): code contributions on top, voice assistant stage below. */
export function Aside() {
  return (
    <aside aria-label="Panel samping" className="flex w-[380px] shrink-0 flex-col overflow-hidden border-l border-line bg-sidebar">
      <section aria-label="Kontribusi kode" className="flex flex-col gap-1 border-b border-line px-5 py-4">
        <h2 className={`m-0 text-[11px] font-medium ${LABEL}`}>Kontribusi kode</h2>
        <p className="m-0 text-xs text-muted">Segera: sambungkan GitHub di Pengaturan.</p>
      </section>
      <AssistantStage />
    </aside>
  );
}
