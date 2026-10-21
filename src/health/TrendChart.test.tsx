import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TrendChart } from "./TrendChart";

describe("TrendChart", () => {
  it("renders grid lines when height >= 30", () => {
    const html = renderToStaticMarkup(
      <TrendChart points={[10, 20, 30]} height={40} color="#C6F36B" label="Weight trend" />,
    );
    expect(html).toContain('viewBox="0 0 100 40"');
    expect(html).toContain('aria-label="Weight trend"');
    expect(html).toContain('stroke="#22343A"');
    expect(html).toContain('y1="10"');
    expect(html).toContain('y1="20"');
    expect(html).toContain('y1="30"');
  });

  it("omits grid lines when height < 30", () => {
    const html = renderToStaticMarkup(
      <TrendChart points={[10, 20, 30]} height={20} color="#C6F36B" label="Short trend" />,
    );
    expect(html).not.toContain('stroke="#22343A"');
  });

  it("breaks polylines on null values into multiple segments", () => {
    const html = renderToStaticMarkup(
      <TrendChart points={[10, 20, null, 40, 50]} height={40} color="#C6F36B" label="Segmented" />,
    );
    const polylineCount = (html.match(/<polyline/g) ?? []).length;
    expect(polylineCount).toBe(2);
  });

  it("renders end dot by default on the last non-null point", () => {
    const html = renderToStaticMarkup(
      <TrendChart points={[10, 20, null]} height={40} color="#C6F36B" label="Dot test" />,
    );
    expect(html).toContain("<circle");
    expect(html).toContain('fill="#C6F36B"');
    expect(html).toContain('vector-effect="non-scaling-stroke"');
  });
});
