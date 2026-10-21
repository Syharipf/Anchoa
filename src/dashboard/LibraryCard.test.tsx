import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { LibraryOverview, MediaRow } from "../api";
import { LibraryCard } from "./LibraryCard";

const sampleActive: MediaRow = {
  id: "m-1",
  title: "Severance",
  body: "Office thriller",
  kind: "series",
  status: "active",
  progress: 6,
  progressTotal: 10,
  rating: 5,
  startedAt: 1,
  finishedAt: null,
  year: 2022,
  creator: "Dan Erickson",
  tags: "sci-fi",
};

describe("LibraryCard", () => {
  it("renders null if overview is undefined", () => {
    const html = renderToStaticMarkup(<LibraryCard onSelect={() => {}} />);
    expect(html).toBe("");
  });

  it("renders null if all signals are zero and active list is empty", () => {
    const emptyOverview: LibraryOverview = {
      active: [],
      finishedThisMonth: 0,
      want: 0,
    };
    const html = renderToStaticMarkup(<LibraryCard overview={emptyOverview} onSelect={() => {}} />);
    expect(html).toBe("");
  });

  it("renders active items and counts and handles click", () => {
    const onSelect = mock((_page: string) => {});
    const overview: LibraryOverview = {
      active: [sampleActive],
      finishedThisMonth: 3,
      want: 5,
    };
    const html = renderToStaticMarkup(<LibraryCard overview={overview} onSelect={onSelect} />);
    expect(html).toContain("Library");
    expect(html).toContain("Severance");
    expect(html).toContain("6 / 10 eps");
    expect(html).toContain("3");
    expect(html).toContain("finished this month");
    expect(html).toContain("5");
    expect(html).toContain("want to watch/read");
  });
});
