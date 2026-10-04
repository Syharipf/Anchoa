import { describe, expect, it, mock } from "bun:test";
import type { BoardFilter } from "../api";
import { elements, hookHarness } from "../test/hookHarness";
import { BoardFilterBar } from "./BoardFilterBar";

describe("BoardFilterBar", () => {
  it("renders search input, filter controls, and handles changes", async () => {
    let currentFilter: BoardFilter = {};
    const handleChange = mock((f: BoardFilter) => {
      currentFilter = f;
    });

    const harness = hookHarness(() =>
      BoardFilterBar({
        filter: currentFilter,
        tags: ["frontend", "backend"],
        onChange: handleChange,
      }),
    );

    const rendered = harness.render();
    const searchInput = elements(rendered).find((e) => e.type === "input" && e.props["type"] === "search");
    expect(searchInput).toBeDefined();

    // Ubah query pencarian
    (searchInput!.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: "desain" },
    });
    expect(handleChange).toHaveBeenCalledWith({ query: "desain" });
  });

  it("renders active filter chips and resets filter when reset button is clicked", async () => {
    let currentFilter: BoardFilter = {
      query: "auth",
      tag: "backend",
      priority: 1,
      due: "overdue",
    };
    const handleChange = mock((f: BoardFilter) => {
      currentFilter = f;
    });

    const harness = hookHarness(() =>
      BoardFilterBar({
        filter: currentFilter,
        tags: ["frontend", "backend"],
        onChange: handleChange,
      }),
    );

    const rendered = harness.render();
    const buttons = elements(rendered).filter((e) => e.type === "button");
    const resetButton = buttons.find((b) => b.props.children === "Reset" || b.props.children === "Hapus filter");
    expect(resetButton).toBeDefined();

    // Klik reset
    (resetButton!.props.onClick as () => void)();
    expect(handleChange).toHaveBeenCalledWith({});
  });

  it("allows removing individual active filter chips", async () => {
    let currentFilter: BoardFilter = { tag: "frontend", priority: 2 };
    const handleChange = mock((f: BoardFilter) => {
      currentFilter = f;
    });

    const harness = hookHarness(() =>
      BoardFilterBar({
        filter: currentFilter,
        tags: ["frontend", "backend"],
        onChange: handleChange,
      }),
    );

    const rendered = harness.render();
    const removeTagBtn = elements(rendered).find(
      (e) => e.type === "button" && e.props["aria-label"] === "Hapus saringan tag frontend",
    );
    expect(removeTagBtn).toBeDefined();

    (removeTagBtn!.props.onClick as () => void)();
    expect(handleChange).toHaveBeenCalledWith({ tag: undefined, priority: 2 });
  });
  it("shows empty state message when project has no tags", async () => {
    const harness = hookHarness(() =>
      BoardFilterBar({
        filter: {},
        tags: [],
        onChange: () => {},
      }),
    );

    const rendered = harness.render();
    const tagButton = elements(rendered).find(
      (e) => e.type === "button" && e.props["aria-label"] === "Saring tag",
    );
    expect(tagButton).toBeDefined();

    // Buka dropdown
    (tagButton!.props.onClick as () => void)();
    const opened = harness.render();
    const emptyNotice = elements(opened).find(
      (e) => e.type === "p" && e.props.children === "Belum ada tag di proyek ini",
    );
    expect(emptyNotice).toBeDefined();
  });
});
