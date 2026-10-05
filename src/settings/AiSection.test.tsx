import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type AiRoles } from "../api";
import { elements, hookHarness, type HookHarness } from "../test/hookHarness";
import { AiSection } from "./AiSection";

describe("AiSection", () => {
  const spies: { mockRestore(): void }[] = [];
  let harness: HookHarness<ReactNode>;
  const config = { name: "9router", baseUrl: "http://127.0.0.1:20128/v1", hasKey: true };
  afterEach(() => { spies.forEach((s) => s.mockRestore()); spies.length = 0; harness?.dispose(); });
  const mount = async () => {
    const roles: AiRoles = {
      chat: { provider: "ollama", model: "local" }, recap: { provider: "ollama", model: "local" },
      journal: { provider: "ollama", model: "local" }, email: { provider: "ollama", model: "local" },
    };
    const status = spyOn(api, "aiProviderStatus").mockImplementation(async (provider) => provider === "custom"
      ? { available: true, models: ["remote"], error: null }
      : { available: false, models: [], error: "Ollama offline" });
    spies.push(status, spyOn(api, "aiRoles").mockResolvedValue(roles));
    spies.push(spyOn(api, "aiCustomConfig").mockResolvedValue(config));
    harness = hookHarness<ReactNode>(() => AiSection({})); harness.render(); await harness.settle();
    return status;
  };
  const control = (label: string) => elements(harness.render()).find((el) => el.props["aria-label"] === label)!;
  const button = (text: string) => elements(harness.render()).find((el) => el.type === "button" && el.props.children === text)!;
  const change = (label: string, value: string) => (control(label).props.onChange as (e: unknown) => void)({ target: { value } });
  const click = (text: string) => (button(text).props.onClick as () => void)();
  const openCustom = async () => { click("Kustom"); await harness.settle(); };

  it("keeps custom usable when Ollama offline and exposes provider-specific models", async () => {
    await mount(); await openCustom();
    expect(control("Nama penyedia").props.value).toBe("9router");
    expect(control("API key opsional").props.value).toBe("");
    change("Penyedia untuk Percakapan & aksi", "custom"); await harness.settle();
    expect(control("Model untuk Percakapan & aksi").props.disabled).toBeFalsy();
    const options = elements(control("Model untuk Percakapan & aksi").props.children as ReactNode).filter((el) => el.type === "option");
    expect(options.map((el) => el.props.value)).toContain("remote");
    expect(options.map((el) => el.props.value)).not.toContain("local");
  });

  it("saves metadata without sending or changing key or roles", async () => {
    await mount(); await openCustom();
    const save = spyOn(api, "saveAiCustom").mockResolvedValue({ ...config, name: "Router" }); spies.push(save);
    const key = spyOn(api, "setAiCustomKey"); spies.push(key);
    const role = spyOn(api, "setAiRole"); spies.push(role);
    change("Nama penyedia", "Router"); change("API key opsional", "new-secret"); await harness.settle();
    click("Simpan metadata"); await harness.settle();
    expect(save).toHaveBeenCalledWith("Router", config.baseUrl);
    expect(key).not.toHaveBeenCalled(); expect(role).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(harness.render())).toContain("Key tersedia");
  });

  it("changes and deletes key explicitly, clearing secret input", async () => {
    await mount(); await openCustom();
    const set = spyOn(api, "setAiCustomKey").mockResolvedValue(config); spies.push(set);
    const del = spyOn(api, "deleteAiCustomKey").mockResolvedValue({ ...config, hasKey: false }); spies.push(del);
    change("API key opsional", "secret"); await harness.settle(); click("Ganti key"); await harness.settle();
    expect(set).toHaveBeenCalledWith("secret"); expect(control("API key opsional").props.value).toBe("");
    click("Hapus key"); await harness.settle(); expect(del).toHaveBeenCalledTimes(1);
    expect(renderToStaticMarkup(harness.render())).toContain("Key tidak tersedia");
  });

  it("shows save failure without losing saved key status", async () => {
    await mount(); await openCustom();
    spies.push(spyOn(api, "saveAiCustom").mockRejectedValue(new Error("URL tidak valid")));
    click("Simpan metadata"); await harness.settle();
    expect(renderToStaticMarkup(harness.render())).toContain("URL tidak valid");
    expect(renderToStaticMarkup(harness.render())).toContain("Key tersedia");
  });

  it("locks journal and email providers while allowing local model changes", async () => {
    await mount();
    for (const label of ["Tanggapan jurnal", "Asisten email"]) {
      const picker = control(`Penyedia untuk ${label}`);
      expect(picker.props.disabled).toBe(true); expect(picker.props.value).toBe("ollama");
      expect(control(`Model untuk ${label}`).props.disabled).toBeFalsy();
    }
    const save = spyOn(api, "setAiRole").mockResolvedValue({ provider: "ollama", model: "other-local" }); spies.push(save);
    change("Model untuk Tanggapan jurnal", "other-local"); await harness.settle();
    expect(save).toHaveBeenCalledWith("journal", "ollama", "other-local");
  });
  it("disables recap configuration because no production recap consumer exists", async () => {
    await mount();
    expect(control("Penyedia untuk Rekap harian").props.disabled).toBe(true);
    expect(control("Model untuk Rekap harian").props.disabled).toBe(true);
    expect(renderToStaticMarkup(harness.render())).toContain("rekap harian belum memiliki pemrosesan AI");
  });

  it("saves selected provider and manual model ID, retaining it after listing failure", async () => {
    const status = await mount(); await openCustom();
    const save = spyOn(api, "setAiRole").mockResolvedValue({ provider: "custom", model: "manual-id" }); spies.push(save);
    change("Penyedia untuk Percakapan & aksi", "custom"); await harness.settle();
    const events: unknown[] = []; window.addEventListener("anchoa-ai-config-changed", (event) => events.push((event as CustomEvent).detail));
    change("ID model untuk Percakapan & aksi", "manual-id"); await harness.settle(); click("Simpan model Percakapan & aksi"); await harness.settle();
    expect(save).toHaveBeenCalledWith("chat", "custom", "manual-id");
    expect(events).toEqual([{ reset: true }]);
    status.mockResolvedValue({ available: false, models: [], error: "Autentikasi gagal" });
    click("Tes koneksi"); await harness.settle();
    expect(control("ID model untuk Percakapan & aksi").props.value).toBe("manual-id");
    expect(renderToStaticMarkup(harness.render())).toContain("Autentikasi gagal");
  });
});
