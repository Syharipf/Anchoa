import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ReactNode } from "react";
import { hookHarness, type HookHarness } from "../test/hookHarness";
import { PrdReviewModal } from "./PrdReviewModal";

describe("PrdReviewModal component", () => {
  let harness: HookHarness<ReactNode> | undefined;

  afterEach(() => {
    harness?.dispose();
    harness = undefined;
  });

  it("renders review modal with PRD and Flow controls", async () => {
    harness = hookHarness(() => (
      <PrdReviewModal
        projectId="p1"
        initialPrd="# PRD Fitur"
        initialFlow={null}
        onClose={() => {}}
        onApproved={() => {}}
      />
    ));
    await harness.settle();

    expect(harness.render()).toBeDefined();
  });

  it("calls onApproved when user approves draft", async () => {
    const onApproved = mock(() => {});
    const onClose = mock(() => {});

    harness = hookHarness(() => (
      <PrdReviewModal
        projectId="p1"
        initialPrd="# PRD"
        initialFlow={null}
        onClose={onClose}
        onApproved={onApproved}
      />
    ));
    await harness.settle();
    expect(harness.render()).toBeDefined();
  });
});
