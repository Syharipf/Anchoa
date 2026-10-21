import type { OnConflict } from "../api";
import { Dialog } from "../shell/Dialog";
import { SECONDARY } from "../shell/ui";

const CHOICES: readonly {
  readonly choice: OnConflict;
  readonly label: string;
  readonly desc: string;
}[] = [
  {
    choice: "replace",
    label: "Replace",
    desc: "Overwrite files in destination folder",
  },
  {
    choice: "skip",
    label: "Skip",
    desc: "Do not copy conflicting files",
  },
  {
    choice: "rename",
    label: "Save with new name",
    desc: "Auto-append number suffix (e.g. name (2).ext)",
  },
];

export function ConflictDialog({
  conflictCount,
  onResolve,
  onCancel,
}: Readonly<{
  conflictCount: number;
  onResolve: (choice: OnConflict) => void;
  onCancel: () => void;
}>) {
  return (
    <Dialog
      title={`${conflictCount} name(s) already exist in this folder`}
      onClose={onCancel}
    >
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="sr-only">Conflict resolution choice</legend>
        {CHOICES.map((c) => (
          <button
            key={c.choice}
            type="button"
            onClick={() => onResolve(c.choice)}
            className="flex flex-col items-start gap-1 rounded-xl border border-line bg-surface-2 p-3 text-left transition-colors hover:border-accent hover:bg-surface"
          >
            <span className="text-sm font-semibold text-ink">{c.label}</span>
            <span className="text-xs text-muted">{c.desc}</span>
          </button>
        ))}
      </fieldset>
      <div className="mt-2 flex justify-end">
        <button type="button" onClick={onCancel} className={SECONDARY}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}
