import { useState, type FormEvent } from "react";
import { api, type ProjectDetail, type ProjectKind } from "../api";
import { dateInputToMs, msToDateInput } from "../format";
import { FolderPicker } from "../files/FolderPicker";
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
  const [pickingDir, setPickingDir] = useState(false);
  const [agentCommand, setAgentCommand] = useState(edit?.agentCommand ?? "");
  const { busy, run, toast } = useSave(() => {});

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast("Project name cannot be empty", "error");
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
    <Dialog title={edit ? "Edit project" : "New project"} onClose={onClose}>
      <form onSubmit={submit} className="flex max-h-[calc(100vh-220px)] flex-col gap-3 overflow-y-auto">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name…"
            className={FIELD}
          />
        </Field>
        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-line p-3">
          <span className="text-sm text-ink">Agent project</span>
          <button
            type="button"
            role="switch"
            aria-label="Agent project"
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
            <Field label="Repo folder">
              <div className="flex items-center gap-2">
                <input
                  value={agentDir}
                  onChange={(e) => setAgentDir(e.target.value)}
                  placeholder="/home/user/Projects/repo"
                  aria-describedby="agent-dir-help"
                  className={FIELD}
                />
                <button
                  type="button"
                  onClick={() => setPickingDir(true)}
                  disabled={busy}
                  className="shrink-0 whitespace-nowrap rounded-lg border border-line px-2.5 py-2 text-xs text-ink transition-colors hover:bg-surface-2 disabled:opacity-50"
                >
                  Choose…
                </button>
              </div>
              <span id="agent-dir-help">Existing folder inside home directory.</span>
              {pickingDir && (
                <FolderPicker
                  initialPath={agentDir}
                  onSelect={setAgentDir}
                  onClose={() => setPickingDir(false)}
                />
              )}
            </Field>
            <Field label="Agent command (optional)">
              <input
                value={agentCommand}
                onChange={(e) => setAgentCommand(e.target.value)}
                placeholder={'claude -p "$ANCHOA_REQUEST"'}
                className={`${FIELD} font-mono`}
              />
              <span>Without a command, requests wait in Plan.</span>
            </Field>
          </>
        )}
        <Field label="Kind">
          <Segmented
            label="Project kind"
            options={KIND_OPTIONS}
            value={kind}
            onChange={setKind}
          />
        </Field>
        <Field label="Due date (optional)">
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className={FIELD}
          />
        </Field>
        <Field label="GitHub Repo URL (optional)">
          <input
            type="url"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="https://github.com/owner/repo"
            className={FIELD}
          />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Brief project description…"
            className={`${FIELD} resize-none`}
          />
        </Field>
        {edit && <p className="m-0 text-xs text-muted">Tasks will move to Loose tasks</p>}
        <DialogActions
          busy={busy}
          onCancel={onClose}
          onDelete={remove}
          deleteLabel="Delete project"
        />
      </form>
    </Dialog>
  );
}
