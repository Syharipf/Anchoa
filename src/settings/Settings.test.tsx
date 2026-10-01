import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AboutSection } from "./AboutSection";
import { ComingSection } from "./ComingSection";
import { DataSection } from "./DataSection";
import { IntegrationsSection } from "./IntegrationsSection";
import { Settings } from "./Settings";
import { SettingsNav } from "./SettingsNav";
import { ComingSoon } from "../shell/ComingSoon";
import { pageInfo } from "../shell/nav";

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

    expect(html).toContain("Menyusul");
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
});

describe("ComingSection", () => {
  it("renders Asisten & AI coming soon notice", () => {
    const html = renderToStaticMarkup(<ComingSection section="ai" />);
    expect(html).toContain("Asisten &amp; AI");
    expect(html).toContain("Menyusul (Fase 5)");
    expect(html).toContain("Anthropic");
  });

  it("renders Avatar Live2D coming soon notice", () => {
    const html = renderToStaticMarkup(<ComingSection section="avatar" />);
    expect(html).toContain("Avatar Live2D");
    expect(html).toContain("Live2D Cubism");
  });

  it("renders Suara coming soon notice", () => {
    const html = renderToStaticMarkup(<ComingSection section="suara" />);
    expect(html).toContain("Suara");
    expect(html).toContain("whisper.cpp");
    expect(html).toContain("Piper");
  });
});

describe("DataSection", () => {
  it("renders database, ringkasan data, and backup sections with buttons", () => {
    const html = renderToStaticMarkup(<DataSection />);
    expect(html).toContain("Database lokal");
    expect(html).toContain("Sinkron antarperangkat menyusul (Fase 9)");
    expect(html).toContain("Backup sekarang");
    expect(html).toContain("Buka folder backup");
    expect(html).toContain("Buka folder data");
    expect(html).toContain("Ringkasan data");
    expect(html).toContain("Berkas backup");
  });
});

describe("IntegrationsSection", () => {
  it("renders GitHub section and SFTP upcoming card", () => {
    const html = renderToStaticMarkup(<IntegrationsSection onChanged={() => {}} />);
    expect(html).toContain("GitHub");
    expect(html).toContain("Laptop dari HP (SFTP)");
    expect(html).toContain("Menyusul");
    expect(html).toContain("Tailscale");
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
      <Settings initialSection="data" onGithubChanged={() => {}} />,
    );
    expect(html).toContain("Pengaturan");
    expect(html).toContain("Perangkat ini: Laptop Fedora");
    expect(html).toContain("w-[212px]");
    expect(html).toContain("Database lokal");
  });

  it("renders initial section when provided", () => {
    const html = renderToStaticMarkup(
      <Settings initialSection="about" onGithubChanged={() => {}} />,
    );
    expect(html).toContain("Lisensi pihak ketiga");
    expect(html).toContain("sudo dnf upgrade anchoa");
  });
});

describe("ComingSoon with sensible settings navigation", () => {
  it("renders 'Buka Pengaturan' for email and profil", () => {
    const emailInfo = pageInfo("email");
    const htmlEmail = renderToStaticMarkup(
      <ComingSoon page={emailInfo} onOpenSettings={() => {}} />,
    );
    expect(htmlEmail).toContain("Buka Pengaturan");

    const profilInfo = pageInfo("profil");
    const htmlProfil = renderToStaticMarkup(
      <ComingSoon page={profilInfo} onOpenSettings={() => {}} />,
    );
    expect(htmlProfil).toContain("Buka Pengaturan");
  });
});
