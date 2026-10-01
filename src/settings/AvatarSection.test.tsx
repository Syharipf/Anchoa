import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AvatarSection } from "./AvatarSection";

describe("AvatarSection", () => {
  it("renders the static avatar info card with Cubism license note", () => {
    const html = renderToStaticMarkup(<AvatarSection />);
    expect(html).toContain("Avatar statis (kawanan teri). Live2D menyusul setelah cek lisensi Cubism.");
  });
});
