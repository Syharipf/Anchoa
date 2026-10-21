import { useState } from "react";
import { H2, PANEL } from "../shell/ui";
import { AnchoaPet, type PetStatus } from "../pet/AnchoaPet";
import { LautAko } from "../pet/LautAko";

interface StatusOption {
  readonly id: PetStatus;
  readonly label: string;
}

const PET_STATUS_OPTIONS: readonly StatusOption[] = [
  { id: "idle", label: "Idle" },
  { id: "listening", label: "Listening" },
  { id: "thinking", label: "Thinking" },
  { id: "speaking", label: "Speaking" },
  { id: "happy", label: "Happy" },
  { id: "surprised", label: "Surprised" },
  { id: "sad", label: "Failed" },
  { id: "sleep", label: "Sleeping" },
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
    penuh: "Ako and companions move according to status.",
    hemat: "Without small school and particle effects.",
    diam: "Static image without animation.",
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* Kolom Kiri: Pratinjau Ako & Tampil di */}
        <div className="flex flex-col gap-3.5">
          <section aria-labelledby="pet-prev" className={`${PANEL} flex flex-col gap-3`}>
            <div className="flex items-center gap-3">
              <h2 id="pet-prev" className={H2}>Ako</h2>
              <span className="text-xs text-muted">Companion anchovy · school concept</span>
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

            <div role="group" aria-label="Test status" className="flex flex-wrap gap-1.5">
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
            <h2 id="pet-where" className={H2}>Display in</h2>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-sm text-ink">Assistant panel</span>
                  <span className="text-xs text-muted">Desktop dashboard and mobile Assistant screen</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showInPanel}
                  aria-label="Assistant panel"
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
                  <span className="text-sm text-ink">Mini assistant button</span>
                  <span className="text-xs text-muted">Bottom right corner in other views, and mobile Home card</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showInMini}
                  aria-label="Mini assistant button"
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
                  <span className="text-sm text-ink">Float on desktop</span>
                  <span className="text-xs text-muted">Small transparent window, always on top (requires compositing on Linux)</span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showFloating}
                  aria-label="Float on desktop"
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
              <h2 id="pet-mood" className={H2}>Daily mood</h2>
              <span className="font-mono text-xs font-medium text-accent">Sunny · habits 3/5</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col">
                <span className="text-sm text-ink">Cheer up when habits &amp; tasks complete</span>
                <span className="text-xs text-muted">Mood only increases. Rest days or broken streaks do not make Ako sad.</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={dailyMood}
                aria-label="Cheer up when habits & tasks complete"
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
            <h2 id="pet-motion" className={H2}>Motion</h2>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted">Animation</span>
              <div role="group" aria-label="Ako animation" className="flex rounded-lg border border-line bg-surface-2 p-0.5">
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
              <span className="text-xs text-muted">Mouth syncs with voice</span>
              <div role="group" aria-label="Mouth sensitivity" className="flex rounded-lg border border-line bg-surface-2 p-0.5">
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
                <span className="text-sm text-ink">Sleep when idle</span>
                <span className="text-xs text-muted">After 2 minutes; animation stops completely</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={sleepOnIdle}
                aria-label="Sleep when idle"
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
                <span className="text-sm text-ink">Eyes follow cursor</span>
                <span className="text-xs text-muted">Only while assistant is active</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={followCursor}
                aria-label="Eyes follow cursor"
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
            <span>Static avatar (anchovy school). Live2D not available yet.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
