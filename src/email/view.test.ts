import { describe, expect, it } from "bun:test";
import { connectionLabel, FOLDERS, parseRecipients, replySubject, textParts } from "./view";

describe("email display rules", () => {
  it("offers only backend-supported folders", () => {
    expect(FOLDERS).toEqual([
      { id: "inbox", label: "Inbox" },
      { id: "starred", label: "Starred" },
      { id: "sent", label: "Sent" },
    ]);
  });

  it("splits and trims comma-separated recipients", () => {
    expect(parseRecipients(" siti@example.com, , dewi@example.com ")).toEqual(["siti@example.com", "dewi@example.com"]);
    expect(parseRecipients("  ")).toEqual([]);
  });

  it.each([
    ["Halo", "Re: Halo"], [" Re: Halo ", "Re: Halo"],
    ["re: Re: Halo", "Re: Halo"], ["", "Re: "],
  ])("builds one reply prefix for %s", (subject, expected) => {
    expect(replySubject(subject)).toBe(expected);
  });

  it("preserves plain text and punctuation around http(s) links", () => {
    const text = "Halo\n(https://example.com/a?q=1&b=2). http://example.org/path! Selesai";
    const parts = textParts(text);
    expect(parts.map((part) => part.text).join("")).toBe(text);
    expect(parts.filter((part) => part.url).map((part) => part.url)).toEqual([
      "https://example.com/a?q=1&b=2", "http://example.org/path",
    ]);
  });

  it("keeps quoted web URLs and balanced parentheses while leaving other schemes as text", () => {
    const text = 'javascript:alert(1) ftp://example.com <img src="https://tracker.test/pixel"> https://example.com/wiki/Foo_(bar)';
    const parts = textParts(text);
    expect(parts.map((part) => part.text).join("")).toBe(text);
    expect(parts.filter((part) => part.url).map((part) => part.url)).toEqual(["https://tracker.test/pixel", "https://example.com/wiki/Foo_(bar)"]);
  });

  it("labels connection states without inventing an address", () => {
    expect(connectionLabel(null)).toBe("Loading…");
    expect(connectionLabel({ connected: false, address: null })).toBe("Not connected");
    expect(connectionLabel({ connected: true, address: "anchoa@gmail.com" })).toBe("Connected as anchoa@gmail.com");
  });
});
