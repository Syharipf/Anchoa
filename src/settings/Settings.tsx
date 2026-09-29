import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { api, errorMessage, type DataPaths, type FolderKind } from "../api";
import { useToast } from "../shell/toast";
import { GithubSection } from "./GithubSection";
import { H1, H2, LABEL, PANEL, SECONDARY } from "../shell/ui";

export function Settings({ onGithubChanged }: Readonly<{ onGithubChanged: () => void }>) {
  const toast = useToast();
  const [paths, setPaths] = useState<DataPaths | null>(null);
  const [version, setVersion] = useState("");

  useEffect(() => {
    api.dataPaths().then(setPaths, (e) => toast(errorMessage(e), "error"));
    getVersion().then(setVersion);
  }, [toast]);

  async function backup() {
    try {
      toast(`Backup dibuat: ${await api.backupNow()}`);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  }

  const open = (kind: FolderKind) => api.openFolder(kind).catch((e) => toast(errorMessage(e), "error"));

  return (
    <div className="flex max-w-3xl flex-col gap-[18px]">
      <h1 className={H1}>Pengaturan</h1>
      <section className={`${PANEL} flex flex-col gap-3`}>
        <h2 className={H2}>Data</h2>
        <p className="m-0 break-all font-mono text-xs text-muted">{paths?.dataDir}</p>
        <div className="flex gap-2">
          <button onClick={() => void backup()} className={SECONDARY}>
            Backup sekarang
          </button>
          <button onClick={() => void open("backup")} className={SECONDARY}>
            Buka folder backup
          </button>
          <button onClick={() => void open("data")} className={SECONDARY}>
            Buka folder data
          </button>
        </div>
        <p className="m-0 text-xs text-muted">
          Backup harian dibuat otomatis saat aplikasi dibuka; 7 backup terbaru disimpan.
        </p>
      </section>
      <GithubSection onChanged={onGithubChanged} />
      <p className={LABEL}>Anchoa versi {version}</p>
    </div>
  );
}
