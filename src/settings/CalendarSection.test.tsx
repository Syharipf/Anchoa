import { afterEach, expect, it, mock, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api, type CalendarStatus } from "../api";
import { deferred, elements, hookHarness, type HookHarness } from "../test/hookHarness";
import { CalendarSection } from "./CalendarSection";

let harness: HookHarness<ReactNode>;
const spies: { mockRestore: () => void }[] = [];
afterEach(() => { harness?.dispose(); spies.splice(0).forEach((spy) => spy.mockRestore()); });

const DISCONNECTED: CalendarStatus = { connected: false, account: null, fetchedAt: null, lastError: null, readOnly: false };
const CONNECTED: CalendarStatus = { connected: true, account: "ako@gmail.com", fetchedAt: Date.now(), lastError: null, readOnly: false };
const READ_ONLY_CONNECTED: CalendarStatus = { connected: true, account: "ako@gmail.com", fetchedAt: Date.now(), lastError: null, readOnly: true };
async function start(status: CalendarStatus, onChanged = () => {}) {
  spies.push(spyOn(api, "calendarStatus").mockResolvedValue(status));
  harness = hookHarness(() => CalendarSection({ onChanged }));
  harness.render();
  await harness.settle();
}

const all = () => elements(harness.render());
const texts = () => all().map((el) => el.props.children);
const button = (label: string) => all().find((el) => el.type === "button" && el.props.children === label);
const alertText = () => all().find((el) => el.props.role === "alert")?.props.children;

it("offers connect while disconnected and hides read-only badge for writable integration", async () => {
  await start(DISCONNECTED);
  expect(texts()).toContain("Google Kalender");
  expect(texts()).not.toContain("Hanya baca");
  expect(button("Sambungkan Google Kalender")).toBeDefined();
  expect(button("Putuskan")).toBeUndefined();
  expect(alertText()).toBeUndefined();
});

it("shows read-only badge and reconnect button for read-only grant", async () => {
  await start(READ_ONLY_CONNECTED);
  expect(texts()).toContain("Google Kalender");
  expect(texts()).toContain("Hanya baca");
  expect(texts()).toContain("Sambungkan ulang untuk sinkron dua arah");
  expect(button("Sambungkan ulang untuk sinkron dua arah")).toBeDefined();
});

it("shows the account and last error, and disconnects", async () => {
  const onChanged = mock(() => {});
  await start({ ...CONNECTED, lastError: "Tidak dapat menghubungi Google; periksa koneksi" }, onChanged);
  expect(texts()).toContain("Terhubung sebagai ako@gmail.com");
  expect(alertText()).toBe("Tidak dapat menghubungi Google; periksa koneksi");
  const disconnect = spyOn(api, "calendarDisconnect").mockResolvedValue(DISCONNECTED);
  spies.push(disconnect);
  (button("Putuskan")!.props.onClick as () => void)();
  await harness.settle();
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(button("Sambungkan Google Kalender")).toBeDefined();
  expect(alertText()).toBeUndefined();
});

it("waits for the browser, cancels quietly, and returns to the connect button", async () => {
  await start(DISCONNECTED);
  const login = deferred<CalendarStatus>();
  spies.push(spyOn(api, "calendarConnect").mockReturnValue(login.promise));
  const cancel = spyOn(api, "calendarCancelConnect").mockResolvedValue(undefined);
  spies.push(cancel);
  (button("Sambungkan Google Kalender")!.props.onClick as () => void)();
  await harness.settle();
  expect(texts()).toContain("Menunggu login di browser…");
  (button("Batal")!.props.onClick as () => void)();
  expect(cancel).toHaveBeenCalledTimes(1);
  login.reject({ code: "invalid", message: "Login Google Kalender gagal atau dibatalkan; coba lagi" });
  await harness.settle();
  expect(alertText()).toBeUndefined();
  expect(button("Sambungkan Google Kalender")).toBeDefined();
});

it("shows the unconfigured-build message instead of crashing", async () => {
  await start(DISCONNECTED);
  spies.push(spyOn(api, "calendarConnect").mockRejectedValue({ code: "invalid", message: "Google Kalender belum dikonfigurasi di build ini" }));
  (button("Sambungkan Google Kalender")!.props.onClick as () => void)();
  await harness.settle();
  expect(alertText()).toBe("Google Kalender belum dikonfigurasi di build ini");
  expect(button("Sambungkan Google Kalender")).toBeDefined();
});

it("reports a failed refresh and keeps the grant shown when the backend still has it", async () => {
  await start(CONNECTED);
  spies.push(spyOn(api, "calendarRefresh").mockRejectedValue({ code: "other", message: "Google membatasi permintaan; coba lagi nanti" }));
  (button("Muat ulang")!.props.onClick as () => void)();
  await harness.settle();
  expect(alertText()).toBe("Google membatasi permintaan; coba lagi nanti");
  expect(texts()).toContain("Terhubung sebagai ako@gmail.com");
});
