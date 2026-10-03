import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import * as apiModule from "../api";
import { api, type SyncStatus } from "../api";
import { deferred, elements, hookHarness } from "../test/hookHarness";
import { passphraseProblem, SyncSection } from "./SyncSection";

const MB = 1024 * 1024;
const READY: SyncStatus = {
  configured: true, signedIn: true, email: "dewi@example.test", lastSyncAt: Date.now() - 5 * 60_000, lastError: null,
  bytesUsed: 12 * MB, quotaBytes: 400 * MB, needsUnlockKey: false, vaultExists: null,
};
const PASS = "frasa-sandi-panjang";

let current: SyncStatus;
let harness: ReturnType<typeof hookHarness<ReactNode>>;
const spies: { mockRestore: () => void }[] = [];
const spy = <T extends { mockRestore: () => void }>(s: T) => (spies.push(s), s);

beforeEach(() => {
  current = READY;
  spy(spyOn(api, "syncStatus").mockImplementation(async () => current));
  spy(spyOn(apiModule, "onSyncChanged").mockResolvedValue(() => {}));
});
afterEach(() => {
  harness?.dispose();
  spies.splice(0).forEach((s) => s.mockRestore());
});

async function mount() {
  harness = hookHarness(() => SyncSection());
  harness.render();
  await harness.settle();
}
const tree = () => elements(harness.render());
const textOf = (el: ReactElement<Record<string, unknown>>) =>
  [el.props.children].flat().filter((c) => typeof c === "string" || typeof c === "number").join("");
const texts = () => tree().map(textOf);
const button = (label: string) => {
  const found = tree().find((el) => el.type === "button" && textOf(el) === label);
  if (!found) throw new Error(`no button ${label}`);
  return found;
};
const click = async (label: string) => {
  await (button(label).props.onClick as () => unknown)();
  await harness.settle();
};
const inputs = () => tree().filter((el) => el.type === "input" && el.props.type !== "checkbox");
const type = (index: number, value: string) => (inputs()[index].props.onChange as (e: unknown) => void)({ target: { value } });
const tick = (checked: boolean) =>
  (tree().find((el) => el.type === "input" && el.props.type === "checkbox")!.props.onChange as (e: unknown) => void)({ target: { checked } });
const submit = async () => {
  await (tree().find((el) => el.type === "form")!.props.onSubmit as (e: unknown) => unknown)({ preventDefault: () => {} });
  await harness.settle();
};
const alerts = () => tree().filter((el) => el.props.role === "alert").map(textOf);

it("explains that sync is unavailable when not configured", async () => {
  current = { ...READY, configured: false, signedIn: false };
  await mount();
  expect(texts()).toContain("Sync belum tersedia di build ini.");
  expect(tree().some((el) => el.type === "button")).toBe(false);
});

it("signed out offers both providers and can cancel the wait", async () => {
  current = { ...READY, signedIn: false, email: null, needsUnlockKey: false };
  const login = deferred<void>();
  const signIn = spy(spyOn(api, "syncSignIn").mockReturnValue(login.promise));
  const cancel = spy(spyOn(api, "syncCancelSignIn").mockResolvedValue(undefined));
  await mount();
  expect(texts()).toContain("Masuk dengan Google");
  expect(texts()).toContain("Masuk dengan GitHub");
  void (button("Masuk dengan GitHub").props.onClick as () => unknown)();
  await harness.settle();
  expect(signIn).toHaveBeenCalledWith("github");
  expect(texts()).toContain("Menunggu login di browser…");
  await click("Batal");
  expect(cancel).toHaveBeenCalledTimes(1);
  login.reject("dibatalkan");
  await harness.settle();
  expect(texts()).toContain("Masuk dengan Google");
  expect(alerts()).toEqual([]);
});

it("creates a key: validates client-side, shows the recovery key once, clears it after Lanjut", async () => {
  current = { ...READY, needsUnlockKey: true, vaultExists: false };
  const create = spy(spyOn(api, "syncCreateKey").mockImplementation(async () => {
    current = READY;
    return { recoveryKey: "AAAA-BBBB-CCCC-DDDD" };
  }));
  await mount();
  type(0, "pendek");
  type(1, "pendek");
  await submit();
  expect(alerts()).toEqual(["Frasa sandi minimal 12 karakter."]);
  type(0, PASS);
  type(1, `${PASS}x`);
  await submit();
  expect(alerts()).toEqual(["Kedua frasa sandi harus sama."]);
  expect(create).not.toHaveBeenCalled();

  type(1, PASS);
  await submit();
  expect(create).toHaveBeenCalledWith(PASS);
  expect(texts()).toContain("AAAA-BBBB-CCCC-DDDD");
  expect(button("Lanjut").props.disabled).toBe(true);
  tick(true);
  expect(button("Lanjut").props.disabled).toBe(false);
  await click("Lanjut");
  expect(texts()).not.toContain("AAAA-BBBB-CCCC-DDDD");
  expect(texts()).toContain("Sinkronkan sekarang");
});

