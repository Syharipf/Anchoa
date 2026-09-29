import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage, type Item, type ItemPatch } from "../api";
import { dateInputToMs, msToDateInput } from "../format";
import { useToast } from "../shell/toast";

type SaveState = "idle" | "saving" | "saved" | "failed";
const SAVE_LABEL: Record<SaveState, string> = {
  idle: "",
  saving: "Menyimpan…",
  saved: "Tersimpan",
  failed: "Gagal menyimpan",
};
const AUTOSAVE_MS = 500;

export function ItemPage({ id, onBack }: { id: string; onBack: () => void }) {
  const toast = useToast();
  const [item, setItem] = useState<Item | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pending = useRef<ItemPatch>({});
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    api.openItem(id).then(setItem, (e) => setLoadError(errorMessage(e)));
  }, [id]);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    pending.current = {};
    setSave("saving");
    try {
      await api.updateItem(id, patch);
      setSave("saved");
    } catch {
      // Keep the edit (newer edits win) so the next change retries it.
      pending.current = { ...patch, ...pending.current };
      setSave("failed");
    }
  }, [id]);

  // Save anything still pending when the page closes.
  useEffect(() => () => void flush(), [flush]);

  function change(patch: ItemPatch) {
    setItem((current) => (current ? { ...current, ...patch } : current));
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  }

  async function remove() {
    window.clearTimeout(timer.current);
    pending.current = {};
    try {
      await api.deleteItem(id);
      onBack();
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-start gap-4">
        <p>{loadError}</p>
        <button onClick={onBack} className="text-sm text-violet-600">
          ← Kembali
        </button>
      </div>
    );
  }
  if (!item) return null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-3 text-sm">
        <button onClick={onBack} className="text-violet-600">
          ← Kembali
        </button>
        <span aria-live="polite" className={`ml-auto ${save === "failed" ? "text-red-600" : "text-neutral-500"}`}>
          {SAVE_LABEL[save]}
        </span>
        {confirmDelete ? (
          <>
            <span>Hapus item ini?</span>
            <button onClick={() => void remove()} className="rounded bg-red-600 px-2 py-1 text-white">
              Ya, hapus
            </button>
            <button onClick={() => setConfirmDelete(false)}>Batal</button>
          </>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="text-red-600">
            Hapus
          </button>
        )}
      </div>

      <input
        value={item.title}
        onChange={(e) => change({ title: e.target.value })}
        onBlur={() => void flush()}
        placeholder="Tanpa judul"
        aria-label="Judul"
        className="bg-transparent text-2xl font-bold outline-none"
      />

      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="due">Jatuh tempo</label>
        <input
          id="due"
          type="date"
          value={msToDateInput(item.dueAt)}
          onChange={(e) => change({ dueAt: dateInputToMs(e.target.value) })}
          onBlur={() => void flush()}
          // WebKit shows today's date in an empty date input; grey it out so it does not look set.
          className={`rounded border border-neutral-300 bg-transparent px-2 py-1 dark:border-neutral-700 ${
            item.dueAt === null ? "text-neutral-400" : ""
          }`}
        />
        {item.dueAt !== null && (
          <button onClick={() => change({ dueAt: null })} className="text-neutral-500">
            Hapus tanggal
          </button>
        )}
      </div>

      <textarea
        value={item.body}
        onChange={(e) => change({ body: e.target.value })}
        onBlur={() => void flush()}
        placeholder="Tulis dalam Markdown…"
        aria-label="Isi"
        className="min-h-[50vh] resize-none rounded-lg border border-neutral-200 bg-transparent p-4 font-mono text-sm outline-none focus:border-violet-500 dark:border-neutral-800"
      />
    </div>
  );
}
