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
    // Anchovy silhouette path and tile pattern exist
    expect(html).toContain("M-7 0C-3-2.4 3-2.6 7 0");
    expect(html).toContain('fill="#C6F36B"');
    expect(html).toContain('fill="rgba(198,243,107,0.14)"');
    expect(html).not.toContain("#0F1115");
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
    expect(html).toContain("anchoa-swim");
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
    expect(html).toContain('fill="#E5A83B"');
    expect(html).toContain('fill="rgba(229,168,59,0.16)"');
  });

  it("error state collapses fill to 0 and shows coral track without fish", () => {
    const html = renderToStaticMarkup(
      <FishProgress value={30} label="Gagal" state="error" />,
    );
    expect(html).toContain("rgba(255,138,122,0.12)");
    expect(html).not.toContain("anchoa-swim");
    expect(html).not.toContain("fish-pat");
    expect(html).toContain('aria-valuenow="30"');
  });

  it("danger tone fills bar with coral fish (meter over-budget regression)", () => {
    const html = renderToStaticMarkup(
      <FishProgress role="meter" value={120} label="Anggaran terlampaui" tone="danger" />,
    );
    // Clamped to 100 but bar must be visible, not collapsed
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('width="100%"');
    expect(html).toContain('fill="#FF8A7A"');
    expect(html).toContain('fill="rgba(255,138,122,0.16)"');
    // Not the error-state zero-width / coral track
    expect(html).not.toContain("rgba(255,138,122,0.12)");
  });

  it("handles paused state and freezes animations with neutral gray fish", () => {
    const html = renderToStaticMarkup(
      <FishProgress value={60} label="Jeda" state="paused" />,
    );
    expect(html).toContain("animation-play-state:paused");
    expect(html).toContain('width="60%"');
    expect(html).toContain('fill="#5B6475"');
    expect(html).toContain('fill="rgba(91,100,117,0.16)"');
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
