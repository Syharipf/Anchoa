import { useCallback, useEffect, useRef, useState } from "react";
import { AI_CONFIG_CHANGED, api, errorMessage, type AiProvider, type AiRole, type AiRoles, type AiStatus, type CustomAiConfig, type RoleConfig } from "../api";
import { FIELD, H2, PANEL, SECONDARY } from "../shell/ui";

export interface AiSectionProps { readonly onChanged?: () => void; }

const ROLES = [
  { id: "chat", label: "Percakapan & aksi", description: "Percakapan umum dan usulan aksi" },
  { id: "journal", label: "Tanggapan jurnal", description: "Refleksi jurnal — wajib lokal" },
  { id: "recap", label: "Rekap harian", description: "Belum tersedia — rekap harian belum memiliki pemrosesan AI" },
  { id: "email", label: "Asisten email", description: "Ringkasan, balasan, dan usulan email — wajib lokal" },
] as const;
const PROVIDERS = [
  { id: "ollama", name: "Ollama", kind: "Lokal", active: true },
  { id: "openrouter", name: "OpenRouter", kind: "Belum tersedia", active: false },
  { id: "openai", name: "OpenAI", kind: "Belum tersedia", active: false },
  { id: "anthropic", name: "Anthropic", kind: "Belum tersedia", active: false },
  { id: "custom", name: "Kustom", kind: "Komp. OpenAI", active: true },
] as const;

