import { useState } from "react";
import type { ConvertFormat, FileEntry } from "../api";
import { Dialog } from "../shell/Dialog";
import { convertedName, fileExtension, joinPath, parentPath, targetsFor } from "./view";

/** One-file format conversion; targets come from the backend capabilities. */
export function ConvertDialog({
  entry,
  formats,
  takenNames,
  busy,
  onConfirm,
  onCancel,
}: Readonly<{
  entry: FileEntry;
  formats: readonly ConvertFormat[];
  takenNames: readonly string[];
  busy: boolean;
  onConfirm: (target: string) => void;
  onCancel: () => void;
}>) {
  const targets = targetsFor(entry.name, formats);
  const [target, setTarget] = useState(targets[0] ?? "");
  const sourceExt = fileExtension(entry.name);
  const output = target
    ? joinPath(parentPath(entry.path), convertedName(entry.name, target, takenNames))
    : "";
  const submit = busy || !target;

  return (
    <Dialog title="Konversi Berkas" onClose={busy ? () => {} : onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!submit) onConfirm(target);
        }}
        className="flex flex-col gap-3"
      >
        <span className="truncate text-xs text-muted">Sumber: {entry.name}</span>
        <div className="flex items-center gap-2">
          <label htmlFor="convert-target" className="text-xs text-muted">
            Format tujuan
          </label>
          <select
            id="convert-target"
            aria-label="Format tujuan konversi"
            value={target}
            disabled={busy || targets.length === 0}
            onChange={(e) => setTarget(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2 py-2 text-xs text-ink focus:border-field-focus focus:outline-none"
          >
            {targets.map((value) => (
              <option key={value} value={value}>
                {value.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        {targets.length === 0 ? (
          <span role="alert" className="text-xs text-danger">
            Tidak ada format tujuan untuk berkas ini.
          </span>
        ) : (
          <>
            <span className="truncate font-mono text-[11px] text-muted">{output}</span>
            <span className="text-[11px] text-muted">
              Tidak menimpa berkas yang sudah ada; nama baru memakai akhiran (2).
            </span>
            {sourceExt === "pdf" && (
              <span className="text-[11px] text-muted">Hanya halaman pertama.</span>
            )}
            {(sourceExt === "gif" || sourceExt === "webp") && (
              <span className="text-[11px] text-muted">GIF animasi: hanya bingkai pertama.</span>
            )}
          </>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-xs text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={submit}
            className="flex h-8 items-center rounded-lg bg-accent px-3.5 text-xs font-semibold text-canvas transition-colors hover:brightness-105 disabled:bg-disabled disabled:text-muted"
          >
            {busy ? "Mengonversi…" : "Konversi"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
