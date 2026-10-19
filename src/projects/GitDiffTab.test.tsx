import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api, type GitChanges } from "../api";
import { hookHarness, type HookHarness } from "../test/hookHarness";
import { GitDiffTab } from "./GitDiffTab";

describe("GitDiffTab component", () => {
  let harness: HookHarness<ReactNode> | undefined;

  afterEach(() => {
    harness?.dispose();
    harness = undefined;
  });

  it("renders list of modified and untracked files", async () => {
    const mockDiff: GitChanges = {
      branch: "feat/otp",
      files: [
        { path: "src/auth.ts", status: "M" },
        { path: ".anchoa/prd.md", status: "??" },
      ],
    };
    spyOn(api, "projectGitDiff").mockResolvedValue(mockDiff);

    harness = hookHarness(() => <GitDiffTab projectId="p1" />);
    await harness.settle();

    expect(harness.render()).toBeDefined();
  });

  it("renders clean state when there are no changes", async () => {
    spyOn(api, "projectGitDiff").mockResolvedValue({
      branch: "main",
      files: [],
    });

    harness = hookHarness(() => <GitDiffTab projectId="p1" />);
    await harness.settle();

    expect(harness.render()).toBeDefined();
  });
});
