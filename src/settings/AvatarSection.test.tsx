import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AvatarSection } from "./AvatarSection";

describe("AvatarSection", () => {
  it("renders the static avatar and neutral Live2D availability text", () => {
    const html = renderToStaticMarkup(<AvatarSection />);
    expect(html).toContain("Avatar statis (kawanan teri). Live2D belum tersedia.");
  });
});
