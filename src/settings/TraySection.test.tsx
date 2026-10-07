import { afterEach, expect, it, mock, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api, type TraySettings } from "../api";
import { elements, hookHarness, type HookHarness } from "../test/hookHarness";
import { TraySection } from "./TraySection";

let harness: HookHarness<ReactNode>;
const spies: { mockRestore: () => void }[] = [];
afterEach(() => {
  harness?.dispose();
  spies.splice(0).forEach((spy) => spy.mockRestore());
});

const DEFAULT_SETTINGS: TraySettings = {
  closeToTray: true,
  trayAvailable: true,
};

async function start(settings: TraySettings, onChanged = () => {}) {
  spies.push(spyOn(api, "traySettings").mockResolvedValue(settings));
  harness = hookHarness(() => TraySection({ onChanged }));
  harness.render();
  await harness.settle();
}

function renderedTexts(): string[] {
  return elements(harness.render()).map((el) =>
    [el.props.children]
      .flat()
      .filter((c) => typeof c === "string" || typeof c === "number")
      .join(""),
  );
}
it("renders tray section with close-to-tray switch and GNOME copy", async () => {
  await start(DEFAULT_SETTINGS);

  const texts = renderedTexts();
  expect(texts.some((t) => t.includes("Baki sistem (Tray)"))).toBe(true);
  expect(texts.some((t) => t.includes("Tetap berjalan di tray saat jendela ditutup"))).toBe(true);
  expect(texts.some((t) => t.includes("Tersedia"))).toBe(true);
  expect(texts.some((t) => t.includes("AppIndicator"))).toBe(true);

  const sw = elements(harness.render()).find((el) => el.props.role === "switch");

  expect(sw).toBeDefined();
  expect(sw!.props["aria-checked"]).toBe(true);
});

it("displays fallback warning when system tray is unavailable", async () => {
  await start({ closeToTray: true, trayAvailable: false });

  const texts = renderedTexts();
  expect(texts.some((t) => t.includes("Tidak terdeteksi"))).toBe(true);
  expect(texts.some((t) => t.includes("Baki sistem tidak aktif di sesi desktop ini"))).toBe(true);
});

it("toggles close-to-tray setting via api.saveCloseToTray", async () => {
  const saveSpy = spyOn(api, "saveCloseToTray").mockResolvedValue(undefined);
  spies.push(saveSpy);
  const onChanged = mock(() => {});

  await start(DEFAULT_SETTINGS, onChanged);

  const sw = elements(harness.render()).find((el) => el.props.role === "switch");
  expect(sw!.props["aria-checked"]).toBe(true);

  (sw!.props.onClick as () => void)();
  await harness.settle();

  expect(saveSpy).toHaveBeenCalledWith(false);
  expect(onChanged).toHaveBeenCalled();

  const swAfter = elements(harness.render()).find((el) => el.props.role === "switch");
  expect(swAfter!.props["aria-checked"]).toBe(false);
});
