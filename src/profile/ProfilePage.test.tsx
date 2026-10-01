import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api, type GithubStatus, type NotifyPrefs, type Profile } from "../api";
import { elements, hookHarness } from "../test/hookHarness";
import { ProfilePage } from "./ProfilePage";

const sampleProfile: Profile = {
  name: "Syharipf",
  since: new Date(2026, 8, 29).getTime(),
  stats: {
    habitStreak: 6,
    tasksDone: 18,
    journalEntries: 42,
    notes: 12,
  },
};

const sampleGithub: GithubStatus = {
  connected: true,
  login: "syharipf",
};

const defaultPrefs: NotifyPrefs = {
  task: true,
  bill: true,
  budget: true,
  habit: true,
};

describe("ProfilePage", () => {
  let harness: ReturnType<typeof hookHarness<ReactNode>>;
  let getProfileSpy: ReturnType<typeof spyOn<typeof api, "getProfile">>;
  let githubStatusSpy: ReturnType<typeof spyOn<typeof api, "githubStatus">>;
  let setProfileNameSpy: ReturnType<typeof spyOn<typeof api, "setProfileName">>;
  let setNotifyPrefsSpy: ReturnType<typeof spyOn<typeof api, "setNotifyPrefs">>;

  afterEach(() => {
    harness?.dispose();
    getProfileSpy?.mockRestore();
    githubStatusSpy?.mockRestore();
    setProfileNameSpy?.mockRestore();
    setNotifyPrefsSpy?.mockRestore();
  });

  it("renders profile card with name, initials, since date, and 4 stats", async () => {
    getProfileSpy = spyOn(api, "getProfile").mockResolvedValue(sampleProfile);
    githubStatusSpy = spyOn(api, "githubStatus").mockResolvedValue(sampleGithub);

    harness = hookHarness(() => ProfilePage({ prefs: defaultPrefs }));
    await harness.settle();

    const textNodes = elements(harness.render())
      .map((el) => el.props.children)
      .flat();

    expect(textNodes).toContain("Syharipf");
    expect(textNodes).toContain("S");
    expect(textNodes).toContain("Memakai Anchoa sejak Sep 2026");
    expect(textNodes).toContain("hari streak");
    expect(textNodes).toContain("tugas selesai");
    expect(textNodes).toContain("entri jurnal");
    expect(textNodes).toContain("catatan");
    expect(textNodes).toContain(6);
    expect(textNodes).toContain(18);
    expect(textNodes).toContain(42);
    expect(textNodes).toContain(12);
  });

  it("allows editing display name and saving via api.setProfileName", async () => {
    getProfileSpy = spyOn(api, "getProfile").mockResolvedValue(sampleProfile);
    githubStatusSpy = spyOn(api, "githubStatus").mockResolvedValue(sampleGithub);
    setProfileNameSpy = spyOn(api, "setProfileName").mockImplementation(async (name) => ({
      ...sampleProfile,
      name,
    }));

    harness = hookHarness(() => ProfilePage({ prefs: defaultPrefs }));
    await harness.settle();

    // Click "Ubah profil"
    const editBtn = elements(harness.render()).find(
      (el) => el.type === "button" && el.props.children === "Ubah profil",
    );
    expect(editBtn).toBeDefined();
    (editBtn!.props.onClick as () => void)();

    // Now in editing mode: input and submit button should be rendered
    const input = elements(harness.render()).find(
      (el) => el.type === "input" && el.props["aria-label"] === "Nama tampilan",
    );
    expect(input).toBeDefined();
    (input!.props.onChange as (e: unknown) => void)({ target: { value: "Dewi" } });

    const form = elements(harness.render()).find((el) => el.type === "form");
    expect(form).toBeDefined();
    await (form!.props.onSubmit as (e: unknown) => Promise<void>)({
      preventDefault: () => {},
    });

    expect(setProfileNameSpy).toHaveBeenCalledWith("Dewi");
    const textNodes = elements(harness.render())
      .map((el) => el.props.children)
      .flat();
    expect(textNodes).toContain("Dewi");
  });

  it("toggles notification switches and triggers api.setNotifyPrefs and onPrefsChanged", async () => {
    getProfileSpy = spyOn(api, "getProfile").mockResolvedValue(sampleProfile);
    githubStatusSpy = spyOn(api, "githubStatus").mockResolvedValue(sampleGithub);
    let capturedPrefs: NotifyPrefs | undefined;
    setNotifyPrefsSpy = spyOn(api, "setNotifyPrefs").mockImplementation(async (p) => p);

    harness = hookHarness(() =>
      ProfilePage({
        prefs: defaultPrefs,
        onPrefsChanged: (p) => {
          capturedPrefs = p;
        },
      }),
    );
    await harness.settle();

    // Find the switch for task
    const taskSwitch = elements(harness.render()).find(
      (el) =>
        el.type === "button" &&
        el.props.role === "switch" &&
        el.props["aria-labelledby"] === "lbl-notify-task",
    );
    expect(taskSwitch).toBeDefined();
    expect(taskSwitch!.props["aria-checked"]).toBe(true);

    // Click switch
    (taskSwitch!.props.onClick as () => void)();
    await harness.settle();

    expect(setNotifyPrefsSpy).toHaveBeenCalledWith({
      task: false,
      bill: true,
      budget: true,
      habit: true,
    });
    expect(capturedPrefs).toEqual({
      task: false,
      bill: true,
      budget: true,
      habit: true,
    });
  });

  it("renders connected accounts and navigates to integrations settings on Atur click", async () => {
    getProfileSpy = spyOn(api, "getProfile").mockResolvedValue(sampleProfile);
    githubStatusSpy = spyOn(api, "githubStatus").mockResolvedValue(sampleGithub);
    let openedSection: string | undefined;

    harness = hookHarness(() =>
      ProfilePage({
        prefs: defaultPrefs,
        onOpenSettings: (sec) => {
          openedSection = sec;
        },
      }),
    );
    await harness.settle();

    const aturBtn = elements(harness.render()).find(
      (el) => el.type === "button" && el.props.children === "Atur",
    );
    expect(aturBtn).toBeDefined();
    (aturBtn!.props.onClick as () => void)();

    expect(openedSection).toBe("integrations");
  });

  it("renders upcoming sections for Keamanan and Asisten suara", async () => {
    getProfileSpy = spyOn(api, "getProfile").mockResolvedValue(sampleProfile);
    githubStatusSpy = spyOn(api, "githubStatus").mockResolvedValue(sampleGithub);

    harness = hookHarness(() => ProfilePage({ prefs: defaultPrefs }));
    await harness.settle();

    const headings = elements(harness.render())
      .filter((el) => el.type === "h2")
      .map((el) => el.props.children);

    expect(headings).toContain("Keamanan");
    expect(headings).toContain("Asisten suara");
    expect(headings).toContain("Akun terhubung");
    expect(headings).toContain("Notifikasi");
  });
});
