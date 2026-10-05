import type { AiStatus } from "../api";

export interface OllamaOfflineCardProps {
  readonly onOpenAiSettings?: () => void;
  readonly status?: AiStatus;
}

export function OllamaOfflineCard({ onOpenAiSettings, status }: Readonly<OllamaOfflineCardProps>) {
  const custom = status?.provider === "custom";
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-xl border border-warn/40 bg-surface p-3"
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-warn" aria-hidden="true" />
        <span className="text-xs font-semibold text-warn">{custom ? `${status.name || "Kustom"} tidak tersedia` : "Ollama belum berjalan"}</span>
      </div>
      {custom ? <p className="m-0 text-xs text-muted leading-relaxed">{status.error || "Periksa koneksi, URL, key, dan model Kustom di Pengaturan."}</p> : <>
        <p className="m-0 text-xs text-muted leading-relaxed">Jalankan service Ollama di laptop:</p>
        <code className="rounded bg-surface-2 px-2 py-1 font-mono text-xs text-ink select-all">sudo systemctl start ollama</code>
      </>}
      {onOpenAiSettings && (
        <button
          type="button"
          onClick={onOpenAiSettings}
          className="self-start pt-0.5 text-xs text-accent hover:underline cursor-pointer"
        >
          Pengaturan › Asisten & AI
        </button>
      )}
    </div>
  );
}
