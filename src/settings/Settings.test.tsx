import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as tauriApp from "@tauri-apps/api/app";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type DataOverview } from "../api";
import { deferred, elements, hookHarness } from "../test/hookHarness";
import { AboutSection } from "./AboutSection";
import { DataSection } from "./DataSection";
import { IntegrationsSection } from "./IntegrationsSection";
import { Settings } from "./Settings";
import { SettingsNav } from "./SettingsNav";
import { sectionStatus, THIRD_PARTY_LICENSES, type SettingsSection, type StatusContext } from "./view";

describe("SettingsNav", () => {
  it("renders 212px section nav with 6 sections and status lines", () => {
    const html = renderToStaticMarkup(
      <SettingsNav
        current="data"
        onSelect={() => {}}
        statusContext={{ githubConnected: true, version: "0.10.0" }}
      />,
    );
    expect(html).toContain("w-[212px]");
    expect(html).toContain("Asisten &amp; AI");
    expect(html).toContain("Avatar Live2D");
    expect(html).toContain("Suara");
    expect(html).toContain("Sinkron &amp; data");
    expect(html).toContain("Integrasi");
    expect(html).toContain("Tentang");

    expect(html).toContain("Statis");
    expect(html).toContain("Belum dipasang");
    expect(html).toContain("Lokal");
    expect(html).toContain("Terhubung");
    expect(html).toContain("v0.10.0");
    expect(html).toContain('aria-current="page"');
  });

  it("shows 'Belum terhubung' when GitHub is not connected", () => {
    const html = renderToStaticMarkup(
      <SettingsNav
        current="integrations"
        onSelect={() => {}}
        statusContext={{ githubConnected: false, version: "0.10.0" }}
      />,
    );
    expect(html).toContain("Belum terhubung");
  });

  it("shows 'Terhubung' or 'Perlu kunci' for data section when sync is connected", () => {
    const connectedHtml = renderToStaticMarkup(
      <SettingsNav
        current="data"
        onSelect={() => {}}
        statusContext={{
          syncStatus: {
            configured: true,
            signedIn: true,
            email: "a@b.id",
            lastSyncAt: null,
            lastError: null,
            bytesUsed: 0,
            quotaBytes: 400 * 1024 * 1024,
            needsUnlockKey: false,
            vaultExists: true,
          },
        }}
      />,
    );
    expect(connectedHtml).toContain("Terhubung");

    const lockedHtml = renderToStaticMarkup(
      <SettingsNav
        current="data"
        onSelect={() => {}}
        statusContext={{
          syncStatus: {
            configured: true,
            signedIn: true,
            email: "a@b.id",
            lastSyncAt: null,
            lastError: null,
            bytesUsed: 0,
            quotaBytes: 400 * 1024 * 1024,
            needsUnlockKey: true,
            vaultExists: true,
          },
        }}
      />,
    );
    expect(lockedHtml).toContain("Perlu kunci");
  });
});

describe("DataSection", () => {
  it("renders database, ringkasan data, and backup sections with buttons", () => {
    const html = renderToStaticMarkup(<DataSection />);
    expect(html).toContain("Database lokal");
    expect(html).toContain("Backup sekarang");
    expect(html).toContain("Buka folder backup");
    expect(html).toContain("Buka folder data");
    expect(html).toContain("Ringkasan data");
    expect(html).toContain("Berkas backup");
  });
});

describe("IntegrationsSection", () => {
  it("renders built GitHub and Email integrations without an SFTP placeholder", () => {
    const html = renderToStaticMarkup(<IntegrationsSection onChanged={() => {}} />);
    expect(html).toContain("GitHub");
    expect(html).toContain("Email");
    expect(html).not.toContain("SFTP");
    expect(html).not.toContain("Menyusul");
    expect(html).not.toContain("Tailscale");
  });
});