export function AiSection({ onChanged }: Readonly<AiSectionProps>) {
  const [selected, setSelected] = useState<AiProvider>("ollama");
  const [statuses, setStatuses] = useState<Partial<Record<AiProvider, AiStatus>>>({});
  const [roles, setRoles] = useState<AiRoles | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<AiRole, RoleConfig>>>({});
  const [config, setConfig] = useState<CustomAiConfig | null>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [savingRole, setSavingRole] = useState<AiRole | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const statusGeneration = useRef(0);

  const checkProvider = useCallback(async (provider: AiProvider) => {
    let result: AiStatus;
    try { result = await api.aiProviderStatus(provider); }
    catch (e) { result = { available: false, models: [], error: errorMessage(e) }; }
    return result;
  }, []);

  useEffect(() => {
    let active = true;
    const generation = statusGeneration.current;
    for (const provider of ["ollama", "custom"] as const) {
      void checkProvider(provider).then((result) => {
        if (active && generation === statusGeneration.current) setStatuses((prev) => ({ ...prev, [provider]: result }));
      });
    }
    void api.aiRoles().then((result) => { if (active) setRoles(result); }, (e) => { if (active) setFeedback(errorMessage(e)); });
    void api.aiCustomConfig().then((result) => {
      if (!active) return;
      setConfig(result); setName(result.name); setBaseUrl(result.baseUrl);
    }, (e) => { if (active) setFeedback(errorMessage(e)); });
    return () => { active = false; statusGeneration.current++; };
  }, [checkProvider]);

  const handleTest = async () => {
    const generation = ++statusGeneration.current;
    setTesting(true); setFeedback(null);
    const result = await checkProvider(selected);
    if (generation !== statusGeneration.current) return;
    setStatuses((prev) => ({ ...prev, [selected]: result }));
    setFeedback(result.available ? `Koneksi berhasil: ${result.models.length} model ditemukan` : `Gagal: ${result.error ?? "Penyedia tidak tersedia"}`);
    setTesting(false); onChanged?.();
  };

  const handleConfig = async (operation: "metadata" | "key" | "delete") => {
    setBusy(true); setFeedback(null); statusGeneration.current++; setTesting(false);
    try {
      let result: CustomAiConfig;
      if (operation === "metadata") result = await api.saveAiCustom(name, baseUrl);
      else if (operation === "key") result = await api.setAiCustomKey(key);
      else result = await api.deleteAiCustomKey();
      setConfig(result); setName(result.name); setBaseUrl(result.baseUrl);
      if (operation !== "metadata") setKey("");
      setStatuses((prev) => ({ ...prev, custom: undefined }));
      setFeedback("Konfigurasi tersimpan. Tes koneksi untuk memuat model."); onChanged?.();
      window.dispatchEvent(new CustomEvent(AI_CONFIG_CHANGED, { detail: { reset: operation !== "metadata" || result.baseUrl !== config?.baseUrl } }));
    } catch (e) { setFeedback(`Gagal: ${errorMessage(e)}`); }
    finally { setBusy(false); }
  };

  const saveRole = async (role: AiRole, choice: RoleConfig) => {
    setSavingRole(role); setFeedback(null);
    try {
      const updated = await api.setAiRole(role, choice.provider, choice.model);
      setRoles((prev) => prev ? { ...prev, [role]: updated } : prev);
      setDrafts((prev) => { const next = { ...prev }; delete next[role]; return next; });
      onChanged?.();
      window.dispatchEvent(new CustomEvent(AI_CONFIG_CHANGED, { detail: { reset: role === "chat" } }));
    } catch (e) { setFeedback(`Gagal menyimpan model: ${errorMessage(e)}`); }
    finally { setSavingRole(null); }
  };

  const status = statuses[selected];
  const metadataDirty = name !== config?.name || baseUrl !== config?.baseUrl;
  return <div className="flex flex-col gap-4">
    <section aria-labelledby="ai-provider-heading" className={PANEL}>
      <div role="group" aria-label="Pilih penyedia" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        {PROVIDERS.map((p) => <div key={p.id} className="flex flex-col gap-1">
          <button type="button" disabled={!p.active || busy || testing} aria-pressed={selected === p.id}
            onClick={() => { if (p.id === "ollama" || p.id === "custom") { setSelected(p.id); setFeedback(null); setKey(""); } }}
            className={`${SECONDARY} min-h-[48px] disabled:opacity-50`}>{p.name}</button>
          <span className="text-[11px] text-muted">{p.kind}</span>
        </div>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ai-provider-heading" className={H2}>{selected === "ollama" ? "Ollama (Lokal)" : "Kustom"}</h2>
        <button type="button" className={SECONDARY} onClick={handleTest}
          disabled={testing || busy || (selected === "custom" && (!config || metadataDirty))}>{testing ? "Menguji…" : "Tes koneksi"}</button>
      </div>
      <p className="mt-3 text-xs text-muted" role="status">{status?.available ? `Terhubung · ${status.models.length} model terdeteksi` : status?.error ?? "Belum diuji"}</p>
      {selected === "ollama" ? <div className="mt-3 text-xs text-muted">
        <code>http://127.0.0.1:11434</code>
        {status?.available === false && <p>Jalankan service Ollama: <code>sudo systemctl start ollama</code></p>}
      </div> : <div className="mt-3 flex flex-col gap-3 text-xs">
        <label>Nama penyedia<input aria-label="Nama penyedia" className={FIELD} value={name} disabled={!config || busy || testing} onChange={(e) => setName(e.target.value)} /></label>
        <label>Base URL<input aria-label="Base URL Kustom" className={FIELD} value={baseUrl} disabled={!config || busy || testing} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:20128/v1" /></label>
        <p className="text-muted">HTTPS, atau HTTP hanya untuk localhost, 127.0.0.1, atau ::1. Mengubah URL menghapus key lama dan mereset sesi chat.</p>
        <button type="button" className={SECONDARY} disabled={!config || busy || testing || !name.trim() || !baseUrl.trim()} onClick={() => handleConfig("metadata")}>Simpan metadata</button>
        <span>{config?.hasKey ? "Key tersedia" : "Key tidak tersedia"}</span>
        <label>API key opsional<input aria-label="API key opsional" type="password" autoComplete="new-password" className={FIELD} value={key} disabled={!config || busy || testing} onChange={(e) => setKey(e.target.value)} /></label>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={SECONDARY} disabled={!config || busy || testing || metadataDirty || !key.trim()} onClick={() => handleConfig("key")}>Ganti key</button>
          <button type="button" className={SECONDARY} disabled={!config?.hasKey || busy || testing || metadataDirty} onClick={() => handleConfig("delete")}>Hapus key</button>
        </div>
        <p className="text-muted">Key disimpan di keyring OS, tidak ditampilkan kembali. Server lokal boleh tanpa key. Simpan metadata tidak mengganti role; simpan URL yang sama tidak mengubah key. Perubahan key mereset sesi chat.</p>
        {busy && <span role="status">Menyimpan…</span>}
      </div>}
    </section>
    {feedback && <p role="status" className="rounded-lg border border-line p-3 text-sm">{feedback}</p>}
    <section aria-labelledby="ai-privacy-heading" className={PANEL}>
      <h2 id="ai-privacy-heading" className={H2}>Privasi AI</h2>
      <p className="mt-2 text-xs text-muted">Kustom menerima pesan dan riwayat sesi, nama profil, konteks tugas/tagihan/habit/akun, serta hasil tools yang diizinkan. Data sensitif yang kamu ketik sendiri juga dikirim ke endpoint Kustom, termasuk server remote. Jurnal, email, dan tugas turunan jurnal tidak disertakan otomatis.</p>
      <p className="mt-2 text-xs text-muted">Jurnal dan email hanya ke model lokal Ollama — terkunci. Mengganti provider/model chat mereset riwayat dan usulan pending; tidak ada fallback provider otomatis.</p>
    </section>
    <section aria-labelledby="ai-roles-heading" className={PANEL}>
      <h2 id="ai-roles-heading" className={H2}>Model per tugas</h2>
      {!roles && <p role="status" className="text-xs text-muted">Konfigurasi role belum dimuat.</p>}
      <div className="mt-3 flex flex-col divide-y divide-line">{ROLES.map((r) => {
        const locked = r.id === "journal" || r.id === "email";
        const choice: RoleConfig = drafts[r.id] ?? roles?.[r.id] ?? { provider: "ollama", model: "qwen2.5:3b" };
        const provider = locked ? "ollama" : choice.provider;
        const models = Array.from(new Set([choice.model, ...(statuses[provider]?.models ?? [])])).filter(Boolean);
        const disabled = r.id === "recap" || !roles || savingRole !== null || busy;
        return <div key={r.id} className="flex flex-col gap-2 py-3">
          <span className="text-sm font-medium">{r.label}</span><span className="text-xs text-muted">{r.description}</span>
          <div className="flex flex-wrap gap-2">
            <select aria-label={`Penyedia untuk ${r.label}`} className={FIELD} value={provider} disabled={locked || disabled}
              onChange={(e) => {
                const next = e.target.value as AiProvider;
                setDrafts((prev) => ({ ...prev, [r.id]: { provider: next, model: roles?.[r.id].provider === next ? roles[r.id].model : statuses[next]?.models[0] ?? "" } }));
              }}><option value="ollama">Ollama</option>{!locked && <option value="custom">Kustom</option>}</select>
            <select aria-label={`Model untuk ${r.label}`} className={FIELD} value={choice.model} disabled={disabled}
              onChange={(e) => {
                const updated = { provider, model: e.target.value };
                if (provider === "ollama" && !drafts[r.id]) void saveRole(r.id, updated);
                else setDrafts((prev) => ({ ...prev, [r.id]: updated }));
              }}>{!choice.model && <option value="">Pilih model</option>}{models.map((model) => <option key={model} value={model}>{model}</option>)}</select>
            {provider === "custom" && <input aria-label={`ID model untuk ${r.label}`} className={FIELD} value={choice.model} placeholder="ID model manual" disabled={disabled}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [r.id]: { provider, model: e.target.value } }))} />}
            {(provider === "custom" || drafts[r.id]) && <button type="button" className={SECONDARY} disabled={disabled || !choice.model.trim()}
              onClick={() => saveRole(r.id, { provider, model: choice.model.trim() })}>{`Simpan model ${r.label}`}</button>}
          </div>
        </div>;
      })}</div>
    </section>
  </div>;
}
