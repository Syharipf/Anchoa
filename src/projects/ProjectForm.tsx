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
  onSaved: (id?: string) => void;
}>) {
  const [name, setName] = useState(edit?.name ?? "");
  const [kind, setKind] = useState<ProjectKind>(edit?.kind ?? "app");
  const [deadline, setDeadline] = useState(msToDateInput(edit?.deadlineAt ?? null));
  const [repoUrl, setRepoUrl] = useState(edit?.repoUrl ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  const [agent, setAgent] = useState(edit?.agent ?? false);
  const [agentDir, setAgentDir] = useState(edit?.agentDir ?? "");
  const [agentCommand, setAgentCommand] = useState(edit?.agentCommand ?? "");
  const { busy, run, toast } = useSave(() => {});

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast("Nama proyek tidak boleh kosong", "error");
      return;
    }
    const deadlineAt = dateInputToMs(deadline);
    const repo = repoUrl.trim() === "" ? null : repoUrl.trim();
    void run(async () => {
      const saved = await api.saveProject({
        id: edit?.id,
        name: trimmedName,
        kind,
        deadlineAt,
        repoUrl: repo,
        description: description.trim(),
        agent,
        agentCommand: agentCommand.trim() || null,
        agentDir: agentDir.trim() || null,
      });
      onSaved(saved.id);
    });
  }

  const remove = edit
    ? () =>
        void run(async () => {
          await api.deleteProject(edit.id);
          onSaved();
        })
    : undefined;

  return (
    <Dialog title={edit ? "Ubah proyek" : "Proyek baru"} onClose={onClose}>
      <form onSubmit={submit} className="flex max-h-[calc(100vh-220px)] flex-col gap-3 overflow-y-auto">
        <Field label="Nama">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama proyek…"
            className={FIELD}
          />
        </Field>
        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-line p-3">
          <span className="text-sm text-ink">Proyek agen</span>
          <button
            type="button"
            role="switch"
            aria-label="Proyek agen"
            aria-checked={agent}
            disabled={busy}
            onClick={() => setAgent((value) => !value)}
            className={`flex h-[22px] w-10 shrink-0 items-center rounded-full px-[3px] transition-colors ${agent ? "bg-accent" : "bg-disabled"}`}
          >
            <span className={`h-4 w-4 rounded-full bg-canvas transition-transform ${agent ? "translate-x-[18px]" : ""}`} />
          </button>
        </div>
        {agent && (
          <>
            <Field label="Folder repo">
              <input
                value={agentDir}
                onChange={(e) => setAgentDir(e.target.value)}
                placeholder="/home/kamu/Proyek/repo"
                aria-describedby="agent-dir-help"
                className={FIELD}
              />
              <span id="agent-dir-help">Folder yang sudah ada di dalam direktori home.</span>
            </Field>
            <Field label="Perintah agen (opsional)">
              <input
                value={agentCommand}
                onChange={(e) => setAgentCommand(e.target.value)}
                placeholder={'claude -p "$ANCHOA_REQUEST"'}
                className={`${FIELD} font-mono`}
              />
              <span>Tanpa perintah, permintaan menunggu di Rencana.</span>
            </Field>
          </>
        )}
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
