import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AvatarSection } from "./AvatarSection";

describe("AvatarSection", () => {
  it("renders the static avatar and neutral Live2D availability text", () => {
    const html = renderToStaticMarkup(<AvatarSection />);
    expect(html).toContain("Static avatar (anchovy school). Live2D not available yet.");
  });

  it("renders Ako preview with controls for status, appearance, and motion", () => {
    const html = renderToStaticMarkup(<AvatarSection />);
    expect(html).toContain("Ako");
    expect(html).toContain("Companion anchovy · school concept");
    expect(html).toContain("Display in");
    expect(html).toContain("Daily mood");
    expect(html).toContain("Motion");
    expect(html).toContain("Listening");
    expect(html).toContain("Thinking");
    expect(html).toContain("Speaking");
  });
});
