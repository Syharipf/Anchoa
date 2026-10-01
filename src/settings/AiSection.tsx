import { useCallback, useEffect, useState } from "react";
import {
  api,
  errorMessage,
  type AiRole,
  type AiRoles,
  type AiStatus,
} from "../api";
import { FIELD, H2, PANEL, SECONDARY } from "../shell/ui";

export interface AiSectionProps {
  readonly onChanged?: () => void;
}

const ROLES: readonly {
  readonly id: AiRole;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    id: "chat",
    label: "Percakapan & aksi",
    description: "Perintah suara, percakapan umum, dan pembuatan usulan aksi",
  },
  {
    id: "journal",
    label: "Tanggapan jurnal",
    description: "Refleksi dan tanggapan entri jurnal (wajib model lokal)",
  },
  {
    id: "recap",
    label: "Rekap harian",
    description: "Ringkasan agenda, tagihan, dan habit harian",
  },
] as const;

export function AiSection({ onChanged }: Readonly<AiSectionProps>) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [roles, setRoles] = useState<AiRoles | null>(null);
  const [testing, setTesting] = useState(false);
  const [testFeedback, setTestFeedback] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<AiRole | null>(null);

  const load = useCallback(async () => {
    try {
      const [aiStat, aiR] = await Promise.all([
        api.aiStatus().catch((e) => ({
          available: false,
          models: [],
          error: errorMessage(e),
        })),
        api.aiRoles().catch(() => null),
      ]);
      setStatus(aiStat);
      setRoles(aiR);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleTest = async () => {
    setTesting(true);
    setTestFeedback(null);
    try {
      const res = await api.aiStatus();
      setStatus(res);
      if (res.available) {
        setTestFeedback(`Koneksi berhasil: ${res.models.length} model ditemukan`);
      } else {
        setTestFeedback(
          `Gagal: ${res.error || "Ollama belum berjalan di 127.0.0.1:11434"}`,
        );
      }
      onChanged?.();
    } catch (e) {
      const msg = errorMessage(e);
      setStatus({ available: false, models: [], error: msg });
      setTestFeedback(`Gagal: ${msg}`);
      onChanged?.();
    } finally {
      setTesting(false);
    }
  };

  const handleModelChange = async (role: AiRole, model: string) => {
    setSavingRole(role);
    try {
      const updated = await api.setAiRole(role, "ollama", model);
      setRoles((prev) => (prev ? { ...prev, [role]: updated } : prev));
      onChanged?.();
    } catch (e) {
      setTestFeedback(`Gagal menyimpan model: ${errorMessage(e)}`);
    } finally {
      setSavingRole(null);
    }
  };

  const availableModels = status?.models ?? [];
  const reachable = status?.available ?? false;

  return (
    <div className="flex flex-col gap-4">
      {/* Ollama Status & Connection */}
      <section aria-labelledby="ai-ollama-heading" className={PANEL}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <h2 id="ai-ollama-heading" className={H2}>
              Ollama (Lokal)
            </h2>
            <span
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                reachable
                  ? "bg-accent/15 text-accent"
                  : "bg-danger/15 text-danger"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  reachable ? "bg-accent" : "bg-danger"
                }`}
                aria-hidden="true"
              />
              {reachable ? "Terhubung" : "Ollama mati"}
            </span>
          </div>
          <button
            type="button"
            disabled={testing}
            onClick={handleTest}
            className={`${SECONDARY} flex items-center gap-1.5 text-xs cursor-pointer disabled:opacity-50`}
          >
            {testing ? "Menguji…" : "Tes koneksi"}
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-2.5 text-xs text-muted">
          <div className="flex items-baseline justify-between border-t border-line pt-2.5">
            <span>Base URL</span>
            <code className="font-mono text-ink">http://127.0.0.1:11434</code>
          </div>
          <div className="flex items-baseline justify-between border-t border-line pt-2.5">
            <span>Status</span>
            <span className="text-ink">
              {reachable
                ? `${availableModels.length} model terdeteksi`
                : status?.error || "Ollama belum berjalan di 127.0.0.1:11434"}
            </span>
          </div>
          {!reachable && (
            <div className="mt-1 flex flex-col gap-1 rounded-lg bg-surface-2 p-2.5 text-xs">
              <span className="text-muted">Jalankan service Ollama:</span>
              <code className="font-mono text-ink select-all">
                sudo systemctl start ollama
              </code>
            </div>
          )}
          {testFeedback && (
            <div
              role="status"
              className={`mt-1 rounded-lg px-2.5 py-1.5 text-xs ${
                reachable
                  ? "bg-accent/10 text-accent"
                  : "bg-danger/10 text-danger"
              }`}
            >
              {testFeedback}
            </div>
          )}
        </div>
      </section>

      {/* Model Picker Per Role */}
      <section aria-labelledby="ai-roles-heading" className={PANEL}>
        <div className="flex flex-col gap-0.5">
          <h2 id="ai-roles-heading" className={H2}>
            Model per tugas
          </h2>
          <span className="text-xs text-muted">
            Pilih model Ollama yang digunakan untuk tiap tugas
          </span>
        </div>

        <div className="mt-3 flex flex-col divide-y divide-line">
          {ROLES.map((r) => {
            const currentModel = roles?.[r.id]?.model ?? "qwen2.5:3b";
            const options = Array.from(
              new Set([currentModel, ...availableModels]),
            );

            return (
              <div
                key={r.id}
                className="flex flex-col gap-2 py-3 first:pt-1 last:pb-1 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-ink">{r.label}</span>
                  <span className="text-xs text-muted">{r.description}</span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label={`Model untuk ${r.label}`}
                    value={currentModel}
                    disabled={savingRole === r.id}
                    onChange={(e) => handleModelChange(r.id, e.target.value)}
                    className={`${FIELD} py-1.5 text-xs cursor-pointer min-w-[180px]`}
                  >
                    {options.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Third Party Providers Note */}
      <div className="rounded-xl border border-line bg-surface p-3.5 text-xs text-muted leading-relaxed">
        <span className="font-medium text-ink">Penyedia eksternal</span>:
        Dukungan penyedia pihak ketiga (OpenRouter, OpenAI, Anthropic, dll.)
        menyusul di fase berikutnya. Saat ini Anchoa berfokus pada model lokal
        Ollama agar seluruh data tetap berada di perangkatmu.
      </div>

      {/* Privacy row: Jurnal hanya ke model lokal */}
      <section aria-labelledby="ai-privacy-heading" className={PANEL}>
        <h2 id="ai-privacy-heading" className={H2}>
          Privasi AI
        </h2>
        <div className="mt-3 flex items-center justify-between gap-4 border-t border-line pt-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-ink">
              Jurnal hanya ke model lokal
            </span>
            <span className="text-xs text-muted leading-normal">
              Tanggapan jurnal selalu diproses oleh Ollama di laptop ini; teks
              jurnal tidak pernah dikirim ke model remote atau server cloud.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted">Terkunci</span>
            <button
              type="button"
              role="switch"
              aria-checked="true"
              aria-disabled="true"
              disabled
              title="Terkunci aktif demi privasi"
              className="relative inline-flex h-6 w-11 shrink-0 cursor-not-allowed items-center rounded-full bg-accent/40 p-1 opacity-80"
            >
              <span
                className="inline-block h-4 w-4 transform rounded-full bg-accent transition-transform translate-x-5"
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
