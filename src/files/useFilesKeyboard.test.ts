import { describe, expect, it } from "bun:test";
import { shouldIgnoreKeydown } from "./useFilesKeyboard";

describe("shouldIgnoreKeydown", () => {
  it("ignores keydown when dialog is open", () => {
    expect(shouldIgnoreKeydown(null, true)).toBe(true);
  });

  it("does not ignore keydown when target is null and dialog is closed", () => {
    expect(shouldIgnoreKeydown(null, false)).toBe(false);
  });

  it("ignores keydown for input, textarea, select or elements inside dialog", () => {
    const input = {
      closest: (sel: string) => (sel.includes("input") ? {} : null),
    } as unknown as HTMLElement;
    expect(shouldIgnoreKeydown(input, false)).toBe(true);

    const dialogChild = {
      closest: (sel: string) => (sel.includes('[role="dialog"]') ? {} : null),
    } as unknown as HTMLElement;
    expect(shouldIgnoreKeydown(dialogChild, false)).toBe(true);
  });

  it("ignores buttons that do not have data-file-entry", () => {
    const button = {
      closest: (sel: string) => {
        if (sel === "button") return button;
        return null;
      },
      hasAttribute: (attr: string) => attr === "data-file-entry" ? false : false,
    } as unknown as HTMLElement;
    expect(shouldIgnoreKeydown(button, false)).toBe(true);
  });

  it("permits buttons that have data-file-entry", () => {
    const fileTile = {
      closest: (sel: string) => {
        if (sel === "button") return fileTile;
        return null;
      },
      hasAttribute: (attr: string) => attr === "data-file-entry",
    } as unknown as HTMLElement;
    expect(shouldIgnoreKeydown(fileTile, false)).toBe(false);
  });
});
