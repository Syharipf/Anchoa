export interface VoiceMissingCardProps {
  readonly onOpenVoiceSettings?: () => void;
  readonly compact?: boolean;
}

export function VoiceMissingCard({
  onOpenVoiceSettings,
  compact = false,
}: Readonly<VoiceMissingCardProps>) {
  return (
    <div
      role="alert"
      className={`flex flex-col gap-1.5 rounded-xl border border-warn/40 bg-surface ${
        compact ? "p-2.5" : "p-3"
      } text-xs`}
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-warn" aria-hidden="true" />
        <span className="font-semibold text-warn">Suara belum dipasang</span>
      </div>
      <p className="m-0 text-muted leading-relaxed">
        Fitur suara (whisper &amp; Piper) perlu dipasang terlebih dahulu di pengaturan.
      </p>
      {onOpenVoiceSettings && (
        <button
          type="button"
          onClick={onOpenVoiceSettings}
          className="self-start pt-0.5 font-medium text-accent hover:underline cursor-pointer"
        >
          Pengaturan › Suara
        </button>
      )}
    </div>
  );
}
