import { useEffect, useState } from "react";
import { api, errorMessage, type Listing, type Place } from "../api";

/** Returns true when a path refers to an rclone remote (`rclone:` prefix). */
export function isRemotePath(path: string): boolean {
  return path.startsWith("rclone:");
}

/** Normalise a remote path so the TS side matches Rust's
 *  `normalize_remote_target`. Accepts `rclone:name:sub/dir`, trims stray
 *  slashes, and returns the canonical `rclone:name:sub` (or `rclone:name:`). */
export function normalizeRemoteTarget(path: string): string {
  const trimmed = path.trim();
  const rest = trimmed.replace(/^rclone:/, "");
  if (!rest) return "rclone:";
  const colonIdx = rest.indexOf(":");
  const name = colonIdx === -1 ? rest : rest.slice(0, colonIdx);
  const sub = (colonIdx === -1 ? "" : rest.slice(colonIdx + 1))
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  return sub ? `rclone:${name}:${sub}` : `rclone:${name}:`;
}

/** Remote paths are listed by rclone; local paths go through the path guard. */
export function listFolder(path: string, hidden: boolean): Promise<Listing> {
  return isRemotePath(path)
    ? api.listRemote(normalizeRemoteTarget(path), hidden)
    : api.listDir(path, hidden);
}

/** True when `path` is `root` itself or lies inside it. */
export function isWithin(path: string, root: string): boolean {
  if (!root) return false;
  const base = root.endsWith("/") ? root : `${root}/`;
  return path === root || path.startsWith(base);
}

/** Result of the remote-detection hook. */
export type UseRemotesResult = {
  available: boolean;
  /** `rclone version` first line, or null. */
  version: string | null;
  remotes: Place[];
  mounts: Place[];
  /** Install hint when rclone is missing, or the detection error. */
  hint: string | null;
  loading: boolean;
};

/** Lists remote backends once on mount. A missing `rclone` binary is a
 *  normal state: the backend answers `available: false` with an install hint. */
export function useRemotes(): UseRemotesResult {
  const [state, setState] = useState<UseRemotesResult>({
    available: false,
    version: null,
    remotes: [],
    mounts: [],
    hint: null,
    loading: true,
  });

  useEffect(() => {
    let active = true;
    api.fileRemotes().then(
      (res) => {
        if (!active) return;
        setState({ ...res, loading: false });
      },
      (e) => {
        if (!active) return;
        setState((prev) => ({ ...prev, hint: errorMessage(e), loading: false }));
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return state;
}
