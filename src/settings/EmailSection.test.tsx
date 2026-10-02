import { afterEach, expect, it, mock, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api } from "../api";
import { elements, hookHarness } from "../test/hookHarness";
import { EmailSection } from "./EmailSection";

let harness: ReturnType<typeof hookHarness<ReactNode>>;
const spies: { mockRestore: () => void }[] = [];
afterEach(() => { harness?.dispose(); spies.splice(0).forEach((spy) => spy.mockRestore()); });

it("shows address and requires confirmation before disconnecting", async () => {
  spies.push(spyOn(api, "emailStatus").mockResolvedValue({ connected: true, address: "anchoa@gmail.com" }));
  const disconnect = spyOn(api, "emailDisconnect").mockResolvedValue(undefined);
  spies.push(disconnect);
  const onChanged = mock(() => {});
  harness = hookHarness(() => EmailSection({ onChanged }));
  harness.render();
  await harness.settle();
  const button = (label: string) => elements(harness.render()).find((el) => el.type === "button" && el.props.children === label)!;
  expect(elements(harness.render()).some((el) => el.props.children === "Terhubung sebagai anchoa@gmail.com")).toBe(true);
  (button("Putuskan").props.onClick as () => void)();
  expect(disconnect).not.toHaveBeenCalled();
  (button("Batal").props.onClick as () => void)();
  expect(disconnect).not.toHaveBeenCalled();
  (button("Putuskan").props.onClick as () => void)();
  await (button("Ya, putuskan").props.onClick as () => Promise<void>)();
  await harness.settle();
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(elements(harness.render()).some((el) => el.props.children === "Belum terhubung")).toBe(true);
});
