import { describe, expect, it } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import { elements, hookHarness } from "../test/hookHarness";
import { MobileDock } from "./MobileDock";

const treeOf = (node: ReactNode) => elements(node);
const btn = (node: ReactNode, label: string) =>
  treeOf(node).find((el) => el.props["aria-label"] === label);

describe("MobileDock", () => {
  it("renders 3 primary dock buttons", () => {
    let searchOpened = false;
    let assistantOpened = false;

    const harness = hookHarness(() =>
      MobileDock({
        current: "dashboard",
        onSelect: () => {},
        onOpenSearch: () => {
          searchOpened = true;
        },
        onOpenAssistant: () => {
          assistantOpened = true;
        },
      }),
    );

    const rendered = harness.render();
    const searchBtn = btn(rendered, "Cari item dan menu");
    const menuBtn = btn(rendered, "Menu utama");
    const micBtn = btn(rendered, "Buka asisten AI");

    expect(searchBtn).toBeDefined();
    expect(menuBtn).toBeDefined();
    expect(micBtn).toBeDefined();

    (searchBtn!.props.onClick as () => void)();
    expect(searchOpened).toBe(true);

    (micBtn!.props.onClick as () => void)();
    expect(assistantOpened).toBe(true);

    harness.dispose();
  });

  it("toggles wheel menu modal on center button click", () => {
    let selectedPage = "";

    const harness = hookHarness(() =>
      MobileDock({
        current: "dashboard",
        onSelect: (p) => {
          selectedPage = p;
        },
        onOpenSearch: () => {},
        onOpenAssistant: () => {},
      }),
    );

    const rendered = harness.render();
    const menuBtn = btn(rendered, "Menu utama");
    (menuBtn!.props.onClick as () => void)();

    const opened = harness.render();
    const closeBtn = btn(opened, "Tutup menu");
    expect(closeBtn).toBeDefined();

    const jurnalBtn = treeOf(opened).find((el) => {
      const textChild = el.props.children;
      return (
        Array.isArray(textChild) &&
        textChild.some((c: unknown) => {
          const item = c as ReactElement<{ children?: string }> | null;
          return item?.props?.children === "Jurnal";
        })
      );
    });
    if (jurnalBtn?.props.onClick) {
      (jurnalBtn.props.onClick as () => void)();
      expect(selectedPage).toBe("jurnal");
    }

    harness.dispose();
  });
});
