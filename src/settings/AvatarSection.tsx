import { useState } from "react";
import { H2, PANEL } from "../shell/ui";
import { AnchoaPet, type PetStatus } from "../pet/AnchoaPet";
import { LautAko } from "../pet/LautAko";

interface StatusOption {
  readonly id: PetStatus;
  readonly label: string;
}

const PET_STATUS_OPTIONS: readonly StatusOption[] = [
  { id: "idle", label: "Diam" },
  { id: "listening", label: "Mendengarkan" },
  { id: "thinking", label: "Berpikir" },
  { id: "speaking", label: "Berbicara" },
  { id: "happy", label: "Senang" },
  { id: "surprised", label: "Kaget" },
  { id: "sad", label: "Gagal" },
  { id: "sleep", label: "Tidur" },
];

export function AvatarSection() {
  const [testStatus, setTestStatus] = useState<PetStatus>("idle");
  const [showInPanel, setShowInPanel] = useState(true);
  const [showInMini, setShowInMini] = useState(true);
  const [showFloating, setShowFloating] = useState(false);
  const [dailyMood, setDailyMood] = useState(true);
  const [motion, setMotion] = useState<"penuh" | "hemat" | "diam">("penuh");
  const [lipSync, setLipSync] = useState<"mati" | "rendah" | "normal">("normal");
  const [sleepOnIdle, setSleepOnIdle] = useState(true);
  const [followCursor, setFollowCursor] = useState(true);

  const motionNotes: Record<"penuh" | "hemat" | "diam", string> = {
    penuh: "Ako dan kawanannya bergerak sesuai status.",
    hemat: "Tanpa kawanan kecil dan efek partikel.",
    diam: "Gambar diam tanpa animasi.",
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* Kolom Kiri: Pratinjau Ako & Tampil di */}
        <div className="flex flex-col gap-3.5">
          <section aria-labelledby="pet-prev" className={`${PANEL} flex flex-col gap-3`}>
            <div className="flex items-center gap-3">
              <h2 id="pet-prev" className={H2}>Ako</h2>
              <span className="text-xs text-muted">Teri pendamping · konsep kawanan</span>
            </div>

            <div className="relative flex h-[236px] items-center justify-center overflow-hidden rounded-xl border border-line bg-stage">
              <LautAko />
              <AnchoaPet
                status={testStatus}
                mood={dailyMood ? 1 : 0}
                motion={motion}
                shadow={false}
                size={200}
                className="relative z-10"
              />
            </div>

            <div role="group" aria-label="Coba status" className="flex flex-wrap gap-1.5">
              {PET_STATUS_OPTIONS.map((opt) => {
                const isSelected = testStatus === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setTestStatus(opt.id)}
                    className={`min-h-[30px] rounded-lg border px-2.5 text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? "border-accent bg-accent/15 font-semibold text-accent"
                        : "border-line bg-surface text-ink hover:bg-surface-2"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="pet-where" className={`${PANEL} flex flex-col gap-3`}>
            <h2 id="pet-where" className={H2}>Tampil di</h2>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-sm text-ink">Panel asisten</span>
                  <span className="text-xs text-muted">Dashboard desktop dan layar Asisten di HP</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showInPanel}
                  aria-label="Panel asisten"
                  onClick={() => setShowInPanel((v) => !v)}
                  className={`flex h-[22px] w-10 shrink-0 items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                    showInPanel ? "bg-accent" : "bg-line"
                  }`}
                >
                  <span
                    className={`h-[18px] w-[18px] rounded-full bg-canvas transition-transform ${
                      showInPanel ? "translate-x-[18px]" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                <div className="flex flex-col">
                  <span className="text-sm text-ink">Tombol asisten mini</span>
                  <span className="text-xs text-muted">Pojok kanan bawah di menu lain, dan kartu Beranda HP</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showInMini}
                  aria-label="Tombol asisten mini"
                  onClick={() => setShowInMini((v) => !v)}
                  className={`flex h-[22px] w-10 shrink-0 items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                    showInMini ? "bg-accent" : "bg-line"
                  }`}
                >
                  <span
                    className={`h-[18px] w-[18px] rounded-full bg-canvas transition-transform ${
                      showInMini ? "translate-x-[18px]" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                <div className="flex flex-col">
                  <span className="text-sm text-ink">Melayang di desktop</span>
                  <span className="text-xs text-muted">Jendela kecil transparan, selalu di atas (di Linux butuh compositing)</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showFloating}
                  aria-label="Melayang di desktop"
                  onClick={() => setShowFloating((v) => !v)}
                  className={`flex h-[22px] w-10 shrink-0 items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                    showFloating ? "bg-accent" : "bg-line"
                  }`}
                >
                  <span
                    className={`h-[18px] w-[18px] rounded-full bg-canvas transition-transform ${
                      showFloating ? "translate-x-[18px]" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Kolom Kanan: Mood harian & Gerak */}
        <div className="flex flex-col gap-3.5">
          <section aria-labelledby="pet-mood" className={`${PANEL} flex flex-col gap-3`}>
            <div className="flex items-center justify-between">
              <h2 id="pet-mood" className={H2}>Mood harian</h2>
              <span className="font-mono text-xs font-medium text-accent">Cerah · habit 3/5</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-sm text-ink">Ikut senang saat habit &amp; tugas selesai</span>
                <span className="text-xs text-muted">Mood hanya naik. Libur atau streak putus tidak membuat Ako sedih.</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={dailyMood}
                aria-label="Ikut senang saat habit & tugas selesai"
                onClick={() => setDailyMood((v) => !v)}
                className={`flex h-[22px] w-10 shrink-0 items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                  dailyMood ? "bg-accent" : "bg-line"
                }`}
              >
                <span
                  className={`h-[18px] w-[18px] rounded-full bg-canvas transition-transform ${
                    dailyMood ? "translate-x-[18px]" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </section>

          <section aria-labelledby="pet-motion" className={`${PANEL} flex flex-col gap-3`}>
            <h2 id="pet-motion" className={H2}>Gerak</h2>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted">Animasi</span>
              <div role="group" aria-label="Animasi Ako" className="flex rounded-lg border border-line bg-surface-2 p-0.5">
                {(["penuh", "hemat", "diam"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={motion === m}
                    onClick={() => setMotion(m)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                      motion === m ? "bg-accent text-canvas" : "text-muted hover:text-ink"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted">{motionNotes[motion]}</span>
            </div>

            <div className="flex flex-col gap-1.5 border-t border-line pt-3">
              <span className="text-xs text-muted">Gerak mulut ikut suara</span>
              <div role="group" aria-label="Sensitivitas mulut" className="flex rounded-lg border border-line bg-surface-2 p-0.5">
                {(["mati", "rendah", "normal"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={lipSync === s}
                    onClick={() => setLipSync(s)}
                    className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                      lipSync === s ? "bg-accent text-canvas" : "text-muted hover:text-ink"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
              <div className="flex flex-col">
                <span className="text-sm text-ink">Tidur saat tidak dipakai</span>
                <span className="text-xs text-muted">Setelah 2 menit; animasi berhenti total</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={sleepOnIdle}
                aria-label="Tidur saat tidak dipakai"
                onClick={() => setSleepOnIdle((v) => !v)}
                className={`flex h-[22px] w-10 shrink-0 items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                  sleepOnIdle ? "bg-accent" : "bg-line"
                }`}
              >
                <span
                  className={`h-[18px] w-[18px] rounded-full bg-canvas transition-transform ${
                    sleepOnIdle ? "translate-x-[18px]" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
              <div className="flex flex-col">
                <span className="text-sm text-ink">Mata mengikuti kursor</span>
                <span className="text-xs text-muted">Hanya saat asisten aktif</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={followCursor}
                aria-label="Mata mengikuti kursor"
                onClick={() => setFollowCursor((v) => !v)}
                className={`flex h-[22px] w-10 shrink-0 items-center rounded-full p-0.5 transition-colors cursor-pointer ${
                  followCursor ? "bg-accent" : "bg-line"
                }`}
              >
                <span
                  className={`h-[18px] w-[18px] rounded-full bg-canvas transition-transform ${
                    followCursor ? "translate-x-[18px]" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </section>

          {/* Compatibility badge & status indicator */}
          <div
            role="status"
            className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5 text-xs text-muted"
          >
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span>Avatar statis (kawanan teri). Live2D belum tersedia.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
