import { api } from "../api";
import { H1, PRIMARY } from "./ui";

export function ErrorScreen({ path, message }: Readonly<{ path: string; message: string }>) {
  return (
    <div className="flex h-full items-center justify-center bg-canvas p-8">
      <div className="flex max-w-lg flex-col gap-4">
        <h1 className={H1}>Database could not be opened</h1>
        <p className="text-sm">{message}</p>
        <p className="break-all rounded-lg border border-line bg-surface p-2 font-mono text-xs">{path}</p>
        <p className="text-sm text-muted">
          This file was not modified. Check file permissions or restore from a backup folder, then restart the application.
        </p>
        <button
          onClick={() => void api.openFolder("data")}
          className={`${PRIMARY} self-start`}
        >
          Open data folder
        </button>
      </div>
    </div>
  );
}
