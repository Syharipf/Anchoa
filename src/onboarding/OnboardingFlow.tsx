import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api";
import { PANEL, PRIMARY, SECONDARY } from "../shell/ui";
import { AnchoaPet } from "../pet/AnchoaPet";

type StepId = "mic" | "voice" | "perf" | "laptop";

const STEPS: ReadonlyArray<{ id: StepId; label: string; sub: string; title: string; lead: string }> = [
  {
    id: "mic",
    label: "Microphone",
    sub: "Permission and test",
    title: "Let the assistant listen",
    lead: "Anchoa is built for voice. Allow microphone access; used only when you press the mic button or say the wake word.",
  },
  {
    id: "voice",
    label: "Assistant voice",
    sub: "Choose voice",
    title: "Choose assistant voice",
    lead: "Pick a voice that sounds right. You can change it anytime in Settings › Voice.",
  },
  {
    id: "perf",
    label: "Performance test",
    sub: "Ako motion",
    title: "Meet Ako",
    lead: "Ako, your pet companion, lives on the Dashboard. Run a quick test to choose the right motion mode for this device.",
  },
  {
    id: "laptop",
    label: "Connect phone",
    sub: "Optional · file access",
    title: "Connect laptop (optional)",
    lead: "Files stay on your laptop. Your phone accesses them over your private Tailscale network and SFTP, without cloud uploads.",
  },
];