describe("AboutSection", () => {
  it("renders version, check update button, repo links, upgrade command, and all required licenses", () => {
    const html = renderToStaticMarkup(<AboutSection version="0.10.0" />);
    expect(html).toContain("v0.10.0");
    expect(html).toContain("Cek pembaruan");
    expect(html).toContain("Repositori GitHub");
    expect(html).toContain("Catatan Rilis");
    expect(html).toContain("sudo dnf upgrade anchoa");

    // Static third-party licence table:
    // Tauri MIT/Apache-2.0, React MIT, SQLite public domain, rusqlite MIT, jiff MIT/Unlicense,
    // ureq MIT/Apache-2.0, yt-dlp Unlicense, FFmpeg LGPL-2.1+, IBM Plex OFL-1.1, Space Grotesk OFL-1.1, JetBrains Mono OFL-1.1
    expect(html).toContain("Tauri");
    expect(html).toContain("MIT / Apache-2.0");
    expect(html).toContain("React");
    expect(html).toContain("MIT");
    expect(html).toContain("SQLite");
    expect(html).toContain("Public Domain");
    expect(html).toContain("rusqlite");
    expect(html).toContain("jiff");
    expect(html).toContain("MIT / Unlicense");
    expect(html).toContain("ureq");
    expect(html).toContain("yt-dlp");
    expect(html).toContain("Unlicense");
    expect(html).toContain("FFmpeg");
    expect(html).toContain("LGPL-2.1+");
    expect(html).toContain("IBM Plex");
    expect(html).toContain("Space Grotesk");
    expect(html).toContain("JetBrains Mono");
    expect(html).toContain("OFL-1.1");
  });
});

describe("Settings layout", () => {
  it("renders page header and default Data section", () => {
    const html = renderToStaticMarkup(
      <Settings initialSection="data" onSectionChange={() => {}} onGithubChanged={() => {}} />,
    );
    expect(html).toContain("Pengaturan");
    expect(html).toContain("Perangkat ini: Laptop Fedora");
    expect(html).toContain("w-[212px]");
    expect(html).toContain("Database lokal");
  });

  it("renders initial section when provided", () => {
    const html = renderToStaticMarkup(
      <Settings initialSection="about" onSectionChange={() => {}} onGithubChanged={() => {}} />,
    );
    expect(html).toContain("Lisensi pihak ketiga");
    expect(html).toContain("sudo dnf upgrade anchoa");
  });

  it("renders AiSection when initialSection is ai", () => {
    const html = renderToStaticMarkup(
      <Settings initialSection="ai" onSectionChange={() => {}} onGithubChanged={() => {}} />,
    );
    expect(html).toContain("Ollama (Lokal)");
    expect(html).toContain("Model per tugas");
    expect(html).toContain("Privasi AI");
  });
});

