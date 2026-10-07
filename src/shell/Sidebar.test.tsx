import { afterEach, describe, expect, it } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import { elements, hookHarness, type HookHarness } from "../test/hookHarness";
import { Sidebar } from "./Sidebar";

const KEY = "anchoa.sidebar.collapsed";
const store = new Map<string, string>();
let harness: HookHarness<ReactElement> | undefined;

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
const nav = (node: ReactNode) => treeOf(node).find((element) => element.type === "nav")!;
const button = (node: ReactNode, label: string) =>
  treeOf(node).find((element) => element.props["aria-label"] === label)!;

describe("Sidebar rail", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });

  afterEach(() => {
    harness?.dispose();
    harness = undefined;
    store.clear();
  });
  process.on("exit", () => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
  });

  it("starts expanded and collapses to a slim restore handle", () => {
    harness = mount();
    const expanded = harness.render();
    expect(nav(expanded).props.className).toContain("w-[72px]");
    expect(button(expanded, "Sembunyikan menu samping").props["aria-expanded"]).toBe(true);

    (button(expanded, "Sembunyikan menu samping").props.onClick as () => void)();

    const collapsed = harness.render();
    expect(nav(collapsed).props.className).toContain("w-0");
    const restore = button(collapsed, "Tampilkan menu samping");
    expect(restore.props["aria-expanded"]).toBe(false);
    expect(store.get(KEY)).toBe("1");

    (restore.props.onClick as () => void)();

    const restored = harness.render();
    expect(nav(restored).props.className).toContain("w-[72px]");
    expect(store.get(KEY)).toBe("0");
  });

  it("restores the collapsed preference from localStorage", () => {
    store.set(KEY, "1");
    harness = mount();
    const collapsed = harness.render();
    expect(nav(collapsed).props.className).toContain("w-0");
    expect(button(collapsed, "Tampilkan menu samping")).toBeDefined();
  });
});
