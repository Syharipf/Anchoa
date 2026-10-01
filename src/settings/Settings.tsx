import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { api, type GithubStatus } from "../api";
import { H1 } from "../shell/ui";
import { AboutSection } from "./AboutSection";
import { ComingSection } from "./ComingSection";
import { DataSection } from "./DataSection";
import { IntegrationsSection } from "./IntegrationsSection";
import { SettingsNav } from "./SettingsNav";
import { normalizeSection, type SettingsSection } from "./view";

export interface SettingsProps {
  readonly initialSection?: SettingsSection;
  readonly onGithubChanged: () => void;
}

export function Settings({
  initialSection,
  onGithubChanged,
}: Readonly<SettingsProps>) {
  const [section, setSection] = useState<SettingsSection>(() =>
    normalizeSection(initialSection),
  );
  const [version, setVersion] = useState("");
  const [ghStatus, setGhStatus] = useState<GithubStatus | null>(null);

  useEffect(() => {
    getVersion().then(setVersion, () => setVersion("0.10.0"));
    api.githubStatus().then(setGhStatus, () => setGhStatus(null));
  }, []);

  useEffect(() => {
    if (initialSection) {
      setSection(normalizeSection(initialSection));
    }
  }, [initialSection]);

  const handleGithubChanged = () => {
    api.githubStatus().then(setGhStatus, () => setGhStatus(null));
    onGithubChanged();
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className={H1}>Pengaturan</h1>
        <span className="text-xs text-muted">
          Perangkat ini: Laptop Fedora · disimpan secara lokal
        </span>
      </div>

      <div className="grid grid-cols-[212px_minmax(0,1fr)] items-start gap-4">
        <SettingsNav
          current={section}
          onSelect={setSection}
          statusContext={{
            githubConnected: ghStatus?.connected ?? false,
            version,
          }}
        />

        <div className="min-w-0">
          {(section === "ai" || section === "avatar" || section === "suara") && (
            <ComingSection section={section} />
          )}
          {section === "data" && <DataSection />}
          {section === "integrations" && (
            <IntegrationsSection onChanged={handleGithubChanged} />
          )}
          {section === "about" && <AboutSection version={version} />}
        </div>
      </div>
    </div>
  );
}
