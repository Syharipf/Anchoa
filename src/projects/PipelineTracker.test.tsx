import { describe, expect, it } from "bun:test";
import { calculateActiveStage, type PipelineStatus } from "./PipelineTracker";

describe("PipelineTracker stage calculation", () => {
  it("starts at Stage 1 (PRD) if PRD is missing", () => {
    const status: PipelineStatus = {
      hasPrd: false,
      hasFlow: false,
      planCount: 0,
      doingCount: 0,
      testReviewCount: 0,
      doneCount: 0,
    };
    expect(calculateActiveStage(status)).toBe(1);
  });

  it("moves to Stage 2 (Arsitektur/Flow) if PRD exists but Flow is missing", () => {
    const status: PipelineStatus = {
      hasPrd: true,
      hasFlow: false,
      planCount: 0,
      doingCount: 0,
      testReviewCount: 0,
      doneCount: 0,
    };
    expect(calculateActiveStage(status)).toBe(2);
  });

  it("moves to Stage 3 (Rencana) if PRD and Flow exist with pending plan tasks", () => {
    const status: PipelineStatus = {
      hasPrd: true,
      hasFlow: true,
      planCount: 3,
      doingCount: 0,
      testReviewCount: 0,
      doneCount: 0,
    };
    expect(calculateActiveStage(status)).toBe(3);
  });

  it("moves to Stage 4 (Coding/Harness) when any task is doing", () => {
    const status: PipelineStatus = {
      hasPrd: true,
      hasFlow: true,
      planCount: 2,
      doingCount: 1,
      testReviewCount: 0,
      doneCount: 0,
    };
    expect(calculateActiveStage(status)).toBe(4);
  });

  it("moves to Stage 5 (Tes & Review) when only test/review tasks remain", () => {
    const status: PipelineStatus = {
      hasPrd: true,
      hasFlow: true,
      planCount: 0,
      doingCount: 0,
      testReviewCount: 2,
      doneCount: 3,
    };
    expect(calculateActiveStage(status)).toBe(5);
  });

  it("moves to Stage 6 (Selesai/Release) when all tasks are done", () => {
    const status: PipelineStatus = {
      hasPrd: true,
      hasFlow: true,
      planCount: 0,
      doingCount: 0,
      testReviewCount: 0,
      doneCount: 5,
    };
    expect(calculateActiveStage(status)).toBe(6);
  });
});
