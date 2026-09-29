import { AssistantStage } from "../assistant/AssistantStage";
import { ContributionsPanel } from "../contributions/ContributionsPanel";

/** Right panel (380px): code contributions on top, voice assistant stage below. */
export function Aside({ contributionsVersion, onOpenSettings }: Readonly<{ contributionsVersion: number; onOpenSettings: () => void }>) {
  return (
    <aside aria-label="Panel samping" className="flex w-[380px] shrink-0 flex-col overflow-hidden border-l border-line bg-sidebar">
      <ContributionsPanel version={contributionsVersion} onOpenSettings={onOpenSettings} />
      <AssistantStage />
    </aside>
  );
}
