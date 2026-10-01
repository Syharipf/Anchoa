import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api } from "./api";
import { App } from "./App";
import { ItemPage } from "./item/ItemPage";
import { NotesPage } from "./notes/NotesPage";
import { CommandPalette } from "./palette/CommandPalette";
import { ProfilePage } from "./profile/ProfilePage";
import { Settings } from "./settings/Settings";
import type { SettingsSection } from "./settings/view";
import { Sidebar } from "./shell/Sidebar";
import { elements, hookHarness } from "./test/hookHarness";

describe("App note navigation", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let opening: ReturnType<typeof spyOn<typeof api, "openItem">>;
  afterEach(() => { harness.dispose(); opening.mockRestore(); });

  it("gives each palette open and Catatan navigation a fresh NotesPage key", async () => {
    opening = spyOn(api, "openItem").mockResolvedValue({
      id: "A", type: "page", title: "A", body: "", parentId: null, dueAt: null,
      createdAt: 1, updatedAt: 1, openedAt: null,
    });
    // Start with a ready database and the palette open; no dashboard effects are needed.
    harness = hookHarness(App, { 0: { path: "/db", error: null }, 2: "palette" });
    const render = () => harness.render(false);
    const palette = () => elements(render()).find((element) => element.type === CommandPalette)!;
    const note = () => elements(render()).find((element) => element.type === NotesPage)!;
    (palette().props.onOpenItem as (id: string) => void)("A");
    await Promise.resolve();
    const first = note();
    // NotesPage can select B internally while its initialId remains A. Opening A again must remount it.
    (palette().props.onOpenItem as (id: string) => void)("A");
    await Promise.resolve();
    expect(note().props.initialId).toBe("A");
    expect(note().key).not.toBe(first.key);
    const sidebar = elements(render()).find((element) => element.type === Sidebar)!;
    (sidebar.props.onSelect as (name: string) => void)("catatan");
    const treeKey = note().key;
    (sidebar.props.onSelect as (name: string) => void)("catatan");
    expect(note().key).not.toBe(treeKey);
  });
});

describe("App settings navigation", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let opening: ReturnType<typeof spyOn<typeof api, "openItem">>;
  afterEach(() => { harness?.dispose(); opening?.mockRestore(); });

  it.each([undefined, "integrations"] as const)(
    "remembers a selected section after opening a palette item and going back (initial: %s)",
    async (initialSection) => {
      opening = spyOn(api, "openItem").mockResolvedValue({
        id: "task", type: "task", title: "Task", body: "", parentId: null, dueAt: null,
        createdAt: 1, updatedAt: 1, openedAt: null,
      });
      harness = hookHarness(App, { 0: { path: "/db", error: null }, 2: "palette" });
      const render = () => harness.render(false);
      const palette = () => elements(render()).find((element) => element.type === CommandPalette)!;
      const settings = () => elements(render()).find((element) => element.type === Settings)!;
      (palette().props.onNavigate as (name: string, section?: SettingsSection) => void)("settings", initialSection);
      const previousKey = settings().key;

      expect(settings().props.onSectionChange).toBeFunction();
      (settings().props.onSectionChange as (section: SettingsSection) => void)("about");
      expect(settings().props.initialSection).toBe("about");
      expect(settings().key).toBe(previousKey);

      (palette().props.onOpenItem as (id: string) => void)("task");
      await Promise.resolve();
      const item = elements(render()).find((element) => element.type === ItemPage)!;
      expect(item.props.id).toBe("task");
      (item.props.onBack as () => void)();
      expect(settings().props.initialSection).toBe("about");
    },
  );
});

describe("App profile navigation", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let prefsSpy: ReturnType<typeof spyOn<typeof api, "getNotifyPrefs">>;
  afterEach(() => {
    harness?.dispose();
    prefsSpy?.mockRestore();
  });

  it("navigates to profil and renders ProfilePage without ComingSoon", async () => {
    const dbSpy = spyOn(api, "dbStatus").mockResolvedValue({ path: "/db", error: null, backupError: null });
    const dashSpy = spyOn(api, "getDashboard").mockResolvedValue({
      today: [],
      upcoming: [],
      recent: [],
      inboxCount: 0,
      finance: { hasAccounts: false, balance: 0, expense: 0, budget: null, dueBills: [] },
      projects: [],
      habitReminders: [],
      downloads: { speed: 0, items: [] },
    });
    prefsSpy = spyOn(api, "getNotifyPrefs").mockResolvedValue({
      task: true,
      bill: false,
      budget: true,
      habit: true,
    });
    harness = hookHarness(App, { 0: { path: "/db", error: null } });
    const render = () => harness.render(false);
    const sidebar = () => elements(render()).find((element) => element.type === Sidebar)!;
    (sidebar().props.onSelect as (name: string) => void)("profil");
    await harness.settle();

    const profile = elements(render()).find((element) => element.type === ProfilePage);
    expect(profile).toBeDefined();
    expect(profile?.props.prefs).toEqual({
      task: true,
      bill: false,
      budget: true,
      habit: true,
    });
    dbSpy.mockRestore();
    dashSpy.mockRestore();
  });
});

