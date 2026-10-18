import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../shell/toast";
import { FIELD, PRIMARY, SECONDARY } from "../shell/ui";

const FULLSTACK_PRD_TEMPLATE = `# PRD & Arsitektur Fullstack

## 1. Sasaran Produk & Ringkasan Fitur
- **Tujuan Utama:** [Jelaskan apa yang ingin dicapai proyek/fitur ini]
- **Target Pengguna:** [Desktop user / Developer / Tim internal]
- **Ruang Lingkup:** [Modul yang tercakup dan non-goals]

## 2. Tech Stack & Dependensi
- **Frontend Client:** React 19 + TypeScript + Tailwind CSS (Vite)
- **Backend / Engine:** Tauri 2 (Rust) + Tokio async runtime
- **Database / Storage:** SQLite (rusqlite) dengan WAL mode & FTS5
- **Keamanan & Autentikasi:** Argon2id key derivation, secure session tokens, CSP
- **Protokol Komunikasi:** Tauri IPC commands, stdio PTY stream

## 3. Arsitektur Sistem & Model Data
- **Struktur Tabel:**
  - \`items\` (id UUIDv7, type, title, body, created_at, updated_at)
  - Extension tables keyed by \`item_id\`
- **Aliran Data (Data Flow):**
  - UI memanggil \`api.ts\` -> Rust Command -> rusqlite -> return Result<T, AppError>

## 4. Kontrak API / Rust Commands
- \`auth_request(credentials)\` -> \`Result<Session, AppError>\`
- \`verify_status(id)\` -> \`Result<Status, AppError>\`

## 5. Alur & Logika Proses Bisnis
1. [Langkah inisiasi pengguna]
2. [Validasi bisnis & otorisasi backend]
3. [Penyimpanan atomik database & broadcast event]

## 6. Kriteria Selesai & Pengujian (Acceptance Criteria)
- [ ] Skema database & migrasi teruji
- [ ] Unit tests backend (\`cargo test\`) lolos 100%
- [ ] Unit tests frontend (\`bun test\`) lolos 100%
- [ ] E2E smoke test headless di Xvfb
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
      toast("PRD berhasil disimpan ke .anchoa/prd.md");
      setEditing(false);
      onSaved?.(content);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setSaving(false);
    }
  }

  function handleApplyTemplate() {
    if (content.trim() && !confirm("Ganti konten dengan template PRD & Arsitektur Fullstack?")) {
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
          <span className="text-[11px] text-muted">· Spesifikasi &amp; Arsitektur</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleApplyTemplate}
            className="rounded-lg border border-line bg-stage px-2.5 py-1 text-xs text-muted hover:text-ink transition-colors"
            title="Gunakan struktur dokumen PRD & arsitektur fullstack standar"
          >
            + Template Fullstack
          </button>
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

      <div className="flex-1 overflow-y-auto p-5">
        {editing ? (
          <form onSubmit={handleSave} className="flex h-full flex-col gap-3.5">
            <textarea
              aria-label="Isi dokumen PRD"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Tuliskan spesifikasi PRD dan arsitektur..."
              className={`${FIELD} min-h-[460px] flex-1 font-mono text-[13px] leading-relaxed resize-y p-4`}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="submit"
                disabled={saving}
                className={`${PRIMARY} py-1.5 px-4 text-xs font-semibold`}
              >
                {saving ? "Menyimpan…" : "Simpan Perubahan PRD"}
              </button>
            </div>
          </form>
        ) : (
          <div className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-ink">
            {content.trim() || (
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted gap-3">
                <p className="text-sm">Belum ada dokumen PRD di .anchoa/prd.md.</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleApplyTemplate}
                    className={`${PRIMARY} py-1.5 px-3 text-xs`}
                  >
                    Gunakan Template Fullstack
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className={`${SECONDARY} py-1.5 px-3 text-xs`}
                  >
                    Tulis Manual
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
