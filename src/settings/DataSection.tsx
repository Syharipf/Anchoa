import { useCallback, useEffect, useState } from "react";
import {
  api,
  errorMessage,
  type DataOverview,
  type FolderKind,
} from "../api";
import { formatBytes, relativeTime } from "../format";
import { useToast } from "../shell/toast";
import { H2, PANEL, SECONDARY } from "../shell/ui";
import { formatKind } from "./view";

export function DataSection() {
  const toast = useToast();
  const [overview, setOverview] = useState<DataOverview | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.dataOverview().then(setOverview, (e) => {
      toast(errorMessage(e), "error");
    });
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function backup() {
    setBusy(true);
    try {
      const path = await api.backupNow();
      toast(`Backup dibuat: ${path}`);
      load();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  }

  const open = (kind: FolderKind) =>
    api.openFolder(kind).catch((e) => toast(errorMessage(e), "error"));

  const now = Date.now();

  return (
    <div className="flex flex-col gap-4">
      {/* Storage and database overview */}
      <section className={`${PANEL} flex flex-col gap-3`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className={H2}>Database lokal</h2>
          <span className="text-xs text-muted">
            Sinkron antarperangkat menyusul (Fase 9)
          </span>
        </div>

        <p className="m-0 break-all font-mono text-xs text-muted">
          {overview?.dataDir ?? "Memuat lokasi data…"}
        </p>

        {overview && (
          <div className="flex flex-wrap items-baseline gap-2 text-sm text-ink">
            <span>Ukuran database:</span>
            <span className="font-mono font-medium text-accent">
              {formatBytes(overview.dbBytes)}
            </span>
            {overview.walBytes > 0 && (
              <span className="text-xs text-muted">
                (+ {formatBytes(overview.walBytes)} WAL)
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void backup()}
            disabled={busy}
            className={SECONDARY}
          >
            {busy ? "Membuat backup…" : "Backup sekarang"}
          </button>
          <button
            type="button"
            onClick={() => void open("backup")}
            className={SECONDARY}
          >
            Buka folder backup
          </button>
          <button
            type="button"
            onClick={() => void open("data")}
            className={SECONDARY}
          >
            Buka folder data
          </button>
        </div>

        <p className="m-0 text-xs text-muted">
          Backup harian dibuat otomatis saat aplikasi dibuka; 7 backup terbaru disimpan.
        </p>
      </section>

      {/* Item counts summary */}
      <section className={`${PANEL} flex flex-col gap-3`}>
        <h2 className={H2}>Ringkasan data</h2>
        {overview && overview.counts.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {overview.counts.map((c) => (
              <div
                key={c.kind}
                className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-xs"
              >
                <span className="text-muted">{formatKind(c.kind)}</span>
                <span className="font-mono font-semibold text-ink">
                  {c.count.toLocaleString("id-ID")}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 text-xs">
              <span className="text-muted">Sampah (terhapus)</span>
              <span className="font-mono font-semibold text-muted">
                {overview.trashed.toLocaleString("id-ID")}
              </span>
            </div>
          </div>
        ) : (
          <p className="m-0 text-xs text-muted">
            {overview ? "Belum ada item." : "Memuat ringkasan item…"}
          </p>
        )}
      </section>

      {/* Backup file list */}
      <section className={`${PANEL} flex flex-col gap-3`}>
        <div className="flex items-center justify-between">
          <h2 className={H2}>Berkas backup</h2>
          {overview && (
            <span className="text-xs text-muted">
              {overview.backups.length} berkas
            </span>
          )}
        </div>

        {overview && overview.backups.length > 0 ? (
          <div className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface-2">
            {overview.backups.map((b) => (
              <div
                key={b.name}
                className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
              >
                <span className="truncate font-mono text-ink">{b.name}</span>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-mono text-muted">
                    {formatBytes(b.bytes)}
                  </span>
                  <span className="text-muted">
                    {relativeTime(b.modifiedAt, now)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 text-xs text-muted">
            {overview ? "Belum ada berkas backup." : "Memuat berkas backup…"}
          </p>
        )}
      </section>
    </div>
  );
}
