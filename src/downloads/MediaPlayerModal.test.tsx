import { afterEach, describe, expect, it } from "bun:test";
import type { ReactNode } from "react";
import { hookHarness, type HookHarness } from "../test/hookHarness";
import { MediaPlayerModal } from "./MediaPlayerModal";

describe("MediaPlayerModal component", () => {
  let harness: HookHarness<ReactNode> | undefined;

  afterEach(() => {
    harness?.dispose();
    harness = undefined;
  });

  it("renders video player modal", async () => {
    harness = hookHarness(() => (
      <MediaPlayerModal
        title="Video Tutorial"
        filePath="/home/user/Downloads/video.mp4"
        isVideo={true}
        onClose={() => {}}
      />
    ));
    await harness.settle();

    expect(harness.render()).toBeDefined();
  });

  it("renders audio player modal", async () => {
    harness = hookHarness(() => (
      <MediaPlayerModal
        title="Podcast Audio"
        filePath="/home/user/Downloads/podcast.mp3"
        isVideo={false}
        onClose={() => {}}
      />
    ));
    await harness.settle();

    expect(harness.render()).toBeDefined();
  });
});
