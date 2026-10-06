import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AvatarSection } from "./AvatarSection";

describe("AvatarSection", () => {
  it("renders the static avatar and neutral Live2D availability text", () => {
    const html = renderToStaticMarkup(<AvatarSection />);
    expect(html).toContain("Avatar statis (kawanan teri). Live2D belum tersedia.");
  });

  it("renders Ako preview with controls for status, appearance, and motion", () => {
    const html = renderToStaticMarkup(<AvatarSection />);
    expect(html).toContain("Ako");
    expect(html).toContain("Teri pendamping · konsep kawanan");
    expect(html).toContain("Tampil di");
    expect(html).toContain("Mood harian");
    expect(html).toContain("Gerak");
    expect(html).toContain("Mendengarkan");
    expect(html).toContain("Berpikir");
    expect(html).toContain("Berbicara");
  });
});
