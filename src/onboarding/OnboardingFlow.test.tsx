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

    for (const label of ["Mikrofon", "Suara asisten", "Uji performa", "Hubungkan HP"]) {
      expect(rendered).toContain(label);
    }
    expect(rendered).toContain("Langkah 1 dari 4");
    expect(rendered).toContain("Biar asisten bisa mendengar");
  });

  it("walks steps with Lanjut and Kembali", () => {
    voicesSpy = spyOn(api, "voiceVoices").mockResolvedValue([]);
    harness = mount();

    (buttonWith(harness.render(), "Lanjut")!.props.onClick as () => void)();
    let rendered = texts(harness.render()).join(" | ");
    expect(rendered).toContain("Langkah 2 dari 4");
    expect(rendered).toContain("Pilih suara asisten");

    (buttonWith(harness.render(), "Kembali")!.props.onClick as () => void)();
    rendered = texts(harness.render()).join(" | ");
    expect(rendered).toContain("Langkah 1 dari 4");
  });

  it("persists completion through the onboarding flag and ends the flow", async () => {
    voicesSpy = spyOn(api, "voiceVoices").mockResolvedValue([]);
    completeSpy = spyOn(api, "completeOnboarding").mockResolvedValue(undefined);
    let completed = false;
    harness = hookHarness(() => OnboardingFlow({ onComplete: () => { completed = true; } }));

    for (let i = 0; i < 3; i++) {
      (buttonWith(harness.render(), "Lanjut")!.props.onClick as () => void)();
    }
    const rendered = harness.render();
    expect(texts(rendered).join(" | ")).toContain("Langkah 4 dari 4");

    await (buttonWith(rendered, "Selesai")!.props.onClick as () => Promise<void>)();
    expect(completeSpy).toHaveBeenCalled();
    expect(completed).toBe(true);
  });

  it("lets a step be skipped without an account or any data", async () => {
    voicesSpy = spyOn(api, "voiceVoices").mockResolvedValue([]);
    completeSpy = spyOn(api, "completeOnboarding").mockResolvedValue(undefined);
    let completed = false;
    harness = hookHarness(() => OnboardingFlow({ onComplete: () => { completed = true; } }));

    await (buttonWith(harness.render(), "Lewati semua")!.props.onClick as () => Promise<void>)();
    expect(completeSpy).toHaveBeenCalled();
    expect(completed).toBe(true);
  });

});