it("preserves displayed recovery key across sync-changed events", async () => {
  current = { ...READY, needsUnlockKey: true, vaultExists: false };
  let syncHandler: (() => void) | undefined;
  spy(spyOn(apiModule, "onSyncChanged").mockImplementation(async (handler) => {
    syncHandler = handler;
    return () => {};
  }));
  spy(spyOn(api, "syncCreateKey").mockImplementation(async () => {
    current = READY;
    return { recoveryKey: "AAAA-BBBB-CCCC-DDDD" };
  }));
  await mount();
  type(0, PASS);
  type(1, PASS);
  await submit();
  expect(texts()).toContain("AAAA-BBBB-CCCC-DDDD");

  expect(syncHandler).toBeDefined();
  syncHandler!();
  await harness.settle();

  expect(texts()).toContain("AAAA-BBBB-CCCC-DDDD");
});

it("copies the recovery key", async () => {
  current = { ...READY, needsUnlockKey: true, vaultExists: false };
  spy(spyOn(api, "syncCreateKey").mockResolvedValue({ recoveryKey: "KEY-1" }));
  const writeText = (text: string) => ((written = text), Promise.resolve());
  let written = "";
  const before = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText } } });
  try {
    await mount();
    type(0, PASS);
    type(1, PASS);
    await submit();
    await click("Salin");
    expect(written).toBe("KEY-1");
  } finally {
    if (before) Object.defineProperty(globalThis, "navigator", before);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

it("unlocks an existing key with one field", async () => {
  current = { ...READY, needsUnlockKey: true, vaultExists: true };
  const unlock = spy(spyOn(api, "syncUnlockKey").mockImplementation(async () => { current = READY; }));
  await mount();
  expect(inputs()).toHaveLength(1);
  expect(tree().some((el) => el.props.label === "Frasa sandi atau recovery key")).toBe(true);
  type(0, PASS);
  await submit();
  expect(unlock).toHaveBeenCalledWith(PASS);
  expect(texts()).toContain("Sinkronkan sekarang");
});

it("ready state shows account, last sync and usage", async () => {
  current = { ...READY, lastError: "jaringan putus" };
  await mount();
  expect(texts()).toContain("Masuk sebagai dewi@example.test");
  expect(texts()).toContain("Sinkron terakhir: 5 menit lalu");
  expect(alerts()).toEqual(["Sync terakhir gagal: jaringan putus"]);
  expect(texts()).toContain("12 MB dari 400 MB");
  expect(tree().find((el) => el.props.role === "progressbar")!.props["aria-valuenow"]).toBe(3);
  for (const label of ["Sinkronkan sekarang", "Ganti frasa sandi", "Matikan sync"]) expect(texts()).toContain(label);
});

it("shows a backend error", async () => {
  spy(spyOn(api, "syncNow").mockRejectedValue("server menolak"));
  await mount();
  await click("Sinkronkan sekarang");
  expect(alerts().join()).toContain("server menolak");
  expect(button("Sinkronkan sekarang").props.disabled).toBe(false);
});

it("disables buttons while an action runs", async () => {
  const run = deferred<apiModule.SyncReport>();
  spy(spyOn(api, "syncNow").mockReturnValue(run.promise));
  await mount();
  void (button("Sinkronkan sekarang").props.onClick as () => unknown)();
  await harness.settle();
  for (const label of ["Menyinkronkan…", "Ganti frasa sandi", "Matikan sync"]) expect(button(label).props.disabled).toBe(true);
  run.resolve({ pulled: 1, pushed: 2, pending: 0, bytesUsed: 0, quotaBytes: 0, stoppedByQuota: false });
  await harness.settle();
  expect(button("Sinkronkan sekarang").props.disabled).toBe(false);
  expect(texts()).toContain("Selesai: 2 terkirim, 1 diterima.");
});

it("changes the passphrase from a dialog after validating the new one", async () => {
  const change = spy(spyOn(api, "syncChangePassphrase").mockResolvedValue(undefined));
  await mount();
  await click("Ganti frasa sandi");
  expect(inputs()).toHaveLength(3);
  type(0, "lama");
  type(1, PASS);
  type(2, "beda");
  await submit();
  expect(change).not.toHaveBeenCalled();
  expect(alerts()).toEqual(["Kedua frasa sandi harus sama."]);
  type(2, PASS);
  await submit();
  expect(change).toHaveBeenCalledWith("lama", PASS);
  expect(tree().some((el) => el.props.title === "Ganti frasa sandi")).toBe(false);
  expect(texts()).toContain("Frasa sandi sudah diganti.");
});

it("turns sync off, optionally deleting the cloud copy", async () => {
  const out = spy(spyOn(api, "syncSignOut").mockImplementation(async () => { current = { ...READY, signedIn: false }; return { remoteRevoked: true }; }));
  await mount();
  await click("Matikan sync");
  tick(true);
  await (tree().filter((el) => el.type === "button" && textOf(el) === "Matikan sync").at(-1)!.props.onClick as () => unknown)();
  await harness.settle();
  expect(out).toHaveBeenCalledWith(true);
  expect(texts()).toContain("Masuk dengan Google");
});

it("warns when remote revocation is unconfirmed during sign out", async () => {
  spy(spyOn(api, "syncSignOut").mockImplementation(async () => { current = { ...READY, signedIn: false }; return { remoteRevoked: false }; }));
  await mount();
  await click("Matikan sync");
  await (tree().filter((el) => el.type === "button" && textOf(el) === "Matikan sync").at(-1)!.props.onClick as () => unknown)();
  await harness.settle();
  expect(texts().some((t) => t.includes("pencabutan sesi di server tidak dapat dikonfirmasi"))).toBe(true);
});

it("passphraseProblem accepts 12 characters that match", () => {
  expect(passphraseProblem("123456789012", "123456789012")).toBeNull();
});
