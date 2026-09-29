import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { api, errorMessage, type DataPaths, type FolderKind } from "../api";
import { useToast } from "../shell/toast";

const BUTTON = "rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800";

export function Settings() {
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
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-xl font-bold">Pengaturan</h1>
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Data</h2>
        <p className="break-all font-mono text-xs text-neutral-500">{paths?.dataDir}</p>
        <div className="flex gap-2">
          <button onClick={() => void backup()} className={BUTTON}>
            Backup sekarang
          </button>
          <button onClick={() => void open("backup")} className={BUTTON}>
            Buka folder backup
          </button>
          <button onClick={() => void open("data")} className={BUTTON}>
            Buka folder data
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          Backup harian dibuat otomatis saat aplikasi dibuka; 7 backup terbaru disimpan.
        </p>
      </section>
      <p className="text-sm text-neutral-500">Anchoa versi {version}</p>
    </div>
  );
}
