import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type AiRoles, type AiStatus } from "../api";
import { elements, hookHarness } from "../test/hookHarness";
import { AiSection } from "./AiSection";

describe("AiSection", () => {
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

  const mockOnlineAi = () => {
    const status: AiStatus = {
      available: true,
      models: ["qwen2.5:3b", "llama3.1:8b"],
      error: null,
    };
    const roles: AiRoles = {
      chat: { provider: "ollama", model: "qwen2.5:3b" },
      journal: { provider: "ollama", model: "qwen2.5:3b" },
      recap: { provider: "ollama", model: "qwen2.5:3b" },
      email: { provider: "ollama", model: "qwen2.5:3b" },
    };
    spies.push(spyOn(api, "aiStatus").mockResolvedValue(status));
    spies.push(spyOn(api, "aiRoles").mockResolvedValue(roles));
    return { status, roles };
  };

  const mockOfflineAi = () => {
    const status: AiStatus = {
      available: false,
      models: [],
      error: "Ollama belum berjalan di 127.0.0.1:11434",
    };
    const roles: AiRoles = {
      chat: { provider: "ollama", model: "qwen2.5:3b" },
      journal: { provider: "ollama", model: "qwen2.5:3b" },
      recap: { provider: "ollama", model: "qwen2.5:3b" },
      email: { provider: "ollama", model: "qwen2.5:3b" },
    };
    spies.push(spyOn(api, "aiStatus").mockResolvedValue(status));
    spies.push(spyOn(api, "aiRoles").mockResolvedValue(roles));
    return { status, roles };
  };

  it("renders Ollama status, base URL, and connected state when reachable", async () => {
    mockOnlineAi();
    harness = hookHarness<ReactNode>(() => AiSection({}));
    harness.render();
    await harness.settle();

    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("Ollama (Lokal)");
    expect(html).toContain("Terhubung");
    expect(html).toContain("http://127.0.0.1:11434");
    expect(html).toContain("2 model terdeteksi");
    expect(html).toContain("Tes koneksi");
  });

  it("renders offline warning and start command when Ollama is unreachable", async () => {
    mockOfflineAi();
    harness = hookHarness<ReactNode>(() => AiSection({}));
    harness.render();
    await harness.settle();

    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("Ollama mati");
    expect(html).toContain("sudo systemctl start ollama");
  });

  it("renders model pickers for chat, journal, recap, and email roles", async () => {
    mockOnlineAi();
    harness = hookHarness<ReactNode>(() => AiSection({}));
    harness.render();
    await harness.settle();

    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("Model per tugas");
    expect(html).toContain("Percakapan &amp; aksi");
    expect(html).toContain("Tanggapan jurnal");
    expect(html).toContain("Rekap harian");
    expect(html).toContain("Asisten email");
    expect(html).toContain("qwen2.5:3b");
    expect(html).toContain("llama3.1:8b");
  });

  it("renders third-party providers note and locked privacy toggle", async () => {
    mockOnlineAi();
    harness = hookHarness<ReactNode>(() => AiSection({}));
    harness.render();
    await harness.settle();

    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("OpenRouter");
    expect(html).toContain("belum tersedia");
    expect(html).not.toMatch(/fase|menyusul/i);
    expect(html).toContain("Privasi AI");
    expect(html).toContain("Jurnal hanya ke model lokal");
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("disabled");
  });

  it("calls setAiRole when a model is picked", async () => {
    mockOnlineAi();
    const setRoleSpy = spyOn(api, "setAiRole").mockResolvedValue({
      provider: "ollama",
      model: "llama3.1:8b",
    });
    spies.push(setRoleSpy);

    let changed = false;
    harness = hookHarness<ReactNode>(() =>
      AiSection({ onChanged: () => { changed = true; } }),
    );
    harness.render();
    await harness.settle();

    const selects = elements(harness.render()).filter((el) => el.type === "select");
    expect(selects.length).toBe(4);

    const chatSelect = selects[0];
    (chatSelect.props.onChange as (e: unknown) => void)({ target: { value: "llama3.1:8b" } });
    await harness.settle();

    expect(setRoleSpy).toHaveBeenCalledWith("chat", "ollama", "llama3.1:8b");
    expect(changed).toBe(true);
  });

  it("tests connection when 'Tes koneksi' button is clicked", async () => {
    mockOnlineAi();
    const testSpy = spyOn(api, "aiStatus").mockResolvedValue({
      available: true,
      models: ["qwen2.5:3b", "llama3.1:8b"],
      error: null,
    });
    spies.push(testSpy);

    harness = hookHarness<ReactNode>(() => AiSection({}));
    harness.render();
    await harness.settle();

    const buttons = elements(harness.render()).filter((el) => el.type === "button");
    const testBtn = buttons.find((b) => b.props.children === "Tes koneksi");
    expect(testBtn).toBeDefined();

    (testBtn!.props.onClick as () => void)();
    await harness.settle();

    expect(testSpy).toHaveBeenCalled();
    const html = renderToStaticMarkup(harness.render());
    expect(html).toContain("Koneksi berhasil: 2 model ditemukan");
  });
});
