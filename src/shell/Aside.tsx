import { AssistantStage } from "../assistant/AssistantStage";
import { ContributionsPanel } from "../contributions/ContributionsPanel";

export interface AsideProps {
  readonly contributionsVersion: number;
  readonly onOpenSettings: () => void;
  readonly onOpenAiSettings?: () => void;
  readonly onOpenVoiceSettings?: () => void;
  readonly onChanged?: () => void;
}

/** Right panel (380px): code contributions on top, voice assistant stage below. */
export function Aside({
  contributionsVersion,
  onOpenSettings,
  onOpenAiSettings,
  onOpenVoiceSettings,
  onChanged,
}: Readonly<AsideProps>) {
  return (
    <aside aria-label="Panel samping" className="flex w-[380px] shrink-0 flex-col overflow-hidden border-l border-line bg-sidebar">
      <ContributionsPanel version={contributionsVersion} onOpenSettings={onOpenSettings} />
      <AssistantStage
        onOpenAiSettings={onOpenAiSettings}
        onOpenVoiceSettings={onOpenVoiceSettings}
        onChanged={onChanged}
      />
    </aside>
  );
}
