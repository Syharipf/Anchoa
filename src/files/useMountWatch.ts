import { useEffect } from "react";
import { api, type Place } from "../api";

/**
 * Mount detection works by polling the backend: `file_places` already re-reads
 * `/proc/mounts` and returns the current set of removable-media places. We
 * diff successive results and only fire the callback when the set actually
 * changes, pausing while the window is hidden so background tabs don't burn
 * CPU. No native dependency is required.
 */
export interface MountPoller {
  start: () => void;
  stop: () => void;
  /** Manually re-fetch and diff; useful after a tab gains focus. */
  tick: () => void;
}

export interface MountPollerOptions {
  readonly fetch: () => Promise<readonly Place[]>;
  readonly intervalMs: number;
  readonly onChange: (devices: readonly Place[]) => void;
  readonly document?: Pick<Document, "hidden" | "visibilityState"> | null;
  readonly onVisibilityChange?: (handler: (hidden: boolean) => void) => () => void;
}

function deviceKey(p: Place): string {
  return `${p.path}\u0000${p.name}`;
}

export function diffDevices(
  prev: readonly Place[],
  next: readonly Place[],
): { added: readonly Place[]; removed: readonly Place[]; changed: boolean } {
  const prevMap = new Map(prev.map((p) => [deviceKey(p), p]));
  const nextMap = new Map(next.map((p) => [deviceKey(p), p]));
  const added: Place[] = [];
  const removed: Place[] = [];
  for (const [key, p] of nextMap) if (!prevMap.has(key)) added.push(p);
  for (const [key, p] of prevMap) if (!nextMap.has(key)) removed.push(p);
  return { added, removed, changed: added.length > 0 || removed.length > 0 };
}

function defaultOnVisibilityChange(handler: (hidden: boolean) => void): () => void {
  if (typeof document === "undefined") return () => {};
  const onVis = () => handler(document.hidden);
  document.addEventListener("visibilitychange", onVis);
  return () => document.removeEventListener("visibilitychange", onVis);
}

export function createMountPoller(options: MountPollerOptions): MountPoller {
  const listen = options.onVisibilityChange ?? defaultOnVisibilityChange;
  let prev: readonly Place[] | null = null;
  let pending: Promise<readonly Place[]> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let stopped = true;
  let unbind: () => void = () => {};
  let hidden = false;

  /** Fetch, then diff against the last known set; only notify on real change. */
  async function poll() {
    // Skip while a poll is still in flight, so a slow backend cannot stack up.
    if (stopped || hidden || pending) return;
    pending = options.fetch().then(
      (next) => {
        const changed = prev !== null && diffDevices(prev, next).changed;
        prev = next;
        if (changed) options.onChange(next);
        return next;
      },
      () => {
        // Transient error: keep the previous baseline, do not notify.
        return prev ?? [];
      },
    );
    await pending;
    pending = null;
  }

  return {
    start: () => {
      if (!stopped) return;
      stopped = false;
      unbind = listen((isHidden) => {
        hidden = isHidden;
        if (!isHidden) poll();
      });
      if (options.document) hidden = options.document.hidden;
      poll(); // immediate first poll — baseline, no onChange emitted
      interval = setInterval(poll, options.intervalMs);
    },
    tick: poll,
    stop: () => {
      stopped = true;
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      unbind();
    },
  };
}

const MOUNT_POLL_MS = 5000;

/**
 * Watches for removable media appearing or disappearing. Polls the backend
 * every 5s, pauses when the window is hidden, and fires `onChange` only when
 * the set of devices actually changes. `onChange` must be stable.
 */
export function useMountWatch(onChange: (devices: readonly Place[]) => void): void {
  useEffect(() => {
    const poller = createMountPoller({
      fetch: () => api.filePlaces().then((res) => res.devices),
      intervalMs: MOUNT_POLL_MS,
      onChange,
    });
    poller.start();
    return () => poller.stop();
  }, [onChange]);
}