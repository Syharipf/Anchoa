import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  api,
  errorMessage,
  type EmailStatus,
  type GithubStatus,
  type NotifyPrefs,
  type Profile,
  type SecurityStatus,
  type SyncStatus,
} from "../api";
import { School } from "../assistant/School";
import { PinDialog } from "../security/PinDialog";
import type { PinFormMode } from "../security/PinFields";
import { connectionLabel } from "../email/view";
import { syncLabel, type SettingsSection } from "../settings/view";
import { useToast } from "../shell/toast";
import { FIELD, H1, H2, PANEL } from "../shell/ui";
import {
  formatSince,
  NOTIFY_PREF_OPTIONS,
  type NotifyPrefOption,
  profileInitials,
  profileStatsList,
} from "./view";

const DEFAULT_PREFS: NotifyPrefs = {
  task: true,
  bill: true,
  budget: true,
  habit: true,
  journal: false,
  journalAt: "20:00",
};

export function ProfilePage({
  prefs: initialPrefs,
  onPrefsChanged,
  onOpenSettings,
}: Readonly<{
  prefs?: NotifyPrefs;
  onPrefsChanged?: (prefs: NotifyPrefs) => void;
  onOpenSettings?: (section?: SettingsSection) => void;
}>) {
  const toast = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [email, setEmail] = useState<EmailStatus | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [prefs, setPrefs] = useState<NotifyPrefs>(initialPrefs ?? DEFAULT_PREFS);
  const [isEditing, setIsEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [security, setSecurity] = useState<SecurityStatus | null>(null);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [pinDialog, setPinDialog] = useState<PinFormMode | null>(null);

  const loadSecurityStatus = useCallback(() => {
    api
      .securityStatus()
      .then((status) => {
        setSecurity(status);
        setSecurityError(null);
      })
      .catch((err) => {
        setSecurity(null);
        setSecurityError(errorMessage(err));
      });
  }, []);

  useEffect(() => {
    loadSecurityStatus();
  }, [loadSecurityStatus]);

  useEffect(() => {
    if (initialPrefs) {
      setPrefs(initialPrefs);
    } else {
      api.getNotifyPrefs().then(setPrefs).catch(() => {});
    }
  }, [initialPrefs]);

  useEffect(() => {
    api.getProfile().then(
      (p) => {
        setProfile(p);
        setNameInput(p.name);
      },
      (e) => toast(errorMessage(e), "error"),
    );
    api.githubStatus().then(setGithub).catch(() => {});
    api.emailStatus().then(setEmail).catch((e) => toast(errorMessage(e), "error"));
    api.syncStatus().then(setSync).catch(() => {});
  }, [toast]);

  const handleStartEdit = () => {
    setNameInput(profile?.name ?? "");
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setNameInput(profile?.name ?? "");
    setIsEditing(false);
  };

  const handleSaveName = async (e: FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    try {
      const updated = await api.setProfileName(nameInput);
      setProfile(updated);
      setNameInput(updated.name);
      setIsEditing(false);
      toast("Nama profil diperbarui", "info");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setIsSaving(false);
    }
  };

  const prefsRequest = useRef(0);
  const savePrefs = useCallback(
    (next: NotifyPrefs) => {
      const previous: NotifyPrefs = { ...prefs };
      setPrefs(next);
      const request = ++prefsRequest.current;
      api.setNotifyPrefs(next).then(
        (saved) => {
          if (request !== prefsRequest.current) return;
          setPrefs(saved);
          onPrefsChanged?.(saved);
        },
        (err) => {
          toast(errorMessage(err), "error");
          if (request === prefsRequest.current) setPrefs(previous);
        },
      );
    },
    [prefs, onPrefsChanged, toast],
  );
  const handleTogglePref = useCallback(
    (key: NotifyPrefOption["key"]) => savePrefs({ ...prefs, [key]: !prefs[key] }),
    [prefs, savePrefs],
  );
  const handleJournalAtChange = useCallback(
    (value: string) => {
      if (!/^\d{2}:\d{2}$/.test(value)) return;
      const [h, m] = value.split(":").map(Number);
      if (h >= 24 || m >= 60) return;
      savePrefs({ ...prefs, journalAt: value });
    },
    [prefs, savePrefs],
  );

  const stats = profileStatsList(profile?.stats);
  const initials = profileInitials(profile?.name ?? "");

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-baseline gap-3">
        <h1 className={H1}>Profil</h1>
        <span className="text-[13px] text-muted">
          Akun, asisten suara, dan preferensi notifikasi
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 items-start gap-4 lg:grid-cols-3">
        {/* Kolom 1: Kartu Profil + Keamanan */}
        <div className="flex flex-col gap-3.5">
          <section
            aria-labelledby="section-profile"
            className={`${PANEL} flex flex-col items-center gap-3 text-center`}
          >
            <div className="relative flex h-28 w-28 items-center justify-center">
              <School
                size={112}
                color="var(--color-accent)"
                dimmed={false}
                running={false}
                className="absolute inset-0"
              />
              <span className="relative flex h-[72px] w-[72px] items-center justify-center rounded-full border-2 border-disabled bg-surface-2 font-display text-3xl font-semibold text-accent">
                {initials}
              </span>
            </div>

            {isEditing ? (
              <form
                onSubmit={handleSaveName}
                className="flex w-full flex-col items-center gap-2 pt-1"
              >
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  maxLength={40}
                  className={`${FIELD} w-full text-center`}
                  aria-label="Nama tampilan"
                  placeholder="Nama tampilan"
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="min-h-8 rounded-lg bg-accent px-3 text-xs font-semibold text-canvas transition-transform hover:scale-105 active:scale-95 disabled:bg-disabled disabled:text-muted"
                  >
                    Simpan
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="min-h-8 rounded-lg border border-line px-3 text-xs text-muted transition-colors hover:bg-surface-2"
                  >
                    Batal
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <h2
                  id="section-profile"
                  className="m-0 font-display text-2xl font-semibold text-ink"
                >
                  {profile?.name ?? "Kamu"}
                </h2>
                <span className="text-xs text-muted">
                  {formatSince(profile?.since ?? null)}
                </span>
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="mt-2 min-h-8 rounded-lg border border-disabled px-3.5 text-xs text-ink transition-colors hover:bg-surface-2"
                >
                  Ubah profil
                </button>
              </div>
            )}

            <div className="grid w-full grid-cols-2 gap-3 border-t border-line pt-3 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="flex flex-col gap-0.5">
                  <span className="font-mono text-lg font-medium text-ink">
                    {s.value}
                  </span>
                  <span className="text-[11px] text-muted">{s.label}</span>
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="section-security" className={`${PANEL} flex flex-col gap-3`}>
            <h2 id="section-security" className={H2}>
              Keamanan
            </h2>

            {securityError ? (
              <div
                role="alert"
                className="flex flex-col gap-1.5 rounded-lg border border-danger/40 bg-danger-row p-3 text-xs text-danger"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-danger">Gagal memuat status keamanan</span>
                  <button
                    type="button"
                    onClick={loadSecurityStatus}
                    className="font-medium text-accent hover:underline cursor-pointer"
                  >
                    Coba lagi
                  </button>
                </div>
                <p className="m-0 text-muted leading-relaxed">{securityError}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                  <div className="flex min-w-0 flex-col">
                    <span id="lbl-security-pin" className="text-sm text-ink">
                      Kunci dengan PIN saat aplikasi dibuka
                    </span>
                    <span className="text-xs text-muted">
                      Memerlukan PIN saat membuka aplikasi
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={security?.pinEnabled ?? false}
                    aria-labelledby="lbl-security-pin"
                    onClick={() => {
                      if (security?.pinEnabled) {
                        setPinDialog("disable");
                      } else {
                        setPinDialog("create");
                      }
                    }}
                    className={`flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                      security?.pinEnabled ? "bg-accent" : "bg-disabled"
                    }`}
                  >
                    <span
                      className={`h-[18px] w-[18px] rounded-full transition-transform ${
                        security?.pinEnabled ? "translate-x-[18px] bg-canvas" : "translate-x-0 bg-muted"
                      }`}
                    />
                  </button>
                </div>

                {security?.pinEnabled && (
                  <div className="flex items-center justify-between gap-3 border-t border-line pt-2.5">
                    <div className="flex min-w-0 flex-col">
                      <span className="text-sm text-ink">PIN aktif</span>
                      <span className="text-xs text-muted">Ganti PIN keamanan saat ini</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPinDialog("change")}
                      className="min-h-8 shrink-0 rounded-lg border border-line px-3 text-xs text-ink transition-colors hover:bg-surface-2"
                    >
                      Ganti PIN
                    </button>
                  </div>
                )}
              </>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-line pt-2.5">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm text-ink">Enkripsi data lokal</span>
                <span className="text-xs text-muted">Keuangan, email, dan catatan</span>
              </div>
              <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
                Belum tersedia
              </span>
            </div>
          </section>
        </div>

        {/* Kolom 2: Akun terhubung + Asisten suara */}
        <div className="flex flex-col gap-3.5">
          <section aria-labelledby="section-accounts" className={`${PANEL} flex flex-col gap-3`}>
            <h2 id="section-accounts" className={H2}>
              Akun terhubung
            </h2>

            <div className="flex items-center gap-3 border-t border-line pt-3 first:border-0 first:pt-0">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-xs font-medium text-accent">
                GH
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-ink">Repo kode</span>
                <span className="truncate text-xs text-muted">
                  {github?.connected
                    ? `Terhubung${github.login ? ` sebagai @${github.login}` : ""}`
                    : "Belum terhubung · untuk kontribusi & proyek"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOpenSettings?.("integrations")}
                className="min-h-7 shrink-0 rounded-md border border-disabled px-2.5 text-xs text-ink transition-colors hover:bg-surface-2"
              >
                Atur
              </button>
            </div>

            <div className="flex items-center gap-3 border-t border-line pt-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-xs font-medium text-muted">
                @
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-ink">Email</span>
                <span className="break-all text-xs text-muted">{connectionLabel(email)}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 border-t border-line pt-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-xs font-medium text-muted">
                SYN
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-ink">Sinkron antarperangkat</span>
                <span className="break-all text-xs text-muted">{syncLabel(sync)}</span>
              </div>
              <button
                type="button"
                onClick={() => onOpenSettings?.("data")}
                className="min-h-7 shrink-0 rounded-md border border-disabled px-2.5 text-xs text-ink transition-colors hover:bg-surface-2"
              >
                Atur
              </button>
            </div>

            <div className="flex items-center gap-3 border-t border-line pt-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-mono text-xs font-medium text-muted">
                CAL
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-ink">Kalender</span>
                <span className="text-xs text-muted">Impor acara ke Jadwal</span>
              </div>
              <span className="shrink-0 rounded-md bg-surface-2 px-2 py-1 text-xs text-muted">
                Belum tersedia
              </span>
            </div>
          </section>

          <section aria-labelledby="section-voice" className={`${PANEL} flex flex-col gap-2.5`}>
            <h2 id="section-voice" className={H2}>
              Asisten suara
            </h2>
            <p className="m-0 text-xs leading-relaxed text-muted">
              Pilihan suara, kecepatan bicara, dan model suara diatur di Pengaturan &gt; Suara.
            </p>
            <button
              type="button"
              onClick={() => onOpenSettings?.("suara")}
              className="self-start min-h-7 shrink-0 rounded-md border border-disabled px-2.5 text-xs text-ink transition-colors hover:bg-surface-2"
            >
              Atur suara
            </button>
          </section>
        </div>

        {/* Kolom 3: Notifikasi */}
        <div className="flex flex-col gap-3.5">
          <section aria-labelledby="section-notify" className={`${PANEL} flex flex-col gap-1`}>
            <h2 id="section-notify" className={`${H2} pb-2`}>
              Notifikasi
            </h2>

            {NOTIFY_PREF_OPTIONS.map((opt) => (
              <div
                key={opt.key}
                className="flex flex-col border-t border-line py-2.5 first:border-0 first:pt-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span id={`lbl-notify-${opt.key}`} className="text-sm text-ink">
                      {opt.label}
                    </span>
                    <span className="text-xs text-muted">{opt.description}</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={prefs[opt.key]}
                    aria-labelledby={`lbl-notify-${opt.key}`}
                    onClick={() => handleTogglePref(opt.key)}
                    className={`flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                      prefs[opt.key] ? "bg-accent" : "bg-disabled"
                    }`}
                  >
                    <span
                      className={`h-[18px] w-[18px] rounded-full transition-transform ${
                        prefs[opt.key] ? "translate-x-[18px] bg-canvas" : "translate-x-0 bg-muted"
                      }`}
                    />
                  </button>
                </div>
                {opt.key === "journal" && prefs.journal && (
                  <div className="mt-2 flex items-center justify-between gap-3 pl-2">
                    <span className="text-xs text-muted">Waktu pengingat</span>
                    <input
                      type="time"
                      aria-label="Jam pengingat jurnal"
                      value={prefs.journalAt}
                      onChange={(e) => handleJournalAtChange(e.target.value)}
                      className={`${FIELD} h-7 w-24 px-2 text-center text-xs`}
                    />
                  </div>
                )}
              </div>
            ))}

            <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink">Jam tenang</span>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
                  Belum tersedia
                </span>
              </div>
              <p className="m-0 text-xs leading-relaxed text-muted">
                Pengaturan jam tenang dan suara notifikasi desktop belum tersedia.
              </p>
            </div>
          </section>
        </div>
      </div>
      {pinDialog && (
        <PinDialog
          mode={pinDialog}
          onClose={() => setPinDialog(null)}
          onSuccess={() => {
            const finishedMode = pinDialog;
            setPinDialog(null);
            if (finishedMode === "create") {
              setSecurity((prev) =>
                prev ? { ...prev, pinEnabled: true } : { pinEnabled: true, locked: false },
              );
              toast("Kunci PIN berhasil diaktifkan", "info");
            } else if (finishedMode === "disable") {
              setSecurity((prev) =>
                prev ? { ...prev, pinEnabled: false } : { pinEnabled: false, locked: false },
              );
              toast("Kunci PIN dinonaktifkan", "info");
            } else if (finishedMode === "change") {
              toast("PIN berhasil diubah", "info");
            }
          }}
        />
      )}
    </div>
  );
}
