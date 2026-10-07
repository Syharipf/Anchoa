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
  const [loadingModels, setLoadingModels] = useState(false);
  const [draftModels, setDraftModels] = useState<string[] | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<AiRole | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const statusGeneration = useRef(0);
  const modelsGeneration = useRef(0);

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

  /** Discards a model list fetched for a URL/key that the user just edited. */
  const invalidateModels = () => { modelsGeneration.current++; setDraftModels(null); setModelError(null); };

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
      invalidateModels();
      setFeedback("Konfigurasi tersimpan. Muat model untuk melihat daftar model.");
      onChanged?.();
      window.dispatchEvent(new CustomEvent(AI_CONFIG_CHANGED, { detail: { reset: operation !== "metadata" || result.baseUrl !== config?.baseUrl } }));
    } catch (e) { setFeedback(`Gagal: ${errorMessage(e)}`); }
    finally { setBusy(false); }
  };

  /** Fetches the provider model list for the URL/key in the form; nothing is saved. */
  const handleLoadModels = async () => {
    const generation = ++modelsGeneration.current;
    setLoadingModels(true); setModelError(null); setFeedback(null);
    try {
      const models = await api.aiCustomModels(baseUrl.trim(), key.trim());
      if (generation !== modelsGeneration.current) return;
      setDraftModels(models);
      setFeedback(models.length ? `${models.length} model ditemukan. Pilih model di "Model per tugas".` : "Penyedia tidak mengembalikan model apa pun.");
    } catch (e) {
      if (generation !== modelsGeneration.current) return;
      setDraftModels(null); setModelError(errorMessage(e));
    } finally {
      if (generation === modelsGeneration.current) setLoadingModels(false);
    }
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
  const localModels = statuses.ollama?.models ?? [];
  const customModels = draftModels ?? statuses.custom?.models ?? [];
  const modelSource = selected === "ollama" ? "Sumber: Ollama di perangkat" : "Sumber: penyedia Kustom";
  const lockedField = busy || testing || loadingModels;

  return <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_288px]">
    <div className="flex min-w-0 flex-col gap-3.5">
      <section aria-labelledby="ai-providers-heading" className={PANEL}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="ai-providers-heading" className={H2}>Penyedia AI</h2>
          <span className="text-xs text-muted">Dipakai untuk perintah suara, ringkasan, dan tanggapan jurnal</span>
        </div>
        <div role="group" aria-label="Pilih penyedia" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {PROVIDERS.map((p) => <button key={p.id} type="button" disabled={!p.active || lockedField} aria-pressed={selected === p.id}
            onClick={() => { if (p.id === "ollama" || p.id === "custom") { setSelected(p.id); setFeedback(null); setKey(""); } }}
            className={`flex min-h-[64px] flex-col items-start justify-center gap-1 rounded-[10px] px-2.5 py-2 text-left ${SECONDARY} disabled:opacity-50`}>
            <span className="flex items-center gap-1.5 text-[13px] font-medium">{p.name}</span>
            <span className="text-[11px] text-muted">{p.kind}</span>
          </button>)}
        </div>

        {selected === "ollama" ? <div className="mt-4 flex flex-col gap-2 text-xs text-muted">
          <p>Ollama berjalan lokal di <code className="font-mono">http://127.0.0.1:11434</code> dan tidak memakai API key.</p>
          {status?.available === false && <p>Jalankan service Ollama: <code className="font-mono">sudo systemctl start ollama</code></p>}
        </div> : <div className="mt-4 flex flex-col gap-3 text-xs">
          <label className="flex flex-col gap-1">Nama penyedia<input aria-label="Nama penyedia" className={FIELD} value={name} disabled={!config || lockedField} onChange={(e) => setName(e.target.value)} /></label>
          <label className="flex flex-col gap-1">Base URL<input aria-label="Base URL Kustom" className={FIELD} value={baseUrl} disabled={!config || lockedField}
            onChange={(e) => { setBaseUrl(e.target.value); invalidateModels(); }} placeholder="http://127.0.0.1:20128/v1" /></label>
          <p className="text-muted">HTTPS, atau HTTP hanya untuk localhost, 127.0.0.1, atau ::1. Mengubah URL menghapus key lama dan mereset sesi chat.</p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={SECONDARY} disabled={!config || lockedField || !name.trim() || !baseUrl.trim()} onClick={() => handleConfig("metadata")}>Simpan metadata</button>
            <span className="text-muted">{config?.hasKey ? "Key tersedia" : "Key tidak tersedia"}</span>
          </div>
          <label className="flex flex-col gap-1">API key opsional<input aria-label="API key opsional" type="password" autoComplete="new-password" className={FIELD} value={key}
            disabled={!config || lockedField} onChange={(e) => { setKey(e.target.value); invalidateModels(); }} /></label>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Model dari penyedia" className="flex min-w-[200px] flex-1 rounded-[6px] border border-line bg-surface p-2 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" value=""
              onChange={(e) => {
                if (!e.target.value) return;
                void saveRole("chat", { provider: "custom", model: e.target.value });
              }}>
              <option value="">{draftModels?.length ? `${draftModels.length} model tersedia` : "Muat model dari penyedia"}</option>
              {customModels.map((model) => <option key={model} value={model}>{model}</option>)}
            </select>
            <button type="button" className={SECONDARY} disabled={!config || lockedField || !baseUrl.trim() || !key.trim()} onClick={handleLoadModels}>
              {loadingModels ? "Memuat…" : "Muat model"}
            </button>
            <button type="button" className={SECONDARY} onClick={handleTest} disabled={testing || busy || loadingModels || !config || metadataDirty}>
              {testing ? "Menguji…" : "Tes koneksi"}
            </button>
            <button type="button" className={SECONDARY} disabled={!config || lockedField || metadataDirty || !key.trim()} onClick={() => handleConfig("key")}>Ganti key</button>
            <button type="button" className={SECONDARY} disabled={!config?.hasKey || lockedField || metadataDirty} onClick={() => handleConfig("delete")}>Hapus key</button>
          </div>
          {loadingModels && <span role="status" className="text-muted">Mengambil daftar model dari penyedia…</span>}
          {modelError && <p role="alert" className="text-danger">Gagal memuat model: {modelError}</p>}
          {feedback && <p role="status" className="rounded-[10px] border border-line bg-surface-2 px-3 py-2">{feedback}</p>}
          <p className="text-muted">Key disimpan di keyring OS, tidak ditampilkan kembali, dan tidak ikut ke log. Server lokal boleh tanpa key. "Muat model" hanya membaca {draftModels ? "server" : "alamat"} — URL dan key tetap perlu disimpan lewat "Simpan metadata" dan "Ganti key". Perubahan key mereset sesi chat.</p>
          {busy && <span role="status">Menyimpan…</span>}
        </div>}

        {selected === "ollama" && <div className="mt-4 flex flex-col gap-2">
          <button type="button" className={`${SECONDARY} self-start`} onClick={handleTest} disabled={testing || busy || loadingModels}>
            {testing ? "Menguji…" : "Tes koneksi"}
          </button>
          <p role="status" className="text-xs text-muted">{status?.available ? `Terhubung · ${status.models.length} model terdeteksi` : status?.error ?? "Belum diuji"}</p>
          {feedback && <p role="status" className="rounded-[10px] border border-line bg-surface-2 px-3 py-2 text-xs">{feedback}</p>}
        </div>}
      </section>

      <section aria-labelledby="ai-roles-heading" className={PANEL}>
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="ai-roles-heading" className={H2}>Model per tugas</h2>
          <span className="text-xs text-muted">{modelSource}</span>
        </div>
        {!roles && <p role="status" className="mt-3 text-xs text-muted">Konfigurasi role belum dimuat.</p>}
        <div className="mt-2 flex flex-col divide-y divide-line">{ROLES.map((r) => {
          const locked = r.id === "journal" || r.id === "email";
          const choice: RoleConfig = drafts[r.id] ?? roles?.[r.id] ?? { provider: "ollama", model: "qwen2.5:3b" };
          const provider = locked ? "ollama" : choice.provider;
          const available = provider === "custom" ? customModels : localModels;
          const models = Array.from(new Set([choice.model, ...available])).filter(Boolean);
          const disabled = r.id === "recap" || !roles || savingRole !== null || busy;
          return <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13px]">{r.label}</span>
              <span className="text-[11px] text-muted">{r.description}</span>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label={`Penyedia untuk ${r.label}`} className="rounded-[6px] border border-line bg-surface p-2 transition-colors hover:bg-surface-2 text-sm" value={provider} disabled={locked || disabled}
                onChange={(e) => {
                  const next = e.target.value as AiProvider;
                  const options = next === "custom" ? customModels : localModels;
                  setDrafts((prev) => ({ ...prev, [r.id]: { provider: next, model: roles?.[r.id].provider === next ? roles[r.id].model : options[0] ?? "" } }));
                }}><option value="ollama">Ollama</option>{!locked && <option value="custom">Kustom</option>}</select>
              <select aria-label={`Model untuk ${r.label}`} className="rounded-[6px] border border-line bg-surface p-2 transition-colors hover:bg-surface-2 text-sm min-w-[180px]" value={choice.model} disabled={disabled || (provider === "custom" && !customModels.length)}
                onChange={(e) => {
                  const updated = { provider, model: e.target.value };
                  if (provider === "ollama" && !drafts[r.id]) void saveRole(r.id, updated);
                  else setDrafts((prev) => ({ ...prev, [r.id]: updated }));
                }}>{!choice.model && <option value="">Pilih model</option>}{models.map((model) => <option key={model} value={model}>{model}</option>)}</select>
              {(provider === "custom" || drafts[r.id]) && <button type="button" className={SECONDARY} disabled={disabled || !choice.model.trim()}
                onClick={() => saveRole(r.id, { provider, model: choice.model.trim() })}>{`Simpan model ${r.label}`}</button>}
            </div>
          </div>;
        })}</div>
        {selected === "custom" && !customModels.length && <p className="mt-3 text-xs text-muted">Belum ada model dari penyedia Kustom. Masukkan URL + key di "Penyedia AI", lalu klik "Muat model".</p>}
      </section>
    </div>

    <div className="flex min-w-0 flex-col gap-3.5">
      <section aria-labelledby="ai-usage-heading" className={PANEL}>
        <h2 id="ai-usage-heading" className={H2}>Pemakaian bulan ini</h2>
        <p className="mt-2 text-xs text-muted">Belum tersedia — permintaan AI belum dicatat di perangkat ini. Batas kuota tetap dipegang penyedia yang kamu pakai.</p>
      </section>
      <section aria-labelledby="ai-privacy-heading" className={PANEL}>
        <h2 id="ai-privacy-heading" className={H2}>Privasi AI</h2>
        <p className="mt-2 text-xs text-muted">Jurnal dan email hanya ke model lokal Ollama — terkunci. Kustom menerima pesan dan riwayat sesi, nama profil, konteks tugas/tagihan/habit/akun, serta hasil tools yang diizinkan. Data sensitif yang kamu ketik sendiri juga dikirim ke endpoint Kustom, termasuk server remote. Jurnal, email, dan tugas turunan jurnal tidak disertakan otomatis.</p>
        <p className="mt-2 text-xs text-muted">Mengganti provider/model chat mereset riwayat dan usulan pending; tidak ada fallback provider otomatis.</p>
      </section>
    </div>
  </div>;
}