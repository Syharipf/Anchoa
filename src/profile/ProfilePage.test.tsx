import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { ReactNode } from "react";
import { api, type GithubStatus, type NotifyPrefs, type Profile } from "../api";
import { PinDialog } from "../security/PinDialog";
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
  let securityStatusSpy: ReturnType<typeof spyOn<typeof api, "securityStatus">> | undefined;
  let setPinSpy: ReturnType<typeof spyOn<typeof api, "setPin">> | undefined;
  let disablePinSpy: ReturnType<typeof spyOn<typeof api, "disablePin">> | undefined;
  let emailStatusSpy: ReturnType<typeof spyOn<typeof api, "emailStatus">>;

  beforeEach(() => {
    emailStatusSpy = spyOn(api, "emailStatus").mockResolvedValue({ connected: false, address: null });
  });

  afterEach(() => {
    harness?.dispose();
    getProfileSpy?.mockRestore();
    githubStatusSpy?.mockRestore();
    setProfileNameSpy?.mockRestore();
    setNotifyPrefsSpy?.mockRestore();
    securityStatusSpy?.mockRestore();
    setPinSpy?.mockRestore();
    disablePinSpy?.mockRestore();
    emailStatusSpy?.mockRestore();
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

  it("renders sections for Keamanan and Asisten suara with voice settings info", async () => {
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

    const voiceSection = elements(harness.render()).find(
      (el) => el.type === "section" && el.props["aria-labelledby"] === "section-voice",
    )!;
    expect(voiceSection).toBeDefined();

    const voiceElements = elements(voiceSection);
    // Menyusul badge should NOT be in Asisten suara
    const badges = voiceElements.filter((el) => el.props.children === "Menyusul");
    expect(badges.length).toBe(0);

    const voiceText = voiceElements
      .map((el) => el.props.children)
      .flat()
      .filter((t): t is string => typeof t === "string")
      .join(" ");
    expect(voiceText).toContain("Pengaturan > Suara");
    expect(voiceText).not.toContain("akan hadir di Fase 5");
  });

  it("navigates to voice settings when Atur suara is clicked", async () => {
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

    const aturSuaraBtn = elements(harness.render()).find(
      (el) => el.type === "button" && el.props.children === "Atur suara",
    );
    expect(aturSuaraBtn).toBeDefined();
    (aturSuaraBtn!.props.onClick as () => void)();

    expect(openedSection).toBe("suara");
  });

  it("handles enabling PIN flow via switch and Buat PIN dialog", async () => {
    getProfileSpy = spyOn(api, "getProfile").mockResolvedValue(sampleProfile);
    githubStatusSpy = spyOn(api, "githubStatus").mockResolvedValue(sampleGithub);
    securityStatusSpy = spyOn(api, "securityStatus").mockResolvedValue({ pinEnabled: false, locked: false });
    setPinSpy = spyOn(api, "setPin").mockResolvedValue(undefined);

    harness = hookHarness(() => ProfilePage({ prefs: defaultPrefs }));
    await harness.settle();

    const pinSwitch = () =>
      elements(harness.render()).find(
        (el) =>
          el.type === "button" &&
          el.props.role === "switch" &&
          el.props["aria-labelledby"] === "lbl-security-pin",
      )!;
    expect(pinSwitch().props["aria-checked"]).toBe(false);

    (pinSwitch().props.onClick as () => void)();
    await harness.settle();

    const dialog = () => elements(harness.render()).find((el) => el.type === PinDialog);
    expect(dialog()).toBeDefined();
    expect(dialog()?.props.mode).toBe("create");

    // Simulate successful PIN creation from dialog
    (dialog()!.props.onSuccess as () => void)();
    await harness.settle();

    expect(dialog()).toBeUndefined();
    expect(pinSwitch().props["aria-checked"]).toBe(true);

    const changeBtn = elements(harness.render()).find(
      (el) => el.type === "button" && el.props.children === "Ganti PIN",
    );
    expect(changeBtn).toBeDefined();
  });

  it("handles changing PIN flow via Ganti PIN button and dialog", async () => {
    getProfileSpy = spyOn(api, "getProfile").mockResolvedValue(sampleProfile);
    githubStatusSpy = spyOn(api, "githubStatus").mockResolvedValue(sampleGithub);
    securityStatusSpy = spyOn(api, "securityStatus").mockResolvedValue({ pinEnabled: true, locked: false });

    harness = hookHarness(() => ProfilePage({ prefs: defaultPrefs }));
    await harness.settle();

    const changeBtn = () =>
      elements(harness.render()).find(
        (el) => el.type === "button" && el.props.children === "Ganti PIN",
      )!;
    expect(changeBtn()).toBeDefined();

    (changeBtn().props.onClick as () => void)();
    await harness.settle();

    const dialog = () => elements(harness.render()).find((el) => el.type === PinDialog);
    expect(dialog()).toBeDefined();
    expect(dialog()?.props.mode).toBe("change");

    // Close or succeed
    (dialog()!.props.onSuccess as () => void)();
    await harness.settle();

    expect(dialog()).toBeUndefined();
  });

  it("handles disabling PIN flow via switch and Matikan PIN dialog", async () => {
    getProfileSpy = spyOn(api, "getProfile").mockResolvedValue(sampleProfile);
    githubStatusSpy = spyOn(api, "githubStatus").mockResolvedValue(sampleGithub);
    securityStatusSpy = spyOn(api, "securityStatus").mockResolvedValue({ pinEnabled: true, locked: false });

    harness = hookHarness(() => ProfilePage({ prefs: defaultPrefs }));
    await harness.settle();

    const pinSwitch = () =>
      elements(harness.render()).find(
        (el) =>
          el.type === "button" &&
          el.props.role === "switch" &&
          el.props["aria-labelledby"] === "lbl-security-pin",
      )!;
    expect(pinSwitch().props["aria-checked"]).toBe(true);

    (pinSwitch().props.onClick as () => void)();
    await harness.settle();

    const dialog = () => elements(harness.render()).find((el) => el.type === PinDialog);
    expect(dialog()).toBeDefined();
    expect(dialog()?.props.mode).toBe("disable");

    // Simulate success
    (dialog()!.props.onSuccess as () => void)();
    await harness.settle();

    expect(dialog()).toBeUndefined();
    expect(pinSwitch().props["aria-checked"]).toBe(false);

    const changeBtn = elements(harness.render()).find(
      (el) => el.type === "button" && el.props.children === "Ganti PIN",
    );
    expect(changeBtn).toBeUndefined();
  });

  it("shows neutral availability for encryption, calendar import and quiet hours", async () => {
    getProfileSpy = spyOn(api, "getProfile").mockResolvedValue(sampleProfile);
    githubStatusSpy = spyOn(api, "githubStatus").mockResolvedValue(sampleGithub);
    securityStatusSpy = spyOn(api, "securityStatus").mockResolvedValue({ pinEnabled: false, locked: false });

    harness = hookHarness(() => ProfilePage({ prefs: defaultPrefs }));
    await harness.settle();

    const textNodes = elements(harness.render())
      .map((el) => el.props.children)
      .flat();

    expect(textNodes).toContain("Enkripsi data lokal");
    expect(textNodes).toContain("Keuangan, email, dan catatan");
    expect(textNodes.filter((text) => text === "Belum tersedia")).toHaveLength(3);
    expect(textNodes).not.toContain("Menyusul");
    expect(textNodes).not.toContain("22.00");
    expect(textNodes).not.toContain("06.00");
    expect(textNodes).toContain("Pengaturan jam tenang dan suara notifikasi desktop belum tersedia.");
  });

  it("shows an error state for Keamanan card when securityStatus fails and prevents create flow", async () => {
    getProfileSpy = spyOn(api, "getProfile").mockResolvedValue(sampleProfile);
    githubStatusSpy = spyOn(api, "githubStatus").mockResolvedValue(sampleGithub);
    securityStatusSpy = spyOn(api, "securityStatus").mockRejectedValue({
      code: "db_error",
      message: "Gagal membaca database",
    });

    harness = hookHarness(() => ProfilePage({ prefs: defaultPrefs }));
    await harness.settle();

    const securitySection = elements(harness.render()).find(
      (el) => el.type === "section" && el.props["aria-labelledby"] === "section-security",
    )!;
    expect(securitySection).toBeDefined();

    // Error state is rendered inside Keamanan card
    const alert = elements(securitySection).find((el) => el.props.role === "alert");
    expect(alert).toBeDefined();
    const alertText = elements(alert!)
      .map((el) => el.props.children)
      .flat()
      .filter((t): t is string => typeof t === "string")
      .join(" ");
    expect(alertText).toContain("Gagal memuat status keamanan");
    expect(alertText).toContain("Gagal membaca database");

    // PIN switch is NOT rendered (no create flow on unknown status)
    const pinSwitch = elements(securitySection).find(
      (el) => el.type === "button" && el.props.role === "switch",
    );
    expect(pinSwitch).toBeUndefined();

    // Dialog is not open
    const dialog = elements(harness.render()).find((el) => el.type === PinDialog);
    expect(dialog).toBeUndefined();

    // Retry button works when securityStatus succeeds
    securityStatusSpy.mockResolvedValueOnce({ pinEnabled: false, locked: false });
    const retryBtn = elements(alert!).find(
      (el) => el.type === "button" && el.props.children === "Coba lagi",
    );
    expect(retryBtn).toBeDefined();
    (retryBtn!.props.onClick as () => void)();
    await harness.settle();

    // Alert cleared and switch restored
    const updatedSecuritySection = elements(harness.render()).find(
      (el) => el.type === "section" && el.props["aria-labelledby"] === "section-security",
    )!;
    expect(elements(updatedSecuritySection).find((el) => el.props.role === "alert")).toBeUndefined();
    const recoveredSwitch = elements(updatedSecuritySection).find(
      (el) => el.type === "button" && el.props.role === "switch",
    );
    expect(recoveredSwitch).toBeDefined();
    expect(recoveredSwitch!.props["aria-checked"]).toBe(false);
  });

  it.each([true, false])("shows the actual email account status (connected=%s)", async (connected) => {
    getProfileSpy = spyOn(api, "getProfile").mockResolvedValue(sampleProfile);
    githubStatusSpy = spyOn(api, "githubStatus").mockResolvedValue(sampleGithub);
    emailStatusSpy.mockResolvedValue({ connected, address: connected ? "anchoa@gmail.com" : null });
    harness = hookHarness(() => ProfilePage({ prefs: defaultPrefs }));
    harness.render();
    await harness.settle();
    const textNodes = elements(harness.render()).map((el) => el.props.children).flat();
    expect(textNodes).toContain(connected ? "Terhubung sebagai anchoa@gmail.com" : "Belum terhubung");
  });
});
