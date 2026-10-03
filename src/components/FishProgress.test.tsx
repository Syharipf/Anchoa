import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FishProgress } from "./FishProgress";

describe("FishProgress", () => {
  it("renders with default progressbar role and aria attributes for determinate value", () => {
    const html = renderToStaticMarkup(
      <FishProgress value={45} label="Unduhan file" />,
    );
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Unduhan file"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-valuenow="45"');
    expect(html).toContain('width="45%"');
    // Anchovy silhouette path exists
    expect(html).toContain("M-7 0C-3-2.4 3-2.6 7 0");
  });

  it("omits valuenow/min/max for indeterminate state (undefined value)", () => {
    const html = renderToStaticMarkup(
      <FishProgress label="Memproses data" />,
    );
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Memproses data"');
    expect(html).not.toContain("aria-valuenow");
    expect(html).not.toContain("aria-valuemin");
    expect(html).not.toContain("aria-valuemax");
    expect(html).toContain("anchoa-swim-loop");
  });

  it("supports meter role for budgets and gauges", () => {
    const html = renderToStaticMarkup(
      <FishProgress
        role="meter"
        value={80}
        label="Pemakaian anggaran"
        tone="warning"
      />,
    );
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-label="Pemakaian anggaran"');
    expect(html).toContain('aria-valuenow="80"');
    expect(html).toContain("text-warn");
  });

  it("handles danger tone and error state", () => {
    const html = renderToStaticMarkup(
      <FishProgress value={30} label="Gagal" state="error" />,
    );
    expect(html).toContain("text-danger");
    expect(html).toContain("animation-play-state:paused");
  });

  it("handles paused state and freezes animations", () => {
    const html = renderToStaticMarkup(
      <FishProgress value={60} label="Jeda" state="paused" />,
    );
    expect(html).toContain("animation-play-state:paused");
    expect(html).toContain('width="60%"');
  });

  it("clamps values outside 0-100", () => {
    const low = renderToStaticMarkup(
      <FishProgress value={-10} label="Low" />,
    );
    expect(low).toContain('aria-valuenow="0"');
    expect(low).toContain('width="0%"');

    const high = renderToStaticMarkup(
      <FishProgress value={150} label="High" />,
    );
    expect(high).toContain('aria-valuenow="100"');
    expect(high).toContain('width="100%"');
  });

  it("applies data-anim attribute for reduced-motion query override", () => {
    const html = renderToStaticMarkup(
      <FishProgress value={50} label="Anim check" />,
    );
    expect(html).toContain("data-anim");
  });
});
