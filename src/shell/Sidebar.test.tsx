import { afterEach, describe, expect, it } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import { elements, hookHarness, type HookHarness } from "../test/hookHarness";
import { Sidebar } from "./Sidebar";

const KEY = "anchoa.sidebar.collapsed";
const store = new Map<string, string>();
let harness: HookHarness<ReactElement> | undefined;

const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  },
});

const mount = () =>
  hookHarness(() =>
    Sidebar({
      current: "dashboard",
      onSelect: () => {},
      reminders: 0,
      notificationsOpen: false,
      onToggleNotifications: () => {},
    }),
  );

const treeOf = (node: ReactNode) => elements(node);
const nav = (node: ReactNode) => treeOf(node).find((el) => el.type === "nav")!;
const btn = (node: ReactNode, label: string) =>
  treeOf(node).find((el) => el.props["aria-label"] === label)! as ReactElement & {
    props: Record<string, unknown>;
  };

describe("Sidebar rail", () => {
  afterEach(() => {
    harness?.dispose();
    harness = undefined;
    store.clear();
  });
  process.on("exit", () => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
  });

  it("starts expanded: nav has w-[72px]", () => {
    harness = mount();
    expect(nav(harness.render()).props.className).toContain("w-[72px]");
  });

  it("collapsed state (KEY=1): nav has w-0 + restore button", () => {
    store.set(KEY, "1");
    harness = mount();
    const rendered = harness.render();
    expect(nav(rendered).props.className).toContain("w-0");
    expect(btn(rendered, "Tampilkan menu samping")).toBeDefined();
  });

  it("expand from collapsed: nav becomes w-[72px]", () => {
    store.set(KEY, "1");
    harness = mount();
    const collapsed = harness.render();
    (btn(collapsed, "Tampilkan menu samping").props.onClick as () => void)();
    expect(nav(harness.render()).props.className).toContain("w-[72px]");
  });

  it("expand from collapsed: KEY written to 0", () => {
    store.set(KEY, "1");
    harness = mount();
    const collapsed = harness.render();
    (btn(collapsed, "Tampilkan menu samping").props.onClick as () => void)();
    expect(store.get(KEY)).toBe("0");
  });
});