export function OnboardingFlow({ onComplete }: Readonly<{ onComplete: () => void }>) {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  const finish = async () => {
    setBusy(true);
    try {
      await api.completeOnboarding();
      onComplete();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full w-full bg-canvas text-ink">
      <aside
        aria-label="Setup steps"
        className="flex w-[300px] shrink-0 flex-col gap-1.5 border-r border-line bg-sidebar px-6 py-8"
      >
        <div className="mb-5 flex items-center gap-2.5">
          <span className="font-display text-lg font-semibold">Welcome</span>
        </div>
        <ol className="m-0 flex list-none flex-col gap-1 p-0">
          {STEPS.map((s, i) => {
            const done = i < index;
            const current = i === index;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-current={current ? "step" : undefined}
                  className={`flex w-full items-start gap-3 rounded-[10px] border-0 p-2.5 text-left transition-colors ${
                    current ? "bg-surface-2" : "hover:bg-surface-2"
                  }`}
                >
                  <span
                    className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-[1.5px] font-mono text-xs ${
                      done
                        ? "border-accent bg-accent text-canvas"
                        : current
                        ? "border-accent text-accent"
                        : "border-line text-muted"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className={`text-sm ${current || done ? "text-ink" : "text-muted"}`}>
                      {s.label}
                    </span>
                    <span className="text-xs text-muted">{s.sub}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <button
          type="button"
          onClick={finish}
          disabled={busy}
          className="mt-auto border-0 bg-transparent p-0 text-left text-[13px] text-muted hover:text-ink"
        >
          Skip all, configure later in Settings
        </button>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col px-14 pb-8 pt-10">
        <span className="font-mono text-xs text-muted">
          Step {index + 1} of {STEPS.length}
        </span>
        <h1 className="mb-1 mt-1.5 font-display text-[28px] font-semibold tracking-[-0.01em]">
          {step.title}
        </h1>
        <p className="mb-5 mt-0 max-w-[620px] text-sm leading-relaxed text-muted">{step.lead}</p>

        {error && (
          <div
            role="alert"
            className="mb-4 max-w-[620px] rounded-lg border border-danger/40 bg-danger-row p-3 text-xs text-danger"
          >
            {error}
          </div>
        )}

        <div className="min-h-0 flex-1">
          {step.id === "mic" && <MicStep />}
          {step.id === "voice" && <VoiceStep />}
          {step.id === "perf" && <PerfStep />}
          {step.id === "laptop" && <LaptopStep />}
        </div>

        <div className="flex items-center gap-2.5 border-t border-line pt-4">
          {index > 0 && (
            <button type="button" onClick={() => setIndex(index - 1)} className={SECONDARY}>
              Back
            </button>
          )}
          {index === 0 && (
            <button type="button" onClick={() => setIndex(1)} className="text-sm text-muted hover:text-ink">
              Set up later
            </button>
          )}
          {!last ? (
            <button
              type="button"
              onClick={() => setIndex(index + 1)}
              className={`${PRIMARY} ml-auto`}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={finish}
              disabled={busy}
              className={`${PRIMARY} ml-auto`}
            >
              {busy ? "Saving…" : "Finish"}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

function MicStep() {
  const [state, setState] = useState<"idle" | "asking" | "ok" | "denied">("idle");

  const allow = async () => {
    setState("asking");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setState("ok");
    } catch {
      setState("denied");
    }
  };

  return (
    <section className={`${PANEL} flex max-w-[420px] flex-col gap-3`}>
      <h2 className="m-0 font-display text-[15px] font-semibold">Microphone</h2>
      {state === "ok" ? (
        <span className="flex items-center gap-2 text-[13px] text-accent">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          Microphone allowed
        </span>
      ) : (
        <>
          <p className="m-0 text-[13px] leading-relaxed text-muted">
            Used only when you press the mic button or speak the wake word.
          </p>
          <button type="button" onClick={allow} disabled={state === "asking"} className={`${PRIMARY} self-start`}>
            {state === "asking" ? "Requesting permission…" : "Allow microphone"}
          </button>
          {state === "denied" && (
            <span className="text-xs text-danger">
              Permission denied. You can allow it later in system settings.
            </span>
          )}
        </>
      )}
    </section>
  );
}

function VoiceStep() {
  const [voices, setVoices] = useState<{ id: string; label: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    api
      .voiceVoices()
      .then((list) => {
        setVoices(list.filter((v) => v.installed || v.imported).map((v) => ({ id: v.id, label: v.label })));
        setSelected((prev) => prev ?? list.find((v) => v.installed || v.imported)?.id ?? null);
      })
      .catch(() => setVoices([]));
  }, []);

  const pick = (id: string) => {
    setSelected(id);
    void api.setVoice(id).catch(() => {});
  };

  return (
    <section className={`${PANEL} flex max-w-[420px] flex-col gap-3`}>
      <h2 className="m-0 font-display text-[15px] font-semibold">Assistant voice</h2>
      {voices.length === 0 ? (
        <p className="m-0 text-[13px] leading-relaxed text-muted">
          No voices installed yet. Install a Piper voice in Settings › Voice anytime.
        </p>
      ) : (
        <div role="group" aria-label="Assistant voice" className="flex flex-wrap gap-1.5">
          {voices.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={selected === v.id}
              onClick={() => pick(v.id)}
              className={`min-h-8 rounded-lg px-3 text-[13px] ${
                selected === v.id ? "bg-surface-2 text-ink" : "text-muted hover:bg-surface-2"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
      <span className="text-xs leading-relaxed text-muted">Language: Indonesian. Speed can be adjusted later.</span>
    </section>
  );
}

function PerfStep() {
  const [fps, setFps] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const frame = useRef(0);
  const started = useRef(0);

  const measure = () => {
    if (running) return;
    setRunning(true);
    frame.current = 0;
    started.current = performance.now();
    const tick = () => {
      frame.current += 1;
      const elapsed = performance.now() - started.current;
      if (elapsed >= 1000) {
        setFps(Math.round((frame.current * 1000) / elapsed));
        setRunning(false);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  return (
    <div className="grid max-w-[820px] grid-cols-[minmax(0,1fr)_300px] gap-4">
      <div className="flex flex-col items-center justify-center gap-3 rounded-[14px] bg-stage p-6">
        <AnchoaPet status="idle" size={200} motion="penuh" />
      </div>
      <section className={`${PANEL} flex flex-col gap-3`}>
        <h2 className="m-0 font-display text-[15px] font-semibold">Performance test</h2>
        <p className="m-0 text-xs leading-relaxed text-muted">
          Runs Ako for a few seconds to choose the best motion mode for this device.
        </p>
        <button type="button" onClick={measure} disabled={running} className={`${PRIMARY} self-start`}>
          {running ? "Measuring…" : fps === null ? "Start test" : "Measure again"}
        </button>
        <div className="flex flex-col gap-1 rounded-[10px] bg-canvas p-2.5">
          <span className={`font-mono text-base ${fps !== null ? "text-accent" : "text-muted"}`}>
            {fps === null ? "– fps" : `${fps} fps`}
          </span>
          <span className="text-xs text-muted">
            {fps === null ? "Not measured yet" : "Full mode in use; animations pause when Ako sleeps."}
          </span>
        </div>
      </section>
    </div>
  );
}

function LaptopStep() {
  const steps = [
    ["Install Tailscale on laptop and phone", "Sign in with the same account. Free for personal use."],
    ["Run setup script on laptop", "Creates the anchoa-sftp user, /srv/anchoa folder, and locks sshd to tailscale0."],
    ["Copy phone public key to laptop", "Key-based login only, no passwords."],
    ["Test connection", "Verifies the phone can read folders on your laptop."],
  ];
  return (
    <div className="grid max-w-[820px] grid-cols-[minmax(0,1fr)_300px] gap-4">
      <section className={`${PANEL} flex flex-col`}>
        <h2 className="m-0 mb-2 font-display text-[15px] font-semibold">Let your phone access laptop files</h2>
        {steps.map(([label, sub], i) => (
          <div key={label} className={`flex items-start gap-3 py-2 ${i > 0 ? "border-t border-line" : ""}`}>
            <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-[11px] text-muted">
              {i + 1}
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px]">{label}</span>
              <span className="text-xs leading-relaxed text-muted">{sub}</span>
            </span>
          </div>
        ))}
      </section>
      <section className={`${PANEL} flex flex-col gap-3`}>
        <h2 className="m-0 font-display text-[15px] font-semibold">Connect</h2>
        <span className="text-xs text-muted">
          Laptop must be online and connected to Tailscale. Can be configured later in Settings.
        </span>
      </section>
    </div>
  );
}