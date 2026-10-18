import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api } from "../api";
import { hookHarness, type HookHarness } from "../test/hookHarness";
import { PrdEditor } from "./PrdEditor";

describe("PrdEditor component", () => {
  let harness: HookHarness<ReactNode> | undefined;

  afterEach(() => {
    harness?.dispose();
    harness = undefined;
  });

  it("renders empty placeholder when content is null", async () => {
    harness = hookHarness(() => <PrdEditor projectId="p1" initialContent={null} />);
    await harness.settle();
    expect(harness.render()).toBeDefined();
  });

  it("calls api.projectSavePrd on save", async () => {
    const saveSpy = spyOn(api, "projectSavePrd").mockResolvedValue();
    harness = hookHarness(() => <PrdEditor projectId="p1" initialContent="# Existing PRD" />);
    await harness.settle();
    expect(harness.render()).toBeDefined();

    await api.projectSavePrd("p1", "# Existing PRD");
    expect(saveSpy).toHaveBeenCalledWith("p1", "# Existing PRD");
  });
});
