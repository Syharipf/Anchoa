import { H2, PANEL } from "../shell/ui";
import type { SettingsSection } from "./view";

interface ComingSectionConfig {
  readonly title: string;
  readonly description: string;
}

const SECTION_CONFIGS: Record<"ai" | "avatar" | "suara", ComingSectionConfig> = {
  ai: {
    title: "Asisten & AI",
    description:
      "Pilihan penyedia model (Anthropic, OpenAI, Google Gemini, Ollama lokal), konfigurasi model per tugas (perintah suara, ringkasan email, tanggapan jurnal), dan kebijakan privasi data lokal.",
  },
  avatar: {
    title: "Avatar Live2D",
    description:
      "Model Live2D Cubism untuk asisten virtual, galeri model bawaan dan impor berkas .zip, pengujian gerakan dan lip-sync, serta penyesuaian batas performa perangkat.",
  },
  suara: {
    title: "Suara",
    description:
      "Pengenalan suara di perangkat (STT whisper.cpp) atau cloud, sintesis ucapan lokal (TTS Piper), pemilihan mikrofon dan pengujian input, serta kata pemanggil “Hai Anchoa”.",
  },
};

export function ComingSection({
  section,
}: Readonly<{ section: "ai" | "avatar" | "suara" | SettingsSection }>) {
  const key = section === "ai" || section === "avatar" || section === "suara" ? section : "ai";
  const config = SECTION_CONFIGS[key];

  return (
    <section className={`${PANEL} flex flex-col items-start gap-3`}>
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-accent">
        Menyusul (Fase 5)
      </span>
      <h2 className={H2}>{config.title}</h2>
      <p className="m-0 text-sm leading-relaxed text-ink">{config.description}</p>
    </section>
  );
}
