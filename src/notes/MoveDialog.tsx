import { useState, type JSX } from "react";
import type { PageNode } from "../api";
import { Dialog } from "../shell/Dialog";
import { PRIMARY, SECONDARY } from "../shell/ui";
import { descendantIds } from "./view";

export function MoveDialog({
  nodes,
  page,
  onClose,
  onMove,
}: Readonly<{
  nodes: readonly PageNode[];
  page: PageNode;
  onClose: () => void;
  onMove: (targetParentId: string | null) => Promise<void>;
}>): JSX.Element {
  const [selectedTarget, setSelectedTarget] = useState<string | null>(page.parentId);
  const [busy, setBusy] = useState(false);

  const blocked = descendantIds(nodes, page.id);
  const validTargets = nodes.filter(
    (n) => n.id !== page.id && !blocked.has(n.id),
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onMove(selectedTarget);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Pindahkan "${page.title}"`} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-xs text-muted">
          Pilih halaman tujuan
          <select
            value={selectedTarget ?? ""}
            onChange={(e) => setSelectedTarget(e.target.value === "" ? null : e.target.value)}
            className="rounded-[10px] border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-field-focus"
          >
            <option value="">Akar (tanpa induk)</option>
            {validTargets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.title}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-2 flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className={SECONDARY}>
            Batal
          </button>
          <button type="submit" disabled={busy} className={PRIMARY}>
            {busy ? "Memindahkan…" : "Pindahkan"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
