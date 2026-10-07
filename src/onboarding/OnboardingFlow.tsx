import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api";
import { PANEL, PRIMARY, SECONDARY } from "../shell/ui";
import { AnchoaPet } from "../pet/AnchoaPet";

type StepId = "mic" | "voice" | "perf" | "laptop";

const STEPS: ReadonlyArray<{ id: StepId; label: string; sub: string; title: string; lead: string }> = [
  {
    id: "mic",
    label: "Mikrofon",
    sub: "Izin dan uji suara",
    title: "Biar asisten bisa mendengar",
    lead: "Anchoa dibuat untuk suara. Izinkan mikrofon; dipakai hanya saat kamu menekan tombol mikrofon atau mengucapkan kata pemanggil.",
  },
  {
    id: "voice",
    label: "Suara asisten",
    sub: "Pilih suara",
    title: "Pilih suara asisten",
    lead: "Pilih suara yang enak didengar. Bisa diubah kapan saja di Pengaturan › Suara.",
  },
  {
    id: "perf",
    label: "Uji performa",
    sub: "Gerak Ako",
    title: "Kenalan dengan Ako",
    lead: "Ako, teri pendamping, tampil di Dashboard. Uji sebentar untuk memilih mode gerak yang pas di perangkat ini.",
  },
  {
    id: "laptop",
    label: "Hubungkan HP",
    sub: "Opsional · akses file",
    title: "Hubungkan laptop (opsional)",
    lead: "File tetap di laptop. HP membukanya lewat jaringan pribadi Tailscale dan SFTP, tanpa diunggah ke cloud.",
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
        aria-label="Langkah penyiapan"
        className="flex w-[300px] shrink-0 flex-col gap-1.5 border-r border-line bg-sidebar px-6 py-8"
      >
        <div className="mb-5 flex items-center gap-2.5">
          <span className="font-display text-lg font-semibold">Selamat datang</span>
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
          Lewati semua, atur nanti di Pengaturan
        </button>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col px-14 pb-8 pt-10">
        <span className="font-mono text-xs text-muted">
          Langkah {index + 1} dari {STEPS.length}
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
              Kembali
            </button>
          )}
          {index === 0 && (
            <button type="button" onClick={() => setIndex(1)} className="text-sm text-muted hover:text-ink">
              Atur nanti
            </button>
          )}
          {!last ? (
            <button
              type="button"
              onClick={() => setIndex(index + 1)}
              className={`${PRIMARY} ml-auto`}
            >
              Lanjut
            </button>
          ) : (
            <button
              type="button"
              onClick={finish}
              disabled={busy}
              className={`${PRIMARY} ml-auto`}
            >
              {busy ? "Menyimpan…" : "Selesai"}
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
      <h2 className="m-0 font-display text-[15px] font-semibold">Mikrofon</h2>
      {state === "ok" ? (
        <span className="flex items-center gap-2 text-[13px] text-accent">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          Mikrofon diizinkan
        </span>
      ) : (
        <>
          <p className="m-0 text-[13px] leading-relaxed text-muted">
            Dipakai hanya saat kamu menekan tombol mikrofon atau mengucapkan kata pemanggil.
          </p>
          <button type="button" onClick={allow} disabled={state === "asking"} className={`${PRIMARY} self-start`}>
            {state === "asking" ? "Meminta izin…" : "Izinkan mikrofon"}
          </button>
          {state === "denied" && (
            <span className="text-xs text-danger">
              Izin ditolak. Kamu bisa mengizinkan nanti di pengaturan sistem.
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
      <h2 className="m-0 font-display text-[15px] font-semibold">Suara asisten</h2>
      {voices.length === 0 ? (
        <p className="m-0 text-[13px] leading-relaxed text-muted">
          Belum ada suara terpasang. Pasang suara Piper di Pengaturan › Suara kapan saja.
        </p>
      ) : (
        <div role="group" aria-label="Suara asisten" className="flex flex-wrap gap-1.5">
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
      <span className="text-xs leading-relaxed text-muted">Bahasa: Indonesia. Kecepatan bisa diubah nanti.</span>
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
        <h2 className="m-0 font-display text-[15px] font-semibold">Uji performa</h2>
        <p className="m-0 text-xs leading-relaxed text-muted">
          Menjalankan Ako beberapa detik untuk memilih mode gerak yang pas di perangkat ini.
        </p>
        <button type="button" onClick={measure} disabled={running} className={`${PRIMARY} self-start`}>
          {running ? "Mengukur…" : fps === null ? "Mulai uji" : "Ukur ulang"}
        </button>
        <div className="flex flex-col gap-1 rounded-[10px] bg-canvas p-2.5">
          <span className={`font-mono text-base ${fps !== null ? "text-accent" : "text-muted"}`}>
            {fps === null ? "– fps" : `${fps} fps`}
          </span>
          <span className="text-xs text-muted">
            {fps === null ? "Belum diukur" : "Mode penuh dipakai; animasi berhenti saat Ako tidur."}
          </span>
        </div>
      </section>
    </div>
  );
}

function LaptopStep() {
  const steps = [
    ["Pasang Tailscale di laptop dan HP", "Masuk dengan akun yang sama. Gratis untuk pemakaian pribadi."],
    ["Jalankan skrip penyiapan di laptop", "Membuat pengguna anchoa-sftp, folder /srv/anchoa, dan mengunci sshd ke tailscale0."],
    ["Salin kunci publik HP ke laptop", "Login hanya dengan kunci, tanpa kata sandi."],
    ["Tes koneksi", "Memastikan HP bisa membaca folder di laptop."],
  ];
  return (
    <div className="grid max-w-[820px] grid-cols-[minmax(0,1fr)_300px] gap-4">
      <section className={`${PANEL} flex flex-col`}>
        <h2 className="m-0 mb-2 font-display text-[15px] font-semibold">Supaya HP bisa membuka file di laptop</h2>
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
        <h2 className="m-0 font-display text-[15px] font-semibold">Hubungkan</h2>
        <span className="text-xs text-muted">
          Laptop harus menyala dan sudah masuk Tailscale. Bisa diatur nanti di Pengaturan.
        </span>
      </section>
    </div>
  );
}