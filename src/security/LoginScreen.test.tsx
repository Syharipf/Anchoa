import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { api } from "../api";
import { elements, hookHarness } from "../test/hookHarness";
import { LoginScreen } from "./LoginScreen";

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

const buttonWith = (node: ReactNode, text: string) =>
  elements(node).find((el) => el.type === "button" && textOf(childrenOf(el)).includes(text));

describe("LoginScreen", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let signInSpy: ReturnType<typeof spyOn<typeof api, "syncSignIn">>;
  let cancelSpy: ReturnType<typeof spyOn<typeof api, "syncCancelSignIn">>;

  afterEach(() => {
    cancelSpy?.mockRestore();
    cancelSpy = spyOn(api, "syncCancelSignIn").mockResolvedValue(undefined);
    harness?.dispose();
    cancelSpy.mockRestore();
    signInSpy?.mockRestore();
  });

  it("signs in with the existing sync OAuth flow", async () => {
    signInSpy = spyOn(api, "syncSignIn").mockResolvedValue(undefined);
    let entered = false;
    harness = hookHarness(() => LoginScreen({ onSignedIn: () => { entered = true; }, onSkip: () => {} }));

    const google = buttonWith(harness.render(), "Google")!;
    expect(google).toBeDefined();
    await (google.props.onClick as () => Promise<void>)();

    expect(signInSpy).toHaveBeenCalledWith("google");
    expect(entered).toBe(true);
  });

  it("offers GitHub and Google and skips without any account", () => {
    let skipped = false;
    harness = hookHarness(() => LoginScreen({ onSignedIn: () => {}, onSkip: () => { skipped = true; } }));

    const rendered = harness.render();
    expect(buttonWith(rendered, "GitHub")).toBeDefined();
    expect(buttonWith(rendered, "Google")).toBeDefined();

    const skip = buttonWith(rendered, "Lewati")!;
    (skip.props.onClick as () => void)();
    expect(skipped).toBe(true);
  });

  it("cancels a pending sign-in when unmounted", () => {
    cancelSpy = spyOn(api, "syncCancelSignIn").mockResolvedValue(undefined);
    signInSpy = spyOn(api, "syncSignIn").mockReturnValue(new Promise(() => {}));
    const local = hookHarness(() => LoginScreen({ onSignedIn: () => {}, onSkip: () => {} }));

    const github = buttonWith(local.render(), "GitHub")!;
    void (github.props.onClick as () => Promise<void>)();
    local.dispose();

    expect(cancelSpy).toHaveBeenCalled();
  });

  it("shows an error when sign-in fails and stays on the screen", async () => {
    signInSpy = spyOn(api, "syncSignIn").mockRejectedValue({ code: "invalid", message: "gagal" });
    harness = hookHarness(() => LoginScreen({ onSignedIn: () => {}, onSkip: () => {} }));

    await (buttonWith(harness.render(), "Google")!.props.onClick as () => Promise<void>)();
    await harness.settle();

    const alert = elements(harness.render()).find((el) => el.props.role === "alert");
    expect(alert).toBeDefined();
  });
});
