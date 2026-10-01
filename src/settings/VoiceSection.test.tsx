import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  api,
  type VoiceInstallProgress,
  type VoiceStatus,
} from "../api";
import { deferred, elements, hookHarness } from "../test/hookHarness";
import { VoiceSection } from "./VoiceSection";

describe("VoiceSection", () => {
  const spies: ReturnType<typeof spyOn>[] = [];
  let harness: ReturnType<typeof hookHarness<ReactNode>> | null = null;

  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
    spies.length = 0;
    if (harness) {
      harness.dispose();
      harness = null;
    }
  });

  const baseVoiceStatus: VoiceStatus = {
    pwRecord: true,
    pwPlay: true,
    whisper: "/usr/bin/whisper-cli",
    whisperModel: true,
    piper: true,
    voices: [
      {
        id: "id_ID-news_tts-medium",
        label: "Indonesia · News",
        language: "id_ID",
        quality: "medium",
        installed: true,
        imported: false,
        params: { lengthScale: 1.0, noiseScale: 0.667, noiseW: 0.8 },
      },
      {
        id: "en_US-amy-medium",
        label: "English · Amy",
        language: "en_US",
        quality: "medium",
        installed: true,
        imported: false,
        params: { lengthScale: 1.0, noiseScale: 0.667, noiseW: 0.8 },
      },
      {
        id: "en_US-lessac-high",
        label: "English · Lessac",
        language: "en_US",
        quality: "high",
        installed: false,
        imported: false,
        params: { lengthScale: 1.0, noiseScale: 0.667, noiseW: 0.8 },
      },
    ],
    settings: {
      id: "id_ID-news_tts-medium",
      params: { lengthScale: 1.0, noiseScale: 0.667, noiseW: 0.8 },
    },
    recording: false,
    speaking: false,
  };

  it("renders status rows for pw-record, whisper binary with dnf hint, whisper model, and Piper", async () => {
    const uninstalledStatus: VoiceStatus = {
      ...baseVoiceStatus,
      pwRecord: true,
      whisper: null,
      whisperModel: false,
      piper: false,
    };
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(uninstalledStatus));

    harness = hookHarness<ReactNode>(() => VoiceSection({}));
    harness.render();
    await harness.settle();

    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("Perekam Audio (pw-record)");
    expect(html).toContain("Tersedia");

    expect(html).toContain("Binary whisper.cpp");
    expect(html).toContain("Belum terpasang");
    expect(html).toContain("sudo dnf install whisper-cpp");

    expect(html).toContain("Model Whisper Base (ggml-base.bin)");
    expect(html).toContain("Piper TTS");
    expect(html).toContain("Pasang");
  });

  it("handles component install and shows progress bar from voiceInstall events", async () => {
    const uninstalledStatus: VoiceStatus = {
      ...baseVoiceStatus,
      whisperModel: false,
    };
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(uninstalledStatus));

    let onProgressCallback: ((p: VoiceInstallProgress) => void) | undefined = undefined;
    const installDeferred = deferred<void>();
    const installSpy = spyOn(api, "voiceInstall").mockImplementation((_comp, onProgress) => {
      onProgressCallback = onProgress;
      return installDeferred.promise;
    });
    spies.push(installSpy);

    harness = hookHarness<ReactNode>(() => VoiceSection({}));
    harness.render();
    await harness.settle();

    const pasangBtn = elements(harness.render()).find(
      (el) => el.props["aria-label"] === "Pasang model whisper base",
    );
    expect(pasangBtn).toBeDefined();

    // Trigger install
    void (pasangBtn!.props.onClick as () => Promise<void>)();
    await harness.settle();

    expect(installSpy).toHaveBeenCalledWith("whisper-model", expect.any(Function));

    // Emit progress event
    expect(onProgressCallback).not.toBeNull();
    onProgressCallback!({
      component: "whisper-model",
      file: "ggml-base.bin",
      doneBytes: 50,
      totalBytes: 100,
      stage: "downloading",
    });
    harness.render();

    const progressHtml = renderToStaticMarkup(harness.render());
    expect(progressHtml).toContain("50%");
    expect(progressHtml).toContain("Mengunduh…");

    // Complete install
    installDeferred.resolve();
    await harness.settle();
  });

  it("renders voice list with active voice badge, Pasang for uninstalled, and Pilih for installed", async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus));
    const setVoiceSpy = spyOn(api, "setVoice").mockResolvedValue({
      id: "en_US-amy-medium",
      params: { lengthScale: 1.0, noiseScale: 0.667, noiseW: 0.8 },
    });
    spies.push(setVoiceSpy);

    let changed = false;
    harness = hookHarness<ReactNode>(() => VoiceSection({ onChanged: () => { changed = true; } }));
    harness.render();
    await harness.settle();

    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("Indonesia · News");
    expect(html).toContain("Suara aktif");
    expect(html).toContain("English · Amy");
    expect(html).toContain("English · Lessac");

    const amyBtn = elements(harness.render()).find(
      (el) => el.props["aria-label"] === "Pilih suara English · Amy",
    );
    expect(amyBtn).toBeDefined();

    // Select Amy
    await (amyBtn!.props.onClick as () => Promise<void>)();
    expect(setVoiceSpy).toHaveBeenCalledWith("en_US-amy-medium");
    expect(changed).toBe(true);
  });

  it("updates sliders and saves params via setVoice", async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus));
    const setVoiceSpy = spyOn(api, "setVoice").mockResolvedValue({
      id: "id_ID-news_tts-medium",
      params: { lengthScale: 1.15, noiseScale: 0.667, noiseW: 0.8 },
    });
    spies.push(setVoiceSpy);

    harness = hookHarness<ReactNode>(() => VoiceSection({}));
    harness.render();
    await harness.settle();

    const speedInput = elements(harness.render()).find((el) => el.props.id === "slider-speed");
    expect(speedInput).toBeDefined();

    // Change speed slider
    (speedInput!.props.onChange as (e: unknown) => void)({ target: { value: "1.15" } });
    await harness.settle();

    expect(setVoiceSpy).toHaveBeenCalledWith("id_ID-news_tts-medium", {
      lengthScale: 1.15,
      noiseScale: 0.667,
      noiseW: 0.8,
    });

    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("1.15");
    expect(html).toContain("nilai lebih tinggi menghasilkan bicara yang lebih lambat");
  });

  it("imports a voice file via pickVoiceModel then voiceImport", async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus));
    const pickSpy = spyOn(api, "pickVoiceModel").mockResolvedValue("/home/user/my_voice.onnx");
    spies.push(pickSpy);
    const importSpy = spyOn(api, "voiceImport").mockResolvedValue("custom-my_voice");
    spies.push(importSpy);

    harness = hookHarness<ReactNode>(() => VoiceSection({}));
    harness.render();
    await harness.settle();

    const importBtn = elements(harness.render()).find(
      (el) => el.props["aria-label"] === "Impor suara",
    );
    expect(importBtn).toBeDefined();

    await (importBtn!.props.onClick as () => Promise<void>)();
    expect(pickSpy).toHaveBeenCalled();
    expect(importSpy).toHaveBeenCalledWith("/home/user/my_voice.onnx");
  });

  it("displays import error clearly when voiceImport fails", async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus));
    spies.push(spyOn(api, "pickVoiceModel").mockResolvedValue("/home/user/broken.onnx"));
    spies.push(spyOn(api, "voiceImport").mockRejectedValue(new Error("Berkas .onnx.json tidak ditemukan")));

    harness = hookHarness<ReactNode>(() => VoiceSection({}));
    harness.render();
    await harness.settle();

    const importBtn = elements(harness.render()).find(
      (el) => el.props["aria-label"] === "Impor suara",
    );
    await (importBtn!.props.onClick as () => Promise<void>)();
    await harness.settle();

    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("Berkas .onnx.json tidak ditemukan");
  });

  it("speaks Indonesian sample on 'Coba suara' and calls voiceStop on 'Hentikan'", async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus));
    const speakDeferred = deferred<void>();
    const speakSpy = spyOn(api, "voiceSpeak").mockReturnValue(speakDeferred.promise);
    spies.push(speakSpy);
    const stopSpy = spyOn(api, "voiceStop").mockResolvedValue(undefined);
    spies.push(stopSpy);

    harness = hookHarness<ReactNode>(() => VoiceSection({}));
    harness.render();
    await harness.settle();

    const cobaBtn = elements(harness.render()).find(
      (el) => el.props["aria-label"] === "Coba suara",
    );
    expect(cobaBtn).toBeDefined();

    // Click Coba suara
    void (cobaBtn!.props.onClick as () => Promise<void>)();
    await harness.settle();

    expect(speakSpy).toHaveBeenCalledWith(expect.stringContaining("Anchoa"));

    const hentikanBtn = elements(harness.render()).find(
      (el) => el.props["aria-label"] === "Hentikan suara",
    );
    expect(hentikanBtn).toBeDefined();

    // Click Hentikan
    await (hentikanBtn!.props.onClick as () => Promise<void>)();
    expect(stopSpy).toHaveBeenCalled();
  });

  it("renders note that voices are natural Piper neural voices and espeak is never used", async () => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus));

    harness = hookHarness<ReactNode>(() => VoiceSection({}));
    harness.render();
    await harness.settle();

    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("model neural Piper");
    expect(html).toContain("tidak pernah menggunakan espeak");
  });
});
