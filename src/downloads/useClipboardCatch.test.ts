import { describe, expect, it } from "bun:test";
import { isValidDownloadUrl } from "./useClipboardCatch";

describe("isValidDownloadUrl", () => {
  it("recognizes valid media and file URLs", () => {
    expect(isValidDownloadUrl("https://www.youtube.com/watch?v=123")).toBe(true);
    expect(isValidDownloadUrl("https://archive.org/download/test.zip")).toBe(true);
    expect(isValidDownloadUrl("magnet:?xt=urn:btih:xyz")).toBe(true);
  });

  it("rejects non-URL strings or invalid schemes", () => {
    expect(isValidDownloadUrl("just a normal text")).toBe(false);
    expect(isValidDownloadUrl("ftp://test.com/file")).toBe(false);
    expect(isValidDownloadUrl("")).toBe(false);
  });
});
