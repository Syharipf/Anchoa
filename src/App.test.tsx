import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api } from "./api";
import { App } from "./App";
import type { OpenAssistant } from "./assistant/useAssistantRequest";
import { AssistantMini } from "./assistant/AssistantMini";
import { LockScreen } from "./security/LockScreen";
import { DownloadsPage } from "./downloads/DownloadsPage";
import { Dashboard } from "./dashboard/Dashboard";
import { EmailPage } from "./email/EmailPage";
import { FilesPage } from "./files/FilesPage";
import { FinancePage } from "./finance/FinancePage";
import { HabitsPage } from "./habits/HabitsPage";
import { ItemPage } from "./item/ItemPage";
import { JournalPage } from "./journal/JournalPage";
import { NotesPage } from "./notes/NotesPage";
import { CommandPalette } from "./palette/CommandPalette";
import { ProfilePage } from "./profile/ProfilePage";
import { ProjectsPage } from "./projects/ProjectsPage";
import { SchedulePage } from "./schedule/SchedulePage";
import { Settings } from "./settings/Settings";
import type { SettingsSection } from "./settings/view";
import { Sidebar } from "./shell/Sidebar";
import { Aside } from "./shell/Aside";
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
    harness = hookHarness(App, { 0: { path: "/db", error: null }, 2: "palette", 8: { pinEnabled: false, locked: false } });
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

describe("App release pages and assistant actions", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  afterEach(() => harness?.dispose());

  it.each([
    { name: "dashboard", component: Dashboard, assistant: Aside },
    { name: "jurnal", component: JournalPage, assistant: AssistantMini },
    { name: "habit", component: HabitsPage, assistant: AssistantMini },
    { name: "keuangan", component: FinancePage, assistant: AssistantMini },
    { name: "proyek", component: ProjectsPage, assistant: AssistantMini },
    { name: "jadwal", component: SchedulePage, assistant: AssistantMini },
    { name: "berkas", component: FilesPage, assistant: AssistantMini },
  ])("routes $name actions to the mounted assistant and clears them on navigation", ({ name, component, assistant }) => {
    harness = hookHarness(App, { 0: { path: "/db", error: null }, 8: { pinEnabled: false, locked: false } });
    const render = () => elements(harness.render(false));
    const navigate = (page: string) => (render().find((element) => element.type === Sidebar)!.props.onSelect as (page: string) => void)(page);
    navigate(name);
    const current = () => render().find((element) => element.type === component)!;
    const panel = () => render().find((element) => element.type === assistant)!;
    expect(current()).toBeDefined();
    (current().props.onOpenAssistant as OpenAssistant)({ kind: "compose", text: "Bantu saya" });
    expect(panel().props.request).toEqual({ id: 1, action: { kind: "compose", text: "Bantu saya" } });
    (current().props.onOpenAssistant as OpenAssistant)({ kind: "voice" });
    expect(panel().props.request).toEqual({ id: 2, action: { kind: "voice" } });
    navigate("email");
    expect(render().find((element) => element.type === EmailPage)).toBeDefined();
    expect(render().find((element) => element.type === AssistantMini)!.props.request).toBeUndefined();
    navigate(name);
    expect(panel().props.request).toBeUndefined();
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
      harness = hookHarness(App, { 0: { path: "/db", error: null }, 2: "palette", 8: { pinEnabled: false, locked: false } });
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
    const secSpy = spyOn(api, "securityStatus").mockResolvedValue({ pinEnabled: false, locked: false });
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
    harness = hookHarness(App, { 0: { path: "/db", error: null }, 8: { pinEnabled: false, locked: false } });
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
    secSpy.mockRestore();
    dbSpy.mockRestore();
    dashSpy.mockRestore();
  });
});

describe("App assistant approvals", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let dashboardSpy: ReturnType<typeof spyOn<typeof api, "getDashboard">>;
  afterEach(() => {
    harness?.dispose();
    dashboardSpy?.mockRestore();
  });

  it.each([
    { name: "proyek", component: ProjectsPage },
    { name: "jadwal", component: SchedulePage },
    { name: "habit", component: HabitsPage },
    { name: "jurnal", component: JournalPage },
    { name: "keuangan", component: FinancePage },
    { name: "catatan", component: NotesPage },
    { name: "item", component: ItemPage },
    { name: "profil", component: ProfilePage },
    { name: "settings", component: Settings },
    { name: "berkas", component: FilesPage },
    { name: "unduhan", component: DownloadsPage },
  ])("refreshes the dashboard and the currently shown $name page after a Mini approval", ({ name, component }) => {
    dashboardSpy = spyOn(api, "getDashboard").mockReturnValue(new Promise(() => {}));
    harness = hookHarness(App, {
      0: { path: "/db", error: null },
      1: [{ name, id: "item-1" }],
      8: { pinEnabled: false, locked: false },
    });
    const render = () => harness.render(false);
    const currentPage = () => elements(render()).find((el) => el.type === component)!;
    const mini = () => elements(render()).find((el) => el.type === AssistantMini)!;
    const previousPageKey = currentPage().key;
    const previousMiniKey = mini().key;

    (mini().props.onChanged as () => void)();
    expect(dashboardSpy).toHaveBeenCalledTimes(1);
    expect(currentPage().key).not.toBe(previousPageKey);
    expect(mini().key).toBe(previousMiniKey);
    if (name === "item" || name === "catatan") {
      expect(currentPage().props.id ?? currentPage().props.initialId).toBe("item-1");
    }
  });
});

describe("App PIN lock", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let securitySpy: ReturnType<typeof spyOn<typeof api, "securityStatus">>;
  let dashboardSpy: ReturnType<typeof spyOn<typeof api, "getDashboard">>;

  afterEach(() => {
    harness?.dispose();
    securitySpy?.mockRestore();
    dashboardSpy?.mockRestore();
  });

  it("renders only the lock screen while locked and does not load dashboard data", () => {
    dashboardSpy = spyOn(api, "getDashboard").mockReturnValue(new Promise(() => {}));
    harness = hookHarness(App, {
      0: { path: "/db", error: null },
      8: { pinEnabled: true, locked: true },
    });
    const render = () => harness.render(false);

    const lock = elements(render()).find((el) => el.type === LockScreen);
    expect(lock).toBeDefined();

    const sidebar = elements(render()).find((el) => el.type === Sidebar);
    expect(sidebar).toBeUndefined();

    expect(dashboardSpy).not.toHaveBeenCalled();
  });

  it("loads the app normally after unlocking from the lock screen", async () => {
    const dbSpy = spyOn(api, "dbStatus").mockResolvedValue({ path: "/db", error: null, backupError: null });
    securitySpy = spyOn(api, "securityStatus").mockResolvedValue({ pinEnabled: true, locked: true });
    dashboardSpy = spyOn(api, "getDashboard").mockReturnValue(new Promise(() => {}));
    harness = hookHarness(App, {
      0: { path: "/db", error: null },
    });
    await harness.settle();

    const render = () => harness.render(false);
    const lock = elements(render()).find((el) => el.type === LockScreen)!;
    expect(lock).toBeDefined();

    (lock.props.onUnlocked as () => void)();
    await Promise.resolve();

    const lockAfter = elements(render()).find((el) => el.type === LockScreen);
    expect(lockAfter).toBeUndefined();

    const sidebar = elements(render()).find((el) => el.type === Sidebar);
    expect(sidebar).toBeDefined();
    dbSpy.mockRestore();
  });
});
