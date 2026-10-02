import { describe, expect, it } from "bun:test";
import { assistantHint, PAGES } from "./shell/nav";
import { paletteResults } from "./palette/results";

describe("release UI text", () => {
  it("keeps navigation, assistant hints and palette labels free of roadmap wording", () => {
    const texts = PAGES.flatMap((page) => [page.label, assistantHint(page)]);
    texts.push(assistantHint(null));
    for (const group of paletteResults("", [])) {
      texts.push(group.title, ...group.options.flatMap((option) => [option.label, option.sub]));
    }
    expect(texts.filter((text) => /fase/i.test(text))).toEqual([]);
  });

  it("rejects roadmap wording in source strings and JSX text while allowing spec comments", async () => {
    const violations: string[] = [];
    const glob = new Bun.Glob("**/*.{ts,tsx}");
    for (const path of glob.scanSync({ cwd: import.meta.dir })) {
      if (/\.(test|spec)\.[^.]+$/.test(path)) continue;
      const source = await Bun.file(`${import.meta.dir}/${path}`).text();
      // Preserve quoted strings (including URLs) and templates while stripping comments.
      const code = source.replace(
        /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g,
        (_match, literal: string | undefined) => literal ?? "",
      );
      if (/fase/i.test(code)) violations.push(path);
    }
    expect(violations).toEqual([]);
  });
});
