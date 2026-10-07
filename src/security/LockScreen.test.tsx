import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { api } from "../api";
import { elements, hookHarness } from "../test/hookHarness";
import { LockScreen } from "./LockScreen";

// elements() types props as Record<string, unknown>; children are React nodes by construction.
const childrenOf = (el: ReactElement<Record<string, unknown>>): ReactNode =>
  el.props.children as ReactNode;

const textOf = (node: ReactNode): string => {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
};

const allText = (node: ReactNode) =>
  elements(node).map((el) => textOf(childrenOf(el))).join(" ");

const secretInput = (node: ReactNode, label: string) =>
  elements(node).find((el) => el.type === "input" && el.props["aria-label"] === label);

const buttonWith = (node: ReactNode, text: string) =>
  elements(node).find((el) => el.type === "button" && textOf(childrenOf(el)).includes(text));

const unlockedStatus = { pinEnabled: true, passwordEnabled: true, locked: true };

describe("LockScreen", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let unlockSpy: ReturnType<typeof spyOn<typeof api, "unlock">>;
  let unlockPwSpy: ReturnType<typeof spyOn<typeof api, "unlockPassword">>;

  afterEach(() => {
    harness?.dispose();
    unlockSpy?.mockRestore();
    unlockPwSpy?.mockRestore();
  });

  const mount = (onUnlocked: () => void = () => {}) =>
    hookHarness(() => LockScreen({ onUnlocked, status: unlockedStatus }));

  it("submits PIN on form submit and calls onUnlocked on success", async () => {
    let unlocked = false;
    unlockSpy = spyOn(api, "unlock").mockResolvedValue(undefined);
    harness = mount(() => { unlocked = true; });

    const render = () => harness.render();
    const input = secretInput(render(), "PIN")!;
    expect(input).toBeDefined();
    expect(input.props.type).toBe("password");
    expect(input.props.inputMode).toBe("numeric");
    expect(input.props.autoFocus).toBe(true);

    (input.props.onChange as (e: unknown) => void)({ target: { value: "1234" } });
    await harness.settle();

    const form = elements(render()).find((el) => el.type === "form")!;
    await (form.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });

    expect(unlockSpy).toHaveBeenCalledWith("1234");
    expect(unlocked).toBe(true);
  });

  it("offers a password field that unlocks through the password command", async () => {
    let unlocked = false;
    unlockPwSpy = spyOn(api, "unlockPassword").mockResolvedValue(undefined);
    unlockSpy = spyOn(api, "unlock").mockResolvedValue(undefined);
    harness = mount(() => { unlocked = true; });

    (buttonWith(harness.render(), "Kata sandi")!.props.onClick as () => void)();

    const input = secretInput(harness.render(), "Kata sandi")!;
    expect(input).toBeDefined();
    expect(input.props.inputMode).toBe("text");

    (input.props.onChange as (e: unknown) => void)({ target: { value: "rahasia123" } });
    await harness.settle();

    const form = elements(harness.render()).find((el) => el.type === "form")!;
    await (form.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });

    expect(unlockPwSpy).toHaveBeenCalledWith("rahasia123");
    expect(unlockSpy).not.toHaveBeenCalled();
    expect(unlocked).toBe(true);
  });

  it("hides the toggle when only a PIN is configured", () => {
    harness = hookHarness(() =>
      LockScreen({ onUnlocked: () => {}, status: { pinEnabled: true, passwordEnabled: false, locked: true } }),
    );
    const rendered = harness.render();

    expect(buttonWith(rendered, "Kata sandi")).toBeUndefined();
    expect(secretInput(rendered, "PIN")).toBeDefined();
  });

  it("renders the underwater backdrop and Ako behind the form", () => {
    harness = mount();
    const rendered = harness.render();
    const text = allText(rendered);

    // Decorative layers come from the pet module; the card keeps the accessible form.
    const html = JSON.stringify(rendered);
    expect(html).toContain("laut-card");
    expect(html).toContain("bg-stage");
    expect(text).toContain("Anchoa terkunci");
    expect(text).toContain("Masukkan PIN Anda");
  });

  it("displays wrong PIN error when unlock fails", async () => {
    let unlocked = false;
    unlockSpy = spyOn(api, "unlock").mockRejectedValue({ code: "invalid", message: "PIN salah" });
    harness = mount(() => { unlocked = true; });

    const render = () => harness.render();
    const input = secretInput(render(), "PIN")!;
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

  it("clears the secret input and keeps focus after a wrong PIN or cooldown error", async () => {
    unlockSpy = spyOn(api, "unlock").mockRejectedValue({ code: "invalid", message: "PIN salah" });
    harness = mount();

    const render = () => harness.render();
    const input = () => secretInput(render(), "PIN")!;
    const form = () => elements(render()).find((el) => el.type === "form")!;

    let focused = 0;
    const ref = input().props.ref as { current: unknown } | undefined;
    expect(ref).toBeDefined();
    ref!.current = { focus: () => { focused += 1; } };

    (input().props.onChange as (e: unknown) => void)({ target: { value: "1111" } });
    await harness.settle();
    expect(input().props.value).toBe("1111");

    await (form().props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });
    await harness.settle();

    expect(input().props.value).toBe("");
    expect(focused).toBe(1);

    unlockSpy.mockRejectedValue({
      code: "invalid",
      message: "Terlalu banyak percobaan. Coba lagi dalam 30 detik.",
    });

    (input().props.onChange as (e: unknown) => void)({ target: { value: "2222" } });
    await harness.settle();
    expect(input().props.value).toBe("2222");

    await (form().props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });
    await harness.settle();
    expect(input().props.value).toBe("");
  });

  it("handles cooldown message, counts down remaining seconds, and clears on expiry", async () => {
    unlockPwSpy = spyOn(api, "unlockPassword").mockRejectedValue({
      code: "invalid",
      message: "Kata sandi salah. Terlalu banyak percobaan, coba lagi dalam 2 detik.",
    });
    unlockSpy = spyOn(api, "unlock").mockResolvedValue(undefined);
    harness = mount();

    const render = () => harness.render();
    (buttonWith(render(), "Kata sandi")!.props.onClick as () => void)();

    const input = () => secretInput(render(), "Kata sandi")!;
    const form = () => elements(render()).find((el) => el.type === "form")!;
    const button = () => elements(render()).find((el) => el.type === "button" && el.props.type === "submit")!;

    (input().props.onChange as (e: unknown) => void)({ target: { value: "salahsekali" } });
    await harness.settle();
    await (form().props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault: () => {} });
    await harness.settle();

    let alert = elements(render()).find((el) => el.props.role === "alert");
    expect(alert).toBeDefined();
    expect(String(alert!.props.children)).toContain("2 detik");
    expect(button().props.disabled).toBe(true);

    harness.runTimers();
    await harness.settle();
    alert = elements(render()).find((el) => el.props.role === "alert");
    expect(String(alert!.props.children)).toContain("1 detik");

    harness.runTimers();
    await harness.settle();
    alert = elements(render()).find((el) => el.props.role === "alert");
    expect(alert).toBeUndefined();
    expect(secretInput(render(), "Kata sandi")!.props.value).toBe("");
  });

  it("renders 'Lupa PIN?' disclosure explaining terminal reset", () => {
    harness = mount();
    const all = allText(harness.render());

    expect(all).toContain("Lupa PIN?");
    expect(all).toContain("Tutup aplikasi Anchoa");
    expect(all).toContain("sqlite3");
    expect(all).toContain("io.github.syharipf.anchoa");
    expect(all).toContain("anchoa.db");
    expect(all).toContain("security.pin_hash");
    expect(all).toContain(
      'sqlite3 ~/.local/share/io.github.syharipf.anchoa/anchoa.db "DELETE FROM settings WHERE key = \'security.pin_hash\';"'
    );
  });
});
