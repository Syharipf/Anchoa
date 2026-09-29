import { api } from "../api";

export function ErrorScreen({ path, message }: { path: string; message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-lg flex-col gap-4">
        <h1 className="text-xl font-bold">Database tidak bisa dibuka</h1>
        <p className="text-sm">{message}</p>
        <p className="break-all rounded bg-neutral-100 p-2 font-mono text-xs dark:bg-neutral-900">{path}</p>
        <p className="text-sm text-neutral-500">
          File ini tidak diubah. Periksa izin file atau pulihkan dari folder backup, lalu buka ulang aplikasi.
        </p>
        <button
          onClick={() => void api.openFolder("data")}
          className="self-start rounded-md bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-700"
        >
          Buka folder data
        </button>
      </div>
    </div>
  );
}
