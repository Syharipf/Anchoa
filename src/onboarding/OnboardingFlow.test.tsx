import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { api } from "../api";
import { elements, hookHarness } from "../test/hookHarness";
import { OnboardingFlow } from "./OnboardingFlow";

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

const texts = (node: ReactNode) => elements(node).map((el) => textOf(childrenOf(el)));
const buttonWith = (node: ReactNode, text: string) =>
  elements(node).find((el) => el.type === "button" && textOf(childrenOf(el)).includes(text));

describe("OnboardingFlow", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let completeSpy: ReturnType<typeof spyOn<typeof api, "completeOnboarding">>;
  let voicesSpy: ReturnType<typeof spyOn<typeof api, "voiceVoices">>;

  afterEach(() => {
    harness?.dispose();
    completeSpy?.mockRestore();
    voicesSpy?.mockRestore();
  });

  const mount = () =>
    hookHarness(() => OnboardingFlow({ onComplete: () => completeSpy?.mock.calls.push([]) }));

  it("shows the four artboard steps in order", () => {
    voicesSpy = spyOn(api, "voiceVoices").mockResolvedValue([]);
    harness = mount();
    const rendered = texts(harness.render()).join(" | ");

    for (const label of ["Microphone", "Assistant voice", "Performance test", "Connect phone"]) {
      expect(rendered).toContain(label);
    }
    expect(rendered).toContain("Step 1 of 4");
    expect(rendered).toContain("Let the assistant listen");
  });

  it("walks steps with Next and Back", () => {
    voicesSpy = spyOn(api, "voiceVoices").mockResolvedValue([]);
    harness = mount();

    (buttonWith(harness.render(), "Next")!.props.onClick as () => void)();
    let rendered = texts(harness.render()).join(" | ");
    expect(rendered).toContain("Step 2 of 4");
    expect(rendered).toContain("Choose assistant voice");

    (buttonWith(harness.render(), "Back")!.props.onClick as () => void)();
    rendered = texts(harness.render()).join(" | ");
    expect(rendered).toContain("Step 1 of 4");
  });

  it("persists completion through the onboarding flag and ends the flow", async () => {
    voicesSpy = spyOn(api, "voiceVoices").mockResolvedValue([]);
    completeSpy = spyOn(api, "completeOnboarding").mockResolvedValue(undefined);
    let completed = false;
    harness = hookHarness(() => OnboardingFlow({ onComplete: () => { completed = true; } }));

    for (let i = 0; i < 3; i++) {
      (buttonWith(harness.render(), "Next")!.props.onClick as () => void)();
    }
    const rendered = harness.render();
    expect(texts(rendered).join(" | ")).toContain("Step 4 of 4");

    await (buttonWith(rendered, "Finish")!.props.onClick as () => Promise<void>)();
    expect(completeSpy).toHaveBeenCalled();
    expect(completed).toBe(true);
  });

  it("lets a step be skipped without an account or any data", async () => {
    voicesSpy = spyOn(api, "voiceVoices").mockResolvedValue([]);
    completeSpy = spyOn(api, "completeOnboarding").mockResolvedValue(undefined);
    let completed = false;
    harness = hookHarness(() => OnboardingFlow({ onComplete: () => { completed = true; } }));

    await (buttonWith(harness.render(), "Skip all")!.props.onClick as () => Promise<void>)();
    expect(completeSpy).toHaveBeenCalled();
    expect(completed).toBe(true);
  });

});
