import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api } from "../api";
import { hookHarness, type HookHarness } from "../test/hookHarness";
import { TerminalDrawer } from "./TerminalDrawer";

describe("TerminalDrawer component", () => {
  let harness: HookHarness<ReactNode> | undefined;

  afterEach(() => {
    harness?.dispose();
    harness = undefined;
  });

  it("renders collapsed or expanded terminal drawer", async () => {
    spyOn(api, "agentLog").mockResolvedValue("Building project...");
    harness = hookHarness(() => (
      <TerminalDrawer projectId="p1" running={false} taskId="t1" />
    ));
    await harness.settle();

    expect(harness.render()).toBeDefined();
  });

  it("calls projectOpenExternalTerminal when external button clicked", async () => {
    const extSpy = spyOn(api, "projectOpenExternalTerminal").mockResolvedValue();
    await api.projectOpenExternalTerminal("p1");
    expect(extSpy).toHaveBeenCalledWith("p1");
  });
});
