import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../shell/toast";
import { PRIMARY, SECONDARY } from "../shell/ui";

const FULLSTACK_PRD_TEMPLATE = `# Fullstack PRD & Architecture

## 1. Product Goals & Feature Summary
- **Primary Goal:** [Explain what this project/feature aims to achieve]
- **Target Users:** [Desktop user / Developer / Internal team]
- **Scope:** [Covered modules and non-goals]

## 2. Tech Stack & Dependencies
- **Frontend Client:** React 19 + TypeScript + Tailwind CSS (Vite)
- **Backend / Engine:** Tauri 2 (Rust) + Tokio async runtime
- **Database / Storage:** SQLite (rusqlite) with WAL mode & FTS5
- **Security & Authentication:** Argon2id key derivation, secure session tokens, CSP
- **Communication Protocols:** Tauri IPC commands, stdio PTY stream

## 3. System Architecture & Data Models
- **Table Structure:**
  - \`items\` (id UUIDv7, type, title, body, created_at, updated_at)
  - Extension tables keyed by \`item_id\`
- **Data Flow:**
  - UI calls \`api.ts\` -> Rust Command -> rusqlite -> returns Result<T, AppError>

## 4. API Contract / Rust Commands
- \`auth_request(credentials)\` -> \`Result<Session, AppError>\`
- \`verify_status(id)\` -> \`Result<Status, AppError>\`

## 5. Business Logic & Process Flow
1. [User initiation step]
2. [Business validation & backend authorization]
3. [Atomic database persistence & event broadcast]

## 6. Definition of Done & Acceptance Criteria
- [ ] Database schema & migrations tested
- [ ] Backend unit tests (\`cargo test\`) pass 100%
- [ ] Frontend unit tests (\`bun test\`) pass 100%
- [ ] Headless E2E smoke test in Xvfb
`;

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
      toast("PRD saved to .anchoa/prd.md");
      setEditing(false);
      onSaved?.(content);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  function handleApplyTemplate() {
    if (content.trim() && !confirm("Replace content with Fullstack PRD & Architecture template?")) {
      return;
    }
    setContent(FULLSTACK_PRD_TEMPLATE);
    setEditing(true);
  }

  return (
    <div className="flex min-h-[560px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <div className="flex flex-wrap items-center justify-between border-b border-line bg-surface-2 px-5 py-3.5 gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-accent">.anchoa/prd.md</span>
          <span className="text-[11px] text-muted">· Specification &amp; Architecture</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleApplyTemplate}
            className="rounded-lg border border-line bg-stage px-2.5 py-1 text-xs text-muted hover:text-ink transition-colors"
            title="Use standard fullstack PRD & architecture document structure"
          >
            + Fullstack Template
          </button>
          {editing ? (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className={`${SECONDARY} py-1 text-xs`}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={`${SECONDARY} py-1 text-xs`}
            >
              Edit Spec
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {editing ? (
          <form onSubmit={handleSave} className="flex h-full flex-col gap-3.5">
            <textarea
              aria-label="PRD document content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write PRD specifications and architecture..."
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="submit"
                disabled={saving}
                className={`${PRIMARY} py-1.5 px-4 text-xs font-semibold`}
              >
                {saving ? "Saving…" : "Save PRD Changes"}
              </button>
            </div>
          </form>
        ) : (
          <div className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ink">
            {content.trim() || (
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted gap-3">
                <p className="text-sm">No PRD document in .anchoa/prd.md yet.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleApplyTemplate}
                    className={`${PRIMARY} py-1.5 px-3 text-xs`}
                  >
                    Use Fullstack Template
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className={`${SECONDARY} py-1.5 px-3 text-xs`}
                  >
                    Write Manually
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
