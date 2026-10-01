import { describe, expect, test } from "bun:test";
import type { PageNode } from "../api";
import {
  breadcrumb,
  buildTree,
  descendantIds,
  snippetParts,
} from "./view";

describe("buildTree", () => {
  test("returns empty array for empty input", () => {
    expect(buildTree([])).toEqual([]);
  });

  test("sorts root nodes case-insensitively by title then id", () => {
    const nodes: PageNode[] = [
      { id: "3", title: "Zebra", parentId: null, updatedAt: 100 },
      { id: "1", title: "apel", parentId: null, updatedAt: 100 },
      { id: "2", title: "Belimbing", parentId: null, updatedAt: 100 },
      { id: "0", title: "apel", parentId: null, updatedAt: 100 },
    ];
    const tree = buildTree(nodes);
    expect(tree.map((t) => t.id)).toEqual(["0", "1", "2", "3"]);
  });

  test("builds nested hierarchy and sorts children at each level", () => {
    const nodes: PageNode[] = [
      { id: "root", title: "Induk", parentId: null, updatedAt: 1 },
      { id: "c2", title: "Zeta", parentId: "root", updatedAt: 2 },
      { id: "c1", title: "Alfa", parentId: "root", updatedAt: 3 },
      { id: "gc1", title: "Cucu", parentId: "c1", updatedAt: 4 },
    ];
    const tree = buildTree(nodes);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("root");
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].id).toBe("c1");
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].id).toBe("gc1");
    expect(tree[0].children[1].id).toBe("c2");
    expect(tree[0].children[1].children).toHaveLength(0);
  });

  test("handles orphan nodes with unknown parent as roots", () => {
    const nodes: PageNode[] = [
      { id: "orphan", title: "Yatim", parentId: "ghost", updatedAt: 1 },
    ];
    const tree = buildTree(nodes);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("orphan");
  });
});

describe("breadcrumb", () => {
  test("returns empty array when id not found or empty nodes", () => {
    expect(breadcrumb([], "non-existent")).toEqual([]);
    const nodes: PageNode[] = [
      { id: "1", title: "A", parentId: null, updatedAt: 1 },
    ];
    expect(breadcrumb(nodes, "non-existent")).toEqual([]);
  });

  test("returns single node for root page", () => {
    const nodes: PageNode[] = [
      { id: "root", title: "Akar", parentId: null, updatedAt: 1 },
    ];
    const path = breadcrumb(nodes, "root");
    expect(path.map((n) => n.id)).toEqual(["root"]);
  });

  test("returns full path from root to target", () => {
    const nodes: PageNode[] = [
      { id: "p1", title: "Induk", parentId: null, updatedAt: 1 },
      { id: "p2", title: "Anak", parentId: "p1", updatedAt: 2 },
      { id: "p3", title: "Cucu", parentId: "p2", updatedAt: 3 },
    ];
    const path = breadcrumb(nodes, "p3");
    expect(path.map((n) => n.id)).toEqual(["p1", "p2", "p3"]);
    expect(path.map((n) => n.title)).toEqual(["Induk", "Anak", "Cucu"]);
  });

  test("safely terminates on cyclic parent links", () => {
    const nodes: PageNode[] = [
      { id: "a", title: "A", parentId: "b", updatedAt: 1 },
      { id: "b", title: "B", parentId: "a", updatedAt: 2 },
    ];
    const path = breadcrumb(nodes, "a");
    expect(path.length).toBeLessThanOrEqual(2);
  });
});

describe("descendantIds", () => {
  test("returns empty set for leaf node or empty nodes", () => {
    expect(descendantIds([], "1")).toEqual(new Set());
    const nodes: PageNode[] = [
      { id: "1", title: "Daun", parentId: null, updatedAt: 1 },
    ];
    expect(descendantIds(nodes, "1")).toEqual(new Set());
  });

  test("returns all descendants recursively without self", () => {
    const nodes: PageNode[] = [
      { id: "root", title: "Akar", parentId: null, updatedAt: 1 },
      { id: "a", title: "A", parentId: "root", updatedAt: 2 },
      { id: "b", title: "B", parentId: "root", updatedAt: 3 },
      { id: "a1", title: "A1", parentId: "a", updatedAt: 4 },
      { id: "a2", title: "A2", parentId: "a", updatedAt: 5 },
      { id: "a1_sub", title: "A1 Sub", parentId: "a1", updatedAt: 6 },
    ];

    const descOfRoot = descendantIds(nodes, "root");
    expect(descOfRoot).toEqual(new Set(["a", "b", "a1", "a2", "a1_sub"]));
    expect(descOfRoot.has("root")).toBe(false);

    const descOfA = descendantIds(nodes, "a");
    expect(descOfA).toEqual(new Set(["a1", "a2", "a1_sub"]));
    expect(descOfA.has("a")).toBe(false);

    const descOfB = descendantIds(nodes, "b");
    expect(descOfB).toEqual(new Set());
  });
});

describe("snippetParts", () => {
  test("returns empty array for empty string", () => {
    expect(snippetParts("")).toEqual([]);
  });

  test("returns single non-marked part when no markers present", () => {
    expect(snippetParts("Teks biasa tanpa marker")).toEqual([
      { text: "Teks biasa tanpa marker", mark: false },
    ]);
  });

  test("parses marked words in the middle", () => {
    const input = "Hasil pencarian \u0002catatan\u0003 harian saya";
    expect(snippetParts(input)).toEqual([
      { text: "Hasil pencarian ", mark: false },
      { text: "catatan", mark: true },
      { text: " harian saya", mark: false },
    ]);
  });

  test("parses marker at the start and end", () => {
    const input = "\u0002Awal\u0003 dan \u0002akhir\u0003";
    expect(snippetParts(input)).toEqual([
      { text: "Awal", mark: true },
      { text: " dan ", mark: false },
      { text: "akhir", mark: true },
    ]);
  });

  test("handles consecutive and multiple marked parts", () => {
    const input = "A \u0002B\u0003\u0002C\u0003 D";
    expect(snippetParts(input)).toEqual([
      { text: "A ", mark: false },
      { text: "B", mark: true },
      { text: "C", mark: true },
      { text: " D", mark: false },
    ]);
  });
});
