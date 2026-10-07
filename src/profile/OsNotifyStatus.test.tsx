import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import * as apiModule from "../api";
import { api, type NotifyStatus } from "../api";
import { deferred, elements, hookHarness, type HookHarness } from "../test/hookHarness";
import { OsNotifyStatus } from "./OsNotifyStatus";

const GRANTED: NotifyStatus = { permission: "granted", reason: null, recent: [] };

let current: NotifyStatus;
let delivered: (() => void) | undefined;
let harness: HookHarness<ReactNode>;
const spies: { mockRestore: () => void }[] = [];
const spy = <T extends { mockRestore: () => void }>(s: T) => (spies.push(s), s);

beforeEach(() => {
  current = GRANTED;
  delivered = undefined;
  spy(spyOn(api, "notifyStatus").mockImplementation(async () => current));
  spy(
    spyOn(apiModule, "onNotifyDelivered").mockImplementation(async (handler) => {
      delivered = handler;
      return () => {};
    }),
  );
});
afterEach(() => {
  harness?.dispose();
  spies.splice(0).forEach((s) => s.mockRestore());
});

async function mount() {
  harness = hookHarness(() => OsNotifyStatus());
  harness.render();
  await harness.settle();
}
const tree = () => elements(harness.render());
const textOf = (el: ReactElement<Record<string, unknown>>) =>
  [el.props.children].flat().filter((c) => typeof c === "string" || typeof c === "number").join("");
const texts = () => tree().map(textOf);
const buttons = () => tree().filter((el) => el.type === "button");

it("shows an active OS bridge without a permission button", async () => {
  await mount();
  expect(texts()).toContain("Notifikasi sistem: aktif");
  expect(buttons()).toHaveLength(0);
  expect(texts()).toContain("Belum ada pengingat yang dikirim ke sistem.");
  expect(texts().some((t) => t.includes("selama Anchoa berjalan"))).toBe(true);
});

it("explains a denied permission and offers no prompt", async () => {
  current = { permission: "denied", reason: "Izin notifikasi ditolak di pengaturan sistem.", recent: [] };
  await mount();
  expect(texts()).toContain("Notifikasi sistem: ditolak");
  expect(texts()).toContain("Izin notifikasi ditolak di pengaturan sistem.");
  expect(buttons()).toHaveLength(0);
});

it("asks for permission while the OS is still prompting", async () => {
  current = { permission: "prompt", reason: "Izin notifikasi belum diberikan.", recent: [] };
  const answer = deferred<NotifyStatus>();
  const request = spy(spyOn(api, "notifyRequestPermission").mockReturnValue(answer.promise));
  await mount();
  expect(texts()).toContain("Notifikasi sistem: belum diizinkan");
  const pending = (buttons()[0].props.onClick as () => void)();
  harness.render();
  expect(textOf(buttons()[0])).toBe("Meminta izin…");
  expect(buttons()[0].props.disabled).toBe(true);
  answer.resolve(GRANTED);
  await pending;
  await harness.settle();
  expect(request).toHaveBeenCalledTimes(1);
  expect(texts()).toContain("Notifikasi sistem: aktif");
  expect(buttons()).toHaveLength(0);
});

it("reports a failed permission request", async () => {
  current = { permission: "prompt", reason: null, recent: [] };
  spy(spyOn(api, "notifyRequestPermission").mockRejectedValue({ code: "other", message: "Minta izin notifikasi gagal" }));
  await mount();
  await (buttons()[0].props.onClick as () => unknown)();
  await harness.settle();
  expect(tree().filter((el) => el.props.role === "alert").map(textOf)).toContain("Minta izin notifikasi gagal");
});

it("lists the latest deliveries, capped, and refreshes after a batch", async () => {
  const at = Date.now() - 60_000;
  current = {
    ...GRANTED,
    recent: [
      { at, id: "task:t1", title: "Kirim laporan", state: "shown", reason: null },
      { at, id: "bill:b1", title: "", state: "skipped", reason: "disabled" },
      ...Array.from({ length: 6 }, (_, i) => ({ at, id: `habit:${i}`, title: `Habit ${i}`, state: "failed" as const, reason: null })),
    ],
  };
  await mount();
  const items = tree().filter((el) => el.type === "li");
  expect(items).toHaveLength(5);
  expect(texts()).toContain("Kirim laporan");
  expect(texts()).toContain("Terkirim · 1 menit lalu");
  expect(texts()).toContain("bill:b1");
  expect(texts()).toContain("Dilewati, kategori mati · 1 menit lalu");

  current = { ...GRANTED, recent: [{ at, id: "task:t2", title: "Bayar sewa", state: "shown", reason: null }] };
  delivered?.();
  await harness.settle();
  expect(texts()).toContain("Bayar sewa");
  expect(tree().filter((el) => el.type === "li")).toHaveLength(1);
});

it("surfaces a status error", async () => {
  spy(spyOn(api, "notifyStatus").mockRejectedValue({ code: "db_unavailable", message: "Database tidak tersedia" }));
  await mount();
  expect(texts()).toContain("Notifikasi sistem: memuat…");
  expect(tree().filter((el) => el.props.role === "alert").map(textOf)).toContain("Database tidak tersedia");
});
