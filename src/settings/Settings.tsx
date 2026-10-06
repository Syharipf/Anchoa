import { getVersion } from "@tauri-apps/api/app";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type AiRoles,
  type AiStatus,
  type GithubStatus,
  type SyncStatus,
  type VoiceStatus,
} from "../api";
import { H1 } from "../shell/ui";
import { AboutSection } from "./AboutSection";
import { AiSection } from "./AiSection";
import { AvatarSection } from "./AvatarSection";
import { DataSection } from "./DataSection";
import { IntegrationsSection } from "./IntegrationsSection";
import { SettingsNav } from "./SettingsNav";
import { SyncSection } from "./SyncSection";
import { VoiceSection } from "./VoiceSection";
import { normalizeSection, type SettingsSection } from "./view";

export interface SettingsProps {
  readonly initialSection?: SettingsSection;
  readonly onSectionChange: (section: SettingsSection) => void;
  readonly onGithubChanged: () => void;
}

export function Settings({
  initialSection,
  onSectionChange,
  onGithubChanged,
}: Readonly<SettingsProps>) {
  const [section, setSection] = useState<SettingsSection>(() =>
    normalizeSection(initialSection),
  );
  const [version, setVersion] = useState("");
  const [ghStatus, setGhStatus] = useState<GithubStatus | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [aiRoles, setAiRoles] = useState<AiRoles | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const aiLoadId = useRef(0);
  const loadAi = useCallback(() => {
    const id = ++aiLoadId.current;
    api.aiStatus().then((status) => { if (id === aiLoadId.current) setAiStatus(status); }, () => {
      if (id === aiLoadId.current) setAiStatus({ available: false, models: [], error: "Gagal terhubung" });
    });
    api.aiRoles().then((roles) => { if (id === aiLoadId.current) setAiRoles(roles); }, () => { if (id === aiLoadId.current) setAiRoles(null); });
  }, []);

  const loadVoice = useCallback(() => {
    api.voiceStatus().then(setVoiceStatus, () => setVoiceStatus(null));
  }, []);

  const loadSync = useCallback(() => {
    api.syncStatus().then(setSyncStatus, () => setSyncStatus(null));
  }, []);
  useEffect(() => {
    getVersion().then(setVersion, () => setVersion(""));
    api.githubStatus().then(setGhStatus, () => setGhStatus(null));
    loadAi();
    loadVoice();
    loadSync();
  }, [loadAi, loadVoice, loadSync]);

  useEffect(() => {
    setSection(normalizeSection(initialSection));
  }, [initialSection]);

  const handleSectionChange = (next: SettingsSection) => {
    setSection(next);
    onSectionChange(next);
  };

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
          onSelect={handleSectionChange}
          statusContext={{
            githubConnected: ghStatus?.connected ?? false,
            version,
            aiStatus,
            aiChatModel: aiRoles?.chat.model,
            voiceStatus,
            syncStatus,
          }}
        />

        <div className="min-w-0">
          {section === "ai" && <AiSection onChanged={loadAi} />}
          {section === "avatar" && <AvatarSection />}
          {section === "suara" && <VoiceSection onChanged={loadVoice} />}
          {section === "data" && (
            <div className="flex flex-col gap-4">
              <SyncSection onChanged={loadSync} />
              <DataSection />
            </div>
          )}
          {section === "integrations" && (
            <IntegrationsSection onChanged={handleGithubChanged} />
          )}
          {section === "about" && <AboutSection version={version} />}
        </div>
      </div>
    </div>
  );
}
