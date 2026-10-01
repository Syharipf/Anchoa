import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api } from "../api";
import { elements, hookHarness } from "../test/hookHarness";
import { LockScreen } from "./LockScreen";

describe("LockScreen", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let unlockSpy: ReturnType<typeof spyOn<typeof api, "unlock">>;

  afterEach(() => {
    harness?.dispose();
    unlockSpy?.mockRestore();
  });

  it("submits PIN on form submit and calls onUnlocked on success", async () => {
    let unlocked = false;
    unlockSpy = spyOn(api, "unlock").mockResolvedValue(undefined);
    harness = hookHarness(() => LockScreen({ onUnlocked: () => { unlocked = true; } }));

    const render = () => harness.render();
    const input = elements(render()).find((el) => el.type === "input" && el.props["aria-label"] === "PIN")!;
    expect(input).toBeDefined();
    expect(input.props.type).toBe("password");
    expect(input.props.inputMode).toBe("numeric");
    expect(input.props.autoFocus).toBe(true);

    // Enter PIN
    (input.props.onChange as (e: unknown) => void)({ target: { value: "1234" } });
    await harness.settle();

    // Submit form (Enter submits)
    const form = elements(render()).find((el) => el.type === "form")!;
    expect(form).toBeDefined();
    await (form.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });

    expect(unlockSpy).toHaveBeenCalledWith("1234");
    expect(unlocked).toBe(true);
  });

  it("displays wrong PIN error when unlock fails", async () => {
    let unlocked = false;
    unlockSpy = spyOn(api, "unlock").mockRejectedValue({ code: "invalid", message: "PIN salah" });
    harness = hookHarness(() => LockScreen({ onUnlocked: () => { unlocked = true; } }));

    const render = () => harness.render();
    const input = elements(render()).find((el) => el.type === "input" && el.props["aria-label"] === "PIN")!;
    (input.props.onChange as (e: unknown) => void)({ target: { value: "0000" } });
    await harness.settle();

    const form = elements(render()).find((el) => el.type === "form")!;
    await (form.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });

    expect(unlockSpy).toHaveBeenCalledWith("0000");
    expect(unlocked).toBe(false);

    const alert = elements(render()).find((el) => el.props.role === "alert");
    expect(alert).toBeDefined();
    expect(alert!.props.children).toBe("PIN salah");
  });

  it("handles cooldown message and counts down remaining seconds", async () => {
    let unlocked = false;
    unlockSpy = spyOn(api, "unlock").mockRejectedValue({
      code: "invalid",
      message: "PIN salah. Terlalu banyak percobaan, coba lagi dalam 30 detik.",
    });
    harness = hookHarness(() => LockScreen({ onUnlocked: () => { unlocked = true; } }));

    const render = () => harness.render();
    const input = () => elements(render()).find((el) => el.type === "input" && el.props["aria-label"] === "PIN")!;
    const button = () => elements(render()).find((el) => el.type === "button" && el.props.type === "submit")!;

    (input().props.onChange as (e: unknown) => void)({ target: { value: "0000" } });
    await harness.settle();

    const form = elements(render()).find((el) => el.type === "form")!;
    await (form.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });

    // In cooldown: alert displays cooldown message, input and button disabled
    const alert = elements(render()).find((el) => el.props.role === "alert")!;
    expect(alert).toBeDefined();
    expect(alert.props.children).toContain("30 detik");
    expect(input().props.disabled).toBe(true);
    expect(button().props.disabled).toBe(true);
    expect(unlocked).toBe(false);

    // Run timers (1 second tick)
    harness.runTimers();
    await harness.settle();

    const alertAfterTick = elements(render()).find((el) => el.props.role === "alert")!;
    expect(alertAfterTick.props.children).toContain("29 detik");
  });

  it("renders 'Lupa PIN?' disclosure explaining terminal reset", () => {
    harness = hookHarness(() => LockScreen({ onUnlocked: () => {} }));
    const textNodes = elements(harness.render())
      .map((el) => el.props.children)
      .flat();

    const allText = textNodes.filter((t): t is string => typeof t === "string").join(" ");
    expect(allText).toContain("Lupa PIN?");
    expect(allText).toContain("Tutup aplikasi Anchoa");
    expect(allText).toContain("sqlite3");
    expect(allText).toContain("anchoa.db");
    expect(allText).toContain("security.pin_hash");
  });
});
