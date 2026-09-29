import { api } from "../api";
import { H1, PRIMARY } from "./ui";

export function ErrorScreen({ path, message }: Readonly<{ path: string; message: string }>) {
  return (
    <div className="flex h-full items-center justify-center bg-canvas p-8">
      <div className="flex max-w-lg flex-col gap-4">
        <h1 className={H1}>Database tidak bisa dibuka</h1>
        <p className="text-sm">{message}</p>
        <p className="break-all rounded-lg border border-line bg-surface p-2 font-mono text-xs">{path}</p>
        <p className="text-sm text-muted">
          File ini tidak diubah. Periksa izin file atau pulihkan dari folder backup, lalu buka ulang aplikasi.
        </p>
        <button
          onClick={() => void api.openFolder("data")}
          className={`${PRIMARY} self-start`}
        >
          Buka folder data
        </button>
      </div>
    </div>
  );
}
