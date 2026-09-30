import { useState, type FormEvent } from "react";
import { api, type ProjectDetail, type ProjectKind } from "../api";
import { dateInputToMs, msToDateInput } from "../format";
import { Dialog, DialogActions, Field } from "../shell/Dialog";
import { FIELD } from "../shell/ui";
import { Segmented } from "../finance/fields";
import { useSave } from "../finance/useSave";
import { KIND_LABELS } from "./view";

const KIND_OPTIONS: readonly { value: ProjectKind; label: string }[] = (
  Object.entries(KIND_LABELS) as [ProjectKind, string][]
).map(([value, label]) => ({ value, label }));

export function ProjectForm({
  edit,
  onClose,
  onSaved,
}: Readonly<{
  edit?: ProjectDetail | null;
  onClose: () => void;
  onSaved: () => void;
}>) {
  const [name, setName] = useState(edit?.name ?? "");
  const [kind, setKind] = useState<ProjectKind>(edit?.kind ?? "app");
  const [deadline, setDeadline] = useState(msToDateInput(edit?.deadlineAt ?? null));
  const [repoUrl, setRepoUrl] = useState(edit?.repoUrl ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  const { busy, run, toast } = useSave(onSaved);

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast("Nama proyek tidak boleh kosong", "error");
      return;
    }
    const deadlineAt = dateInputToMs(deadline);
    const repo = repoUrl.trim() === "" ? null : repoUrl.trim();
    void run(() =>
      api.saveProject({
        id: edit?.id,
        name: trimmedName,
        kind,
        deadlineAt,
        repoUrl: repo,
        description: description.trim(),
      }),
    );
  }

  const remove = edit ? () => void run(() => api.deleteProject(edit.id)) : undefined;

  return (
    <Dialog title={edit ? "Ubah proyek" : "Proyek baru"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Nama">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama proyek…"
            className={FIELD}
          />
        </Field>
        <Field label="Jenis">
          <Segmented
            label="Jenis proyek"
            options={KIND_OPTIONS}
            value={kind}
            onChange={setKind}
          />
        </Field>
        <Field label="Tenggat (opsional)">
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className={FIELD}
          />
        </Field>
        <Field label="URL Repo GitHub (opsional)">
          <input
            type="url"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/pemilik/repo"
            className={FIELD}
          />
        </Field>
        <Field label="Deskripsi">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Deskripsi singkat proyek…"
            className={`${FIELD} resize-none`}
          />
        </Field>
        {edit && <p className="m-0 text-xs text-muted">Tugasnya pindah ke Tugas lepas</p>}
        <DialogActions
          busy={busy}
          onCancel={onClose}
          onDelete={remove}
          deleteLabel="Hapus proyek"
        />
      </form>
    </Dialog>
  );
}