describe("Settings interactions", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let spies: { mockRestore: () => void }[] = [];
  afterEach(() => {
    harness?.dispose();
    spies.forEach((spy) => spy.mockRestore());
    spies = [];
  });

  function mockGithubStatus() {
    spies.push(spyOn(api, "githubStatus").mockResolvedValue({ connected: false, login: null }));
  }

  function settingsNav() {
    return elements(harness.render()).find((element) => element.type === SettingsNav)!;
  }

  it("reports section selection and follows subsequent navigation props", async () => {
    mockGithubStatus();
    spies.push(spyOn(tauriApp, "getVersion").mockResolvedValue("3.4.5"));
    let initialSection: SettingsSection | undefined = "data";
    const onSectionChange = mock(() => {});
    harness = hookHarness(() => Settings({ initialSection, onSectionChange, onGithubChanged: () => {} }));

    (settingsNav().props.onSelect as (section: SettingsSection) => void)("about");
    expect(settingsNav().props.current).toBe("about");
    expect(onSectionChange).toHaveBeenCalledTimes(1);
    expect(onSectionChange).toHaveBeenCalledWith("about");

    initialSection = "avatar";
    expect(settingsNav().props.current).toBe("avatar");
    initialSection = undefined;
    expect(settingsNav().props.current).toBe("data");
    expect(onSectionChange).toHaveBeenCalledTimes(1);
    await harness.settle();
  });

  it.each(["resolve", "reject"] as const)("uses only the loaded app version in Settings (%s)", async (result) => {
    mockGithubStatus();
    const version = deferred<string>();
    spies.push(spyOn(tauriApp, "getVersion").mockReturnValue(version.promise));
    harness = hookHarness(() => Settings({
      initialSection: "about", onSectionChange: () => {}, onGithubChanged: () => {},
    }));
    const context = () => settingsNav().props.statusContext as StatusContext;
    const aboutVersion = () => elements(harness.render()).find((element) => element.type === AboutSection)!.props.version;
    expect(sectionStatus("about", context())).toBe("…");
    expect(aboutVersion()).toBe("");

    if (result === "resolve") version.resolve("3.4.5");
    else version.reject(new Error("Version unavailable"));
    await harness.settle();
    expect(sectionStatus("about", context())).toBe(result === "resolve" ? "v3.4.5" : "…");
    expect(aboutVersion()).toBe(result === "resolve" ? "3.4.5" : "");
  });

  it.each([
    { counts: [], trashed: 1234, empty: false },
    { counts: [{ kind: "task", count: 2 }], trashed: 1234, empty: false },
    { counts: [], trashed: 0, empty: true },
  ])("renders the loaded data summary: %j", async ({ counts, trashed, empty }) => {
    const overview: DataOverview = { dataDir: "/data", dbBytes: 1024, walBytes: 0, counts: [...counts], trashed, backups: [] };
    spies.push(spyOn(api, "dataOverview").mockResolvedValue(overview));
    harness = hookHarness(DataSection);
    harness.render();
    await harness.settle();
    const html = renderToStaticMarkup(harness.render());
    expect(html.includes("Belum ada item.")).toBe(empty);
    expect(html.includes("Sampah (terhapus)")).toBe(!empty);
    if (trashed > 0) expect(html).toContain("1.234");
    if (counts.length > 0) expect(html).toContain("Tugas");
  });

  it.each(["resolve", "reject"] as const)("uses only the loaded app version in About (%s)", async (result) => {
    const version = deferred<string>();
    spies.push(spyOn(tauriApp, "getVersion").mockReturnValue(version.promise));
    harness = hookHarness(() => AboutSection({}));
    const markup = () => renderToStaticMarkup(harness.render());
    expect(markup()).not.toMatch(/v\d+\.\d+\.\d+/);
    expect(markup()).toContain("…");

    if (result === "resolve") version.resolve("v6.7.8");
    else version.reject(new Error("Version unavailable"));
    await harness.settle();
    if (result === "resolve") {
      expect(markup()).toContain("v6.7.8");
      expect(markup()).not.toContain("vv6.7.8");
    } else {
      expect(markup()).not.toMatch(/v\d+\.\d+\.\d+/);
    }
  });

  it("opens every third-party license or project link through the external-link API", async () => {
    const opening = spyOn(api, "openLink").mockResolvedValue(undefined);
    spies.push(opening);
    harness = hookHarness(() => AboutSection({ version: "3.4.5" }));
    const links = elements(harness.render()).filter((element) =>
      element.type === "button" && String(element.props["aria-label"]).startsWith("Buka lisensi atau situs "));
    expect(links).toHaveLength(THIRD_PARTY_LICENSES.length);
    for (const [index, link] of links.entries()) {
      const item = THIRD_PARTY_LICENSES[index];
      expect(new URL(item.url).protocol).toBe("https:");
      expect(link.props["aria-label"]).toContain(item.name);
      (link.props.onClick as () => void)();
      expect(opening).toHaveBeenLastCalledWith(item.url);
    }
    await harness.settle();
  });

  it("passes loaded syncStatus to SettingsNav", async () => {
    mockGithubStatus();
    spies.push(spyOn(tauriApp, "getVersion").mockResolvedValue("0.18.0"));
    spies.push(
      spyOn(api, "syncStatus").mockResolvedValue({
        configured: true,
        signedIn: true,
        email: "sync@example.test",
        lastSyncAt: 123456,
        lastError: null,
        bytesUsed: 1024,
        quotaBytes: 400 * 1024 * 1024,
        needsUnlockKey: false,
        vaultExists: true,
      }),
    );
    harness = hookHarness(() =>
      Settings({
        initialSection: "data",
        onSectionChange: () => {},
        onGithubChanged: () => {},
      }),
    );
    await harness.settle();
    const context = () => settingsNav().props.statusContext as StatusContext;
    expect(context().syncStatus?.signedIn).toBe(true);
    expect(context().syncStatus?.email).toBe("sync@example.test");
    expect(sectionStatus("data", context())).toBe("Terhubung");
  });
});
