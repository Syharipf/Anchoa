import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../shell/toast";
import { FIELD, PRIMARY, SECONDARY } from "../shell/ui";

export function PrdEditor({
  projectId,
  initialContent,
  onSaved,
}: Readonly<{
  projectId: string;
  initialContent: string | null;
  onSaved?: (content: string) => void;
}>) {
  const toast = useToast();
  const [content, setContent] = useState(initialContent ?? "");
  const [editing, setEditing] = useState(initialContent === null);
  const [saving, setSaving] = useState(false);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await api.projectSavePrd(projectId, content);
      toast("PRD berhasil disimpan ke .anchoa/prd.md");
      setEditing(false);
      onSaved?.(content);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[10px] border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line bg-surface-2 px-3.5 py-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-accent">.anchoa/prd.md</span>
          <span className="text-[11px] text-muted">· Git Tracked</span>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={`${SECONDARY} py-1 text-xs`}
            >
              Batal
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={`${SECONDARY} py-1 text-xs`}
            >
              Ubah Spec
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {editing ? (
          <form onSubmit={handleSave} className="flex h-full flex-col gap-3">
            <textarea
              aria-label="Isi dokumen PRD"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="# PRD: Nama Fitur&#10;&#10;## 1. Sasaran&#10;...&#10;&#10;## 2. Aturan Bisnis&#10;...&#10;&#10;## 3. Kriteria Selesai&#10;..."
              className={`${FIELD} flex-1 font-mono text-xs leading-relaxed resize-none`}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="submit"
                disabled={saving}
                className={`${PRIMARY} py-1 text-xs`}
              >
                {saving ? "Menyimpan…" : "Simpan Perubahan"}
              </button>
            </div>
          </form>
        ) : (
          <div className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink">
            {content.trim() || (
              <span className="text-muted italic">
                Belum ada dokumen PRD. Klik "Ubah Spec" untuk mulai menulis spesifikasi fitur.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
