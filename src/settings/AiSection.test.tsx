import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { isValidElement, type ReactNode } from "react";
import { api, type AiRoles } from "../api";
import { renderToStaticMarkup } from "react-dom/server";
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
  const buttonText = (node: ReactNode): string => {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(buttonText).join("");
    return isValidElement<{ children?: ReactNode }>(node) ? buttonText(node.props.children) : "";
  };
  const button = (text: string) => elements(harness.render()).find((el) => el.type === "button" && buttonText(el.props.children as ReactNode).startsWith(text))!;
  const change = (label: string, value: string) => (control(label).props.onChange as (e: unknown) => void)({ target: { value } });
  const click = (text: string) => (button(text).props.onClick as () => void)();
  const options = (label: string) => elements(control(label).props.children as ReactNode).filter((el) => el.type === "option");
  const openCustom = async () => { click("Custom"); await harness.settle(); };
  const loadModels = async (models: string[]) => {
    const load = spyOn(api, "aiCustomModels").mockResolvedValue(models); spies.push(load);
    change("Optional API key", "secret"); await harness.settle();
    click("Load models"); await harness.settle();
    return load;
  };

  it("matches the design structure of the Asisten & AI panel", async () => {
    await mount();
    const html = renderToStaticMarkup(harness.render());
    const headings = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((match) => match[1]);
    expect(headings).toEqual(["AI Providers", "Model assignments", "Usage this month", "AI Privacy"]);
    expect(html).toContain("Used for voice commands, summaries, and journal reflections");
  });

  it("keeps custom usable when Ollama offline and exposes provider-specific models", async () => {
    await mount();
    expect(renderToStaticMarkup(harness.render())).toContain("Ollama offline");
    await openCustom();
    expect(control("Provider name").props.value).toBe("9router");
    expect(control("Optional API key").props.value).toBe("");
    change("Provider for Chat & actions", "custom"); await harness.settle();
    const values = options("Model for Chat & actions").map((el) => el.props.value);
    expect(values).toContain("remote");
    expect(values).not.toContain("local");
  });

  it("loads models from the provider and selects one without typing an id", async () => {
    await mount(); await openCustom();
    const load = await loadModels(["vendor-b", "vendor-a"]);
    expect(load).toHaveBeenCalledWith(config.baseUrl, "secret");
    const quick = options("Models from provider").map((el) => el.props.value);
    expect(quick).toContain("vendor-a");
    const save = spyOn(api, "setAiRole").mockResolvedValue({ provider: "custom", model: "vendor-a" }); spies.push(save);
    change("Models from provider", "vendor-a"); await harness.settle();
    expect(save).toHaveBeenCalledWith("chat", "custom", "vendor-a");
    expect(control("Model ID for Chat & actions")).toBeUndefined();
  });

  it("shows a retryable error when loading models fails", async () => {
    await mount(); await openCustom();
    const load = spyOn(api, "aiCustomModels").mockRejectedValueOnce(new Error("AI provider authentication failed; check API key")); spies.push(load);
    change("Optional API key", "bad-secret"); await harness.settle();
    click("Load models"); await harness.settle();
    expect(renderToStaticMarkup(harness.render())).toContain("Failed to load models");
    load.mockResolvedValueOnce(["recovered"]); await harness.settle();
    click("Load models"); await harness.settle();
    expect(options("Models from provider").map((el) => el.props.value)).toContain("recovered");
    expect(renderToStaticMarkup(harness.render())).not.toContain("Failed to load models");
  });

  it("discards fetched models when the URL or key changes", async () => {
    await mount(); await openCustom();
    await loadModels(["vendor-a"]);
    expect(options("Models from provider").map((el) => el.props.value)).toContain("vendor-a");
    change("Custom Base URL", "http://127.0.0.1:20129/v1"); await harness.settle();
    expect(options("Models from provider").map((el) => el.props.value)).not.toContain("vendor-a");
    expect(control("Optional API key").props.value).toBe("secret");
  });

  it("keeps the load action disabled until a URL and key exist", async () => {
    await mount(); await openCustom();
    expect(button("Load models").props.disabled).toBe(true);
    change("Optional API key", "secret"); await harness.settle();
    expect(button("Load models").props.disabled).toBeFalsy();
  });

  it("saves metadata without sending or changing key or roles", async () => {
    await mount(); await openCustom();
    const save = spyOn(api, "saveAiCustom").mockResolvedValue({ ...config, name: "Router" }); spies.push(save);
    const key = spyOn(api, "setAiCustomKey"); spies.push(key);
    const role = spyOn(api, "setAiRole"); spies.push(role);
    change("Provider name", "Router"); change("Optional API key", "new-secret"); await harness.settle();
    click("Save metadata"); await harness.settle();
    expect(save).toHaveBeenCalledWith("Router", config.baseUrl);
    expect(key).not.toHaveBeenCalled(); expect(role).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(harness.render())).toContain("Key available");
  });

  it("changes and deletes key explicitly, clearing secret input", async () => {
    await mount(); await openCustom();
    const set = spyOn(api, "setAiCustomKey").mockResolvedValue(config); spies.push(set);
    const del = spyOn(api, "deleteAiCustomKey").mockResolvedValue({ ...config, hasKey: false }); spies.push(del);
    change("Optional API key", "secret"); await harness.settle(); click("Change key"); await harness.settle();
    expect(set).toHaveBeenCalledWith("secret"); expect(control("Optional API key").props.value).toBe("");
    click("Delete key"); await harness.settle(); expect(del).toHaveBeenCalledTimes(1);
    expect(renderToStaticMarkup(harness.render())).toContain("Key unavailable");
  });

  it("shows save failure without losing saved key status", async () => {
    await mount(); await openCustom();
    spies.push(spyOn(api, "saveAiCustom").mockRejectedValue(new Error("URL is not valid")));
    click("Save metadata"); await harness.settle();
    expect(renderToStaticMarkup(harness.render())).toContain("URL is not valid");
    expect(renderToStaticMarkup(harness.render())).toContain("Key available");
  });

  it("locks journal and email providers while allowing local model changes", async () => {
    await mount();
    for (const label of ["Journal reflections", "Email assistant"]) {
      const picker = control(`Provider for ${label}`);
      expect(picker.props.disabled).toBe(true); expect(picker.props.value).toBe("ollama");
      expect(control(`Model for ${label}`).props.disabled).toBeFalsy();
    }
    const save = spyOn(api, "setAiRole").mockResolvedValue({ provider: "ollama", model: "other-local" }); spies.push(save);
    change("Model for Journal reflections", "other-local"); await harness.settle();
    expect(save).toHaveBeenCalledWith("journal", "ollama", "other-local");
  });

  it("disables recap configuration because no production recap consumer exists", async () => {
    await mount();
    expect(control("Model for Daily recap").props.disabled).toBe(true);
    expect(control("Model for Daily recap").props.value).toBe("local");
  });

  it("saves the picked provider and model, retaining it after a failed refresh", async () => {
    const status = await mount(); await openCustom();
    const save = spyOn(api, "setAiRole").mockResolvedValue({ provider: "custom", model: "remote" }); spies.push(save);
    change("Provider for Chat & actions", "custom"); await harness.settle();
    const events: unknown[] = [];
    window.addEventListener("anchoa-ai-config-changed", (event) => events.push((event as CustomEvent).detail));
    change("Model for Chat & actions", "remote"); await harness.settle(); click("Save model for Chat & actions"); await harness.settle();
    expect(save).toHaveBeenCalledWith("chat", "custom", "remote");
    expect(events).toEqual([{ reset: true }]);
    status.mockResolvedValue({ available: false, models: [], error: "Authentication failed" });
    click("Test connection"); await harness.settle();
    expect(control("Model for Chat & actions").props.value).toBe("remote");
    expect(renderToStaticMarkup(harness.render())).toContain("Authentication failed");
  });
});