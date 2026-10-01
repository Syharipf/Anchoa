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

  it("offers Pasang for the active voice when it is not installed yet", async () => {
    const fresh: VoiceStatus = {
      ...baseVoiceStatus,
      voices: baseVoiceStatus.voices.map((v) => (v.id === "id_ID-news_tts-medium" ? { ...v, installed: false } : v)),
    };
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(fresh));
    harness = hookHarness<ReactNode>(() => VoiceSection({ onChanged: () => {} }));
    harness.render();
    await harness.settle();
    const install = elements(harness.render()).find(
      (el) => el.props["aria-label"] === "Pasang suara Indonesia · News",
    );
    expect(install).toBeDefined();
    expect(renderToStaticMarkup(harness.render())).not.toContain("Suara aktif");
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
    expect(setVoiceSpy).not.toHaveBeenCalled();
    harness.runTimers();
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

  const button = (label: string) => elements(harness!.render()).find(
    (el) => el.props["aria-label"] === label,
  )!;
  const slider = (id: string) => elements(harness!.render()).find((el) => el.props.id === id)!;
  const change = (id: string, value: string) =>
    (slider(id).props.onChange as (e: unknown) => void)({ target: { value } });
  const mount = async () => {
    harness = hookHarness<ReactNode>(() => VoiceSection({}));
    harness.render();
    await harness.settle();
  };

  it.each(["selection", "slider"])("preserves a newer %s when an installation status refresh finishes late", async (edit) => {
    const refresh = deferred<VoiceStatus>();
    spies.push(spyOn(api, "voiceStatus").mockResolvedValueOnce(baseVoiceStatus).mockReturnValue(refresh.promise),
      spyOn(api, "voiceInstall").mockResolvedValue(undefined),
      spyOn(api, "setVoice").mockImplementation(async (id, params) => ({ id, params: params ?? baseVoiceStatus.settings.params })));
    await mount();
    const installing = (button("Pasang suara English · Lessac").props.onClick as () => Promise<void>)();
    await harness!.settle();
    if (edit === "selection") await (button("Pilih suara English · Amy").props.onClick as () => Promise<void>)();
    else change("slider-speed", "1.25");
    refresh.resolve(baseVoiceStatus);
    await installing;
    if (edit === "selection") {
      expect(button("Pilih suara Indonesia · News")).toBeDefined();
      expect(button("Pilih suara English · Amy")).toBeUndefined();
    } else expect(slider("slider-speed").props.value).toBe(1.25);
  });

  it.each([false, true])("ignores out-of-order selections (older request fails: %s)", async (fails) => {
    const old = deferred<typeof baseVoiceStatus.settings>();
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus),
      spyOn(api, "setVoice").mockReturnValueOnce(old.promise).mockResolvedValue(baseVoiceStatus.settings));
    await mount();
    const first = (button("Pilih suara English · Amy").props.onClick as () => Promise<void>)();
    await (button("Pilih suara Indonesia · News").props.onClick as () => Promise<void>)();
    if (fails) old.reject(new Error("Stale failure"));
    else old.resolve({ id: "en_US-amy-medium", params: { lengthScale: 1.3, noiseScale: 0.5, noiseW: 0.6 } });
    await first;
    expect(button("Pilih suara English · Amy")).toBeDefined();
    expect(slider("slider-speed").props.value).toBe(1);
    expect(renderToStaticMarkup(harness!.render())).not.toContain("Stale failure");
  });

  it("debounces rapid slider edits and ignores older save results", async () => {
    const old = deferred<typeof baseVoiceStatus.settings>();
    const save = spyOn(api, "setVoice").mockReturnValueOnce(old.promise)
      .mockImplementation(async (id, params) => ({ id, params: params! }));
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus), save);
    await mount();
    const timer = spyOn(window, "setTimeout");
    spies.push(timer);
    change("slider-speed", "1.1");
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 300);
    harness!.runTimers();
    await harness!.settle();
    change("slider-speed", "1.15");
    change("slider-speed", "1.25");
    change("slider-expression", "0.75");
    expect(save).toHaveBeenCalledTimes(1);
    harness!.runTimers();
    await harness!.settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(baseVoiceStatus.settings.id, {
      lengthScale: 1.25, noiseScale: 0.75, noiseW: 0.8,
    });
    old.resolve({ id: baseVoiceStatus.settings.id, params: { lengthScale: 1.1, noiseScale: 0.667, noiseW: 0.8 } });
    await harness!.settle();
    expect(slider("slider-speed").props.value).toBe(1.25);
    expect(slider("slider-expression").props.value).toBe(0.75);
  });

  it("preserves slider edits made before a selection result and cancels a pending save on unmount", async () => {
    const selection = deferred<typeof baseVoiceStatus.settings>();
    const save = spyOn(api, "setVoice").mockReturnValue(selection.promise);
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus), save);
    await mount();
    const selecting = (button("Pilih suara English · Amy").props.onClick as () => Promise<void>)();
    change("slider-speed", "1.2");
    selection.resolve({ id: "en_US-amy-medium", params: baseVoiceStatus.settings.params });
    await selecting;
    expect(slider("slider-speed").props.value).toBe(1.2);
    harness!.dispose();
    harness!.runTimers();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("records a microphone test and shows its transcript without sending or speaking", async () => {
    const transcript = deferred<string>();
    const start = spyOn(api, "voiceRecordStart").mockResolvedValue(undefined);
    const stop = spyOn(api, "voiceRecordStop").mockReturnValue(transcript.promise);
    const send = spyOn(api, "assistantSend");
    const speak = spyOn(api, "voiceSpeak");
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus), start, stop, send, speak);
    await mount();
    await (button("Uji mikrofon").props.onClick as () => Promise<void>)();
    expect(start).toHaveBeenCalledTimes(1);
    const stopping = (button("Hentikan rekaman uji").props.onClick as () => Promise<void>)();
    expect(button("Uji mikrofon").props.disabled).toBe(true);
    transcript.resolve("Tes mikrofon berhasil");
    await stopping;
    expect(renderToStaticMarkup(harness!.render())).toContain("Tes mikrofon berhasil");
    expect(stop).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it.each(["pwRecord", "whisper", "whisperModel"])("shows the missing microphone test component: %s", async (component) => {
    const status = { ...baseVoiceStatus, [component]: component === "whisper" ? null : false };
    const start = spyOn(api, "voiceRecordStart").mockResolvedValue(undefined);
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(status), start);
    await mount();
    const missingLabels = { pwRecord: "pw-record", whisper: "whisper.cpp", whisperModel: "model Whisper Base" };
    expect(renderToStaticMarkup(harness!.render())).toContain(`Uji mikrofon memerlukan: ${missingLabels[component as keyof typeof missingLabels]}`);
    expect(button("Uji mikrofon").props.disabled).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });

  it.each([false, true])("stops a microphone test on unmount (start pending: %s)", async (pending) => {
    const start = deferred<void>();
    const stop = spyOn(api, "voiceRecordStop").mockResolvedValue("Ignored");
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus),
      spyOn(api, "voiceRecordStart").mockReturnValue(start.promise), stop);
    await mount();
    const testing = (button("Uji mikrofon").props.onClick as () => Promise<void>)();
    if (!pending) { start.resolve(); await testing; }
    harness!.dispose();
    if (pending) { start.resolve(); await testing; }
    expect(stop).toHaveBeenCalledTimes(1);
  });


  it("preserves a selection when a refresh started during its save finishes after the save", async () => {
    const selection = deferred<typeof baseVoiceStatus.settings>();
    const refresh = deferred<VoiceStatus>();
    spies.push(spyOn(api, "voiceStatus").mockResolvedValueOnce(baseVoiceStatus).mockReturnValue(refresh.promise),
      spyOn(api, "setVoice").mockReturnValue(selection.promise),
      spyOn(api, "voiceInstall").mockResolvedValue(undefined));
    await mount();
    const selecting = (button("Pilih suara English · Amy").props.onClick as () => Promise<void>)();
    const installing = (button("Pasang suara English · Lessac").props.onClick as () => Promise<void>)();
    await harness!.settle();
    selection.resolve({ id: "en_US-amy-medium", params: { lengthScale: 1.1, noiseScale: 0.5, noiseW: 0.7 } });
    await selecting;
    refresh.resolve(baseVoiceStatus);
    await installing;
    expect(button("Pilih suara Indonesia · News")).toBeDefined();
    expect(slider("slider-speed").props.value).toBe(1.1);
  });

  it("keeps the newest installation status when refreshes return out of order", async () => {
    const older = deferred<VoiceStatus>();
    const newer = deferred<VoiceStatus>();
    const missingPiper = { ...baseVoiceStatus, piper: false };
    spies.push(spyOn(api, "voiceStatus").mockResolvedValueOnce(missingPiper)
      .mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise),
      spyOn(api, "voiceInstall").mockResolvedValue(undefined));
    await mount();
    const first = (button("Pasang Piper").props.onClick as () => Promise<void>)();
    await harness!.settle();
    const second = (button("Pasang suara English · Lessac").props.onClick as () => Promise<void>)();
    await harness!.settle();
    newer.resolve(baseVoiceStatus);
    await second;
    older.resolve(missingPiper);
    await first;
    expect(button("Pasang Piper")).toBeUndefined();
  });

  it("accepts fresh settings after StrictMode's cleanup when there are no pending edits", async () => {
    const updated = {
      ...baseVoiceStatus,
      settings: { ...baseVoiceStatus.settings, params: { ...baseVoiceStatus.settings.params, lengthScale: 1.2 } },
    };
    spies.push(spyOn(api, "voiceStatus").mockResolvedValueOnce(baseVoiceStatus)
      .mockResolvedValueOnce(baseVoiceStatus).mockResolvedValue(updated),
      spyOn(api, "voiceInstall").mockResolvedValue(undefined));
    await mount();
    harness!.replayEffects();
    await harness!.settle();
    await (button("Pasang suara English · Lessac").props.onClick as () => Promise<void>)();
    expect(slider("slider-speed").props.value).toBe(1.2);
  });

  it("allows the microphone test with STT installed even when playback and Piper are missing", async () => {
    const start = spyOn(api, "voiceRecordStart").mockResolvedValue(undefined);
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue({ ...baseVoiceStatus, pwPlay: false, piper: false }),
      start, spyOn(api, "voiceRecordStop").mockResolvedValue("Microphone works"));
    await mount();
    expect(button("Uji mikrofon").props.disabled).toBe(false);
    expect(button("Coba suara").props.disabled).toBe(true);
    await (button("Uji mikrofon").props.onClick as () => Promise<void>)();
    await (button("Hentikan rekaman uji").props.onClick as () => Promise<void>)();
    expect(renderToStaticMarkup(harness!.render())).toContain("Microphone works");
  });

  it.each([false, true])("shows a microphone transcription error or empty result (failure: %s)", async (fails) => {
    spies.push(spyOn(api, "voiceStatus").mockResolvedValue(baseVoiceStatus),
      spyOn(api, "voiceRecordStart").mockResolvedValue(undefined),
      fails ? spyOn(api, "voiceRecordStop").mockRejectedValue(new Error("Mikrofon tidak tersedia"))
        : spyOn(api, "voiceRecordStop").mockResolvedValue("  "));
    await mount();
    await (button("Uji mikrofon").props.onClick as () => Promise<void>)();
    await (button("Hentikan rekaman uji").props.onClick as () => Promise<void>)();
    expect(renderToStaticMarkup(harness!.render())).toContain(fails ? "Mikrofon tidak tersedia" : "Tidak ada ucapan yang terdeteksi");
    expect(button("Uji mikrofon").props.disabled).toBe(false);
  });

});
