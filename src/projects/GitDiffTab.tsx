import { useEffect, useState } from "react";
import { api, errorMessage, type GitChanges } from "../api";
import { useToast } from "../shell/toast";
import { SECONDARY } from "../shell/ui";

export function GitDiffTab({
  projectId,
}: Readonly<{
  projectId: string;
}>) {
  const toast = useToast();
  const [diff, setDiff] = useState<GitChanges | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await api.projectGitDiff(projectId);
      setDiff(data);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    api.projectGitDiff(projectId).then(
      (data) => {
        if (active) {
          setDiff(data);
          setLoading(false);
        }
      },
      (err) => {
        if (active) {
          toast(errorMessage(err), "error");
          setLoading(false);
        }
      }
    );
    return () => {
      active = false;
    };
  }, [projectId, toast]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line bg-surface-2 px-3.5 py-2">
        <div className="flex items-center gap-2">
          <span className="font-display text-xs font-semibold text-ink">
            Status Perubahan Git
          </span>
          {diff?.branch && (
            <span className="font-mono text-xs text-accent">({diff.branch})</span>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className={`${SECONDARY} py-1 text-xs`}
        >
          {loading ? "Memuat…" : "Segarkan"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-xs text-muted">Memeriksa status git lokal…</p>
        ) : !diff || diff.files.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-accent mb-2"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <p className="text-xs font-medium text-ink">Working tree bersih</p>
            <p className="mt-1 text-[11px]">Tidak ada perubahan file yang belum di-commit.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 font-mono text-xs">
            {diff.files.map((file) => {
              const isAdded = file.status === "A" || file.status === "??";
              const isDeleted = file.status === "D";
              return (
                <div
                  key={file.path}
                  className="flex items-center gap-2.5 rounded-md border border-line bg-surface-2 px-3 py-2"
                >
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      isDeleted
                        ? "bg-[#2A1A1A] text-danger"
                        : isAdded
                        ? "bg-[#1E2A12] text-accent"
                        : "bg-[#2A2412] text-warn"
                    }`}
                  >
                    {file.status}
                  </span>
                  <span className="truncate text-ink">{file.path}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
