import { AssistantStage } from "../assistant/AssistantStage";
import { ContributionsPanel } from "../contributions/ContributionsPanel";

export interface AsideProps {
  readonly contributionsVersion: number;
  readonly onOpenSettings: () => void;
  readonly onOpenAiSettings?: () => void;
  readonly onChanged?: () => void;
}

/** Right panel (380px): code contributions on top, voice assistant stage below. */
export function Aside({
  contributionsVersion,
  onOpenSettings,
  onOpenAiSettings,
  onChanged,
}: Readonly<AsideProps>) {
  return (
    <aside aria-label="Panel samping" className="flex w-[380px] shrink-0 flex-col overflow-hidden border-l border-line bg-sidebar">
      <ContributionsPanel version={contributionsVersion} onOpenSettings={onOpenSettings} />
      <AssistantStage onOpenAiSettings={onOpenAiSettings} onChanged={onChanged} />
    </aside>
  );
}
