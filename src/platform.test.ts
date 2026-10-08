import { describe, expect, it } from "bun:test";
import { hookHarness } from "./test/hookHarness";
import { useIsMobile } from "./platform";

describe("useIsMobile", () => {
  it("defaults to false in default headless window", () => {
    const harness = hookHarness(() => useIsMobile());
    expect(harness.render()).toBe(false);
    harness.dispose();
  });
});
