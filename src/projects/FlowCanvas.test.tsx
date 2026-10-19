import { describe, expect, it } from "bun:test";
import { calculateFlowLayout, type FlowData } from "./FlowCanvas";

describe("calculateFlowLayout", () => {
  it("calculates node positions and edge paths", () => {
    const data: FlowData = {
      version: 1,
      nodes: [
        { id: "step1", label: "Langkah 1", type: "start" },
        { id: "step2", label: "Langkah 2", type: "process" },
        { id: "err", label: "Gagal", type: "error" },
      ],
      edges: [
        { from: "step1", to: "step2" },
        { from: "step1", to: "err", condition: "fail" },
      ],
    };

    const layout = calculateFlowLayout(data);
    expect(layout.nodes.length).toBe(3);
    expect(layout.edges.length).toBe(2);

    const step1 = layout.nodes.find((n) => n.id === "step1");
    const step2 = layout.nodes.find((n) => n.id === "step2");
    const err = layout.nodes.find((n) => n.id === "err");

    expect(step1).toBeDefined();
    expect(step2).toBeDefined();
    expect(err).toBeDefined();

    expect(step1!.y).toBe(50);
    expect(step2!.y).toBe(50);
    expect(err!.y).toBe(150);

    // Straight horizontal edge
    expect(layout.edges[0].path).toContain("L");
    // Branching edge
    expect(layout.edges[1].path).toContain("M");
  });

  it("handles empty or missing data cleanly", () => {
    const layout = calculateFlowLayout({ nodes: [], edges: [] });
    expect(layout.nodes.length).toBe(0);
    expect(layout.edges.length).toBe(0);
  });
});
