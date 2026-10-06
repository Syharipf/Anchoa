import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AnchoaLogo } from "./AnchoaLogo";

describe("AnchoaLogo", () => {
  it("renders static logo with default label", () => {
    const html = renderToStaticMarkup(<AnchoaLogo />);
    expect(html).toContain('aria-label="Anchoa"');
    expect(html).toContain("anchoa-logo");
    expect(html).toContain("static");
  });

  it("renders tile with background when tile=true", () => {
    const html = renderToStaticMarkup(<AnchoaLogo tile size={40} />);
    expect(html).toContain('fill="#10303A"');
    expect(html).toContain('width="40"');
  });

  it("renders intro variant with ring", () => {
    const html = renderToStaticMarkup(<AnchoaLogo variant="intro" />);
    expect(html).toContain("intro");
    expect(html).toContain('class="ring"');
  });
});
