import { describe, expect, it, mock } from "bun:test";
import { createMountPoller, diffDevices } from "./useMountWatch";
import type { Place } from "../api";

function place(path: string, name: string): Place {
  return { name, path, icon: "drive" };
}

describe("diffDevices", () => {
  it("reports no changes for identical sets", () => {
    const a = [place("/a", "A")];
    const b = [place("/a", "A")];
    expect(diffDevices(a, b).changed).toBe(false);
  });

  it("reports added and removed entries", () => {
    const a = [place("/a", "A"), place("/b", "B")];
    const b = [place("/a", "A"), place("/c", "C")];
    const diff = diffDevices(a, b);
    expect(diff.added.map((p) => p.path)).toEqual(["/c"]);
    expect(diff.removed.map((p) => p.path)).toEqual(["/b"]);
    expect(diff.changed).toBe(true);
  });

  it("ignores the order of devices", () => {
    const a = [place("/a", "A"), place("/b", "B")];
    const b = [place("/b", "B"), place("/a", "A")];
    expect(diffDevices(a, b).changed).toBe(false);
  });
});

describe("createMountPoller", () => {
  it("fetches immediately on start and calls onChange only when devices actually change", async () => {
    let calls = 0;
    const fetch = mock(async () => {
      calls += 1;
      return calls === 1 ? [place("/a", "A")] : [place("/a", "A"), place("/b", "B")];
    });
    const seen: Place[][] = [];
    const onChange = mock((next: readonly Place[]) => {
      seen.push([...next]);
    });
    const poller = createMountPoller({
      fetch,
      intervalMs: 10_000,
      onChange,
      document: { hidden: false, visibilityState: "visible" as DocumentVisibilityState },
      onVisibilityChange: () => () => {},
    });
    poller.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(seen).toEqual([]); // first poll = baseline, no change yet
    poller.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(2);
    expect(seen).toEqual([[place("/a", "A"), place("/b", "B")]]);
    poller.stop();
  });

  it("does not call onChange when successive fetches return the same devices", async () => {
    const fetch = mock(async () => [place("/a", "A")]);
    const onChange = mock(() => {});
    const poller = createMountPoller({
      fetch,
      intervalMs: 10_000,
      onChange,
      document: { hidden: false, visibilityState: "visible" as DocumentVisibilityState },
      onVisibilityChange: () => () => {},
    });
    poller.start();
    await Promise.resolve();
    await Promise.resolve();
    poller.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
    poller.stop();
  });

  it("does not call onChange when fetch rejects", async () => {
    const fetch = mock(async () => {
      throw new Error("backend down");
    });
    const onChange = mock(() => {});
    const poller = createMountPoller({
      fetch,
      intervalMs: 10_000,
      onChange,
      document: { hidden: false, visibilityState: "visible" as DocumentVisibilityState },
      onVisibilityChange: () => () => {},
    });
    poller.start();
    await Promise.resolve();
    await Promise.resolve();
    poller.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(onChange).not.toHaveBeenCalled();
    poller.stop();
  });

  it("pauses polling when the document is hidden and resumes when it becomes visible", async () => {
    let calls = 0;
    const fetch = mock(async () => {
      calls += 1;
      return [place("/a", "A"), place("/b", `B${calls}`)];
    });
    const onChange = mock(() => {});
    const doc = { hidden: false, visibilityState: "visible" as DocumentVisibilityState };
    const listeners: Array<(hidden: boolean) => void> = [];
    const unbind = mock(() => {
      listeners.length = 0;
    });
    const poller = createMountPoller({
      fetch,
      intervalMs: 10_000,
      onChange,
      document: doc,
      onVisibilityChange: (handler) => {
        listeners.push(handler);
        return unbind;
      },
    });
    poller.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(listeners.length).toBe(1);

    doc.hidden = true;
    listeners[0]?.(true);
    poller.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(1); // tick while hidden is ignored

    doc.hidden = false;
    listeners[0]?.(false);
    poller.tick();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(2); // resumes on visible
    poller.stop();
    expect(unbind).toHaveBeenCalled();
  });

  it("stops the interval and unbinds the visibility listener on stop", () => {
    const fetch = mock(async () => []);
    const onChange = mock(() => {});
    const unbind = mock(() => {});
    const poller = createMountPoller({
      fetch,
      intervalMs: 10_000,
      onChange,
      onVisibilityChange: () => unbind,
    });
    poller.start();
    poller.stop();
    expect(unbind).toHaveBeenCalledTimes(1);
  });
});
