import { describe, expect, it, mock, spyOn } from "bun:test";
import * as core from "@tauri-apps/api/core";
import * as events from "@tauri-apps/api/event";
import * as dialog from "@tauri-apps/plugin-dialog";
import { api, assetUrl, errorMessage, onSyncChanged, type AssistantEvent, type VoiceInstallProgress } from "./api";

type Case = readonly [keyof typeof api, () => Promise<unknown>, string, Record<string, unknown>?];

// Expected names and argument shapes are the Rust IPC contract, including nested structs.
const cases: Case[] = [
  ["dbStatus", () => api.dbStatus(), "db_status"],
  ["listInbox", () => api.listInbox(), "list_inbox"],
  ["getDashboard", () => api.getDashboard(), "get_dashboard"],
  ["projectsOverview", () => api.projectsOverview(), "projects_overview"],
  ["agentRunning", () => api.agentRunning(), "agent_running"],
  ["listAccounts", () => api.listAccounts(), "list_accounts"],
  ["financeCategories", () => api.financeCategories(), "finance_categories"],
  ["listBills", () => api.listBills(), "list_bills"],
  ["githubStatus", () => api.githubStatus(), "github_status"],
  ["disconnectGithub", () => api.disconnectGithub(), "disconnect_github"],
  ["backupNow", () => api.backupNow(), "backup_now"],
  ["dataOverview", () => api.dataOverview(), "data_overview"],
  ["checkUpdate", () => api.checkUpdate(), "check_update"],
  ["getProfile", () => api.getProfile(), "get_profile"],
  ["getNotifyPrefs", () => api.getNotifyPrefs(), "get_notify_prefs"],
  ["dismissJournalReminder", () => api.dismissJournalReminder(), "dismiss_journal_reminder"],
  ["habitsOverview", () => api.habitsOverview(), "habits_overview"],
  ["journalSide", () => api.journalSide(), "journal_side"],
  ["dataPaths", () => api.dataPaths(), "data_paths"],
  ["filePlaces", () => api.filePlaces(), "file_places"],
  ["downloadsList", () => api.downloadsList(), "downloads_list"],
  ["downloadEngines", () => api.downloadEngines(), "download_engines"],
  ["downloadSettings", () => api.downloadSettings(), "download_settings"],
  ["pagesTree", () => api.pagesTree(), "pages_tree"],
  ["pagesTrash", () => api.pagesTrash(), "pages_trash"],
  ["exportPages", () => api.exportPages(), "export_pages"],
  ["assistantStop", () => api.assistantStop(), "assistant_stop"],
  ["assistantPending", () => api.assistantPending(), "assistant_pending"],
  ["assistantReset", () => api.assistantReset(), "assistant_reset"],
  ["aiStatus", () => api.aiStatus(), "ai_status"],
  ["aiRoles", () => api.aiRoles(), "ai_roles"],
  ["voiceStatus", () => api.voiceStatus(), "voice_status"],
  ["voiceRecordStart", () => api.voiceRecordStart(), "voice_record_start"],
  ["voiceRecordStop", () => api.voiceRecordStop(), "voice_record_stop"],
  ["voiceVoices", () => api.voiceVoices(), "voice_voices"],
  ["voiceStop", () => api.voiceStop(), "voice_stop"],
  ["openItem", () => api.openItem("item"), "open_item", { id: "item" }],
  ["deleteItem", () => api.deleteItem("item"), "delete_item", { id: "item" }],
  ["getTask", () => api.getTask("task"), "get_task", { id: "task" }],
  ["deleteTask", () => api.deleteTask("task"), "delete_task", { id: "task" }],
  ["convertToTask", () => api.convertToTask("note"), "convert_to_task", { id: "note" }],
  ["deleteProject", () => api.deleteProject("project"), "delete_project", { id: "project" }],
  ["openRepo", () => api.openRepo("project"), "open_repo", { id: "project" }],
  ["deleteAccount", () => api.deleteAccount("account"), "delete_account", { id: "account" }],
  ["deleteTransaction", () => api.deleteTransaction("transaction"), "delete_transaction", { id: "transaction" }],
  ["payBill", () => api.payBill("bill"), "pay_bill", { id: "bill" }],
  ["deleteBill", () => api.deleteBill("bill"), "delete_bill", { id: "bill" }],
  ["deleteHabit", () => api.deleteHabit("habit"), "delete_habit", { id: "habit" }],
  ["journalEntry", () => api.journalEntry("entry"), "journal_entry", { id: "entry" }],
  ["entryToTask", () => api.entryToTask("entry"), "entry_to_task", { id: "entry" }],
  ["pauseDownload", () => api.pauseDownload("download"), "pause_download", { id: "download" }],
  ["resumeDownload", () => api.resumeDownload("download"), "resume_download", { id: "download" }],
  ["retryDownload", () => api.retryDownload("download"), "retry_download", { id: "download" }],
  ["removeDownload", () => api.removeDownload("download"), "remove_download", { id: "download" }],
  ["openDownload", () => api.openDownload("download"), "open_download", { id: "download" }],
  ["revealDownload", () => api.revealDownload("download"), "reveal_download", { id: "download" }],
  ["deletePage", () => api.deletePage("page"), "delete_page", { id: "page" }],
  ["restorePage", () => api.restorePage("page"), "restore_page", { id: "page" }],
  ["pageBacklinks", () => api.pageBacklinks("page"), "page_backlinks", { id: "page" }],
  ["emailAssist", () => api.emailAssist("email"), "email_assist", { id: "email" }],
  ["captureNote", () => api.captureNote("catatan"), "capture_note", { text: "catatan" }],
  ["updateItem", () => api.updateItem("item", { title: "Ubah", dueAt: null }), "update_item", { id: "item", patch: { title: "Ubah", dueAt: null } }],
  ["projectBoard", () => api.projectBoard(null), "project_board", { id: null }],
  ["projectBoard", () => api.projectBoard("project"), "project_board", { id: "project" }],
  ["saveProject", () => api.saveProject({ name: "Anchoa", kind: "app", description: "", deadlineAt: null, repoUrl: null, agent: false, agentDir: null, agentCommand: null }), "save_project", { input: { name: "Anchoa", kind: "app", description: "", deadlineAt: null, repoUrl: null, agent: false, agentDir: null, agentCommand: null } }],
  ["agentRequest", () => api.agentRequest("project", "Buat fitur"), "agent_request", { projectId: "project", text: "Buat fitur" }],
  ["agentStop", () => api.agentStop("project"), "agent_stop", { projectId: "project" }],
  ["agentLastActors", () => api.agentLastActors("project"), "agent_last_actors", { projectId: "project" }],
  ["taskActivities", () => api.taskActivities("task"), "task_activities", { taskId: "task" }],
  ["projectActivities", () => api.projectActivities("project"), "project_activities", { projectId: "project", limit: 200 }],
  ["projectActivities", () => api.projectActivities("project", 5), "project_activities", { projectId: "project", limit: 5 }],
  ["addActivity", () => api.addActivity({ projectId: "project", taskId: null, actor: "Kamu", role: "note", kind: "message", title: "", body: "Catatan" }), "add_activity", { input: { projectId: "project", taskId: null, actor: "Kamu", role: "note", kind: "message", title: "", body: "Catatan" } }],
  ["agentLog", () => api.agentLog("task"), "agent_log", { taskId: "task" }],
  ["createTask", () => api.createTask({ title: "Beli", projectId: null, parentId: null, status: "plan" }), "create_task", { input: { title: "Beli", projectId: null, parentId: null, status: "plan" } }],
  ["updateTask", () => api.updateTask("task", { status: "done", projectId: null }), "update_task", { id: "task", patch: { status: "done", projectId: null } }],
  ["saveAccount", () => api.saveAccount({ name: "BCA", kind: "bank", openingBalance: -1 }), "save_account", { input: { name: "BCA", kind: "bank", openingBalance: -1 } }],
  ["listTransactions", () => api.listTransactions("2026-09", "out", 50), "list_transactions", { query: { until: "2026-09", flow: "out", offset: 50 } }],
  ["saveTransaction", () => api.saveTransaction({ kind: "expense", amount: 1, accountId: "a", occurredAt: 1790701200000, title: "Kopi", category: "Kopi", body: "" }), "save_transaction", { input: { kind: "expense", amount: 1, accountId: "a", occurredAt: 1790701200000, title: "Kopi", category: "Kopi", body: "" } }],
  ["saveTransfer", () => api.saveTransfer({ fromAccountId: "a", toAccountId: "b", amount: 1, occurredAt: 1790701200000 }), "save_transfer", { input: { fromAccountId: "a", toAccountId: "b", amount: 1, occurredAt: 1790701200000 } }],
  ["financeOverview", () => api.financeOverview(null), "finance_overview", { month: null }],
  ["financeOverview", () => api.financeOverview("2026-09"), "finance_overview", { month: "2026-09" }],
  ["setBudget", () => api.setBudget(1), "set_budget", { amount: 1 }],
  ["setBudget", () => api.setBudget(null), "set_budget", { amount: null }],
  ["saveBill", () => api.saveBill({ name: "Air", amount: 1, accountId: "a", repeat: "monthly", dueAt: 1790701200000 }), "save_bill", { input: { name: "Air", amount: 1, accountId: "a", repeat: "monthly", dueAt: 1790701200000 } }],
  ["connectGithub", () => api.connectGithub("token-fixture"), "connect_github", { token: "token-fixture" }],
  ["getContributions", () => api.getContributions(false), "get_contributions", { force: false }],
  ["getContributions", () => api.getContributions(true), "get_contributions", { force: true }],
  ["schedule", () => api.schedule("2026-09-29", "2026-10-06"), "schedule", { range: { from: "2026-09-29", to: "2026-10-06" } }],
  ["setProfileName", () => api.setProfileName("Dewi"), "set_profile_name", { name: "Dewi" }],
  ["setNotifyPrefs", () => api.setNotifyPrefs({ task: false, bill: true, budget: false, habit: true, journal: false, journalAt: "20:00" }), "set_notify_prefs", { prefs: { task: false, bill: true, budget: false, habit: true, journal: false, journalAt: "20:00" } }],
  ["habitHistory", () => api.habitHistory("habit", "2026-09"), "habit_history", { id: "habit", month: "2026-09" }],
  ["saveHabit", () => api.saveHabit({ name: "Minum", days: 127, remindAt: null, remindOn: false, autoJournal: true }), "save_habit", { input: { name: "Minum", days: 127, remindAt: null, remindOn: false, autoJournal: true } }],
  ["checkHabit", () => api.checkHabit("habit", false), "check_habit", { id: "habit", done: false }],
  ["journalList", () => api.journalList(), "journal_list", { query: undefined, kind: undefined, tag: undefined, mood: undefined }],
  ["journalList", () => api.journalList({ query: "teks", kind: "idea" }), "journal_list", { query: "teks", kind: "idea", tag: undefined, mood: undefined }],
  ["journalList", () => api.journalList({ query: "teks", kind: "idea", tag: "kerja", mood: 4 }), "journal_list", { query: "teks", kind: "idea", tag: "kerja", mood: 4 }],
  ["deleteEntry", () => api.deleteEntry("entry"), "delete_entry", { id: "entry" }],
  ["restoreEntry", () => api.restoreEntry("entry"), "restore_entry", { id: "entry" }],
  ["updateEntry", () => api.updateEntry("entry", { pinned: true }), "update_entry", { id: "entry", patch: { pinned: true } }],
  ["createEntry", () => api.createEntry("vent"), "create_entry", { kind: "vent", title: undefined }],
  ["createEntry", () => api.createEntry("idea", "Ide"), "create_entry", { kind: "idea", title: "Ide" }],
  ["updateEntry", () => api.updateEntry("entry", { mood: null, tags: "#kerja" }), "update_entry", { id: "entry", patch: { mood: null, tags: "#kerja" } }],
  ["openFolder", () => api.openFolder("data"), "open_folder", { kind: "data" }],
  ["listDir", () => api.listDir("/home/kamu", false), "list_dir", { path: "/home/kamu", hidden: false }],
  ["readText", () => api.readText("/home/kamu/a.txt"), "read_text", { path: "/home/kamu/a.txt" }],
  ["pasteItems", () => api.pasteItems({ sources: ["/home/kamu/a.txt"], dest: "/home/kamu/b", mode: "copy", onConflict: "skip" }), "paste_items", { req: { sources: ["/home/kamu/a.txt"], dest: "/home/kamu/b", mode: "copy", onConflict: "skip" } }],
  ["trashItems", () => api.trashItems(["/home/kamu/a.txt"]), "trash_items", { paths: ["/home/kamu/a.txt"] }],
  ["openFile", () => api.openFile("/home/kamu/a.txt"), "open_file", { path: "/home/kamu/a.txt" }],
  ["addDownload", () => api.addDownload({ url: "https://example.com/a.zip", kind: "file" }), "add_download", { input: { url: "https://example.com/a.zip", kind: "file" } }],
  ["saveDownloadSettings", () => api.saveDownloadSettings({ dir: "/home/kamu", parallel: 2, limit: 0 }), "save_download_settings", { settings: { dir: "/home/kamu", parallel: 2, limit: 0 } }],
  ["createPage", () => api.createPage(null, "Catatan"), "create_page", { parentId: null, title: "Catatan" }],
  ["renamePage", () => api.renamePage("page", "Baru"), "rename_page", { id: "page", title: "Baru" }],
  ["movePage", () => api.movePage("page", null), "move_page", { id: "page", parentId: null }],
  ["savePageBody", () => api.savePageBody("page", "**Isi**"), "save_page_body", { id: "page", body: "**Isi**" }],
  ["resolveLink", () => api.resolveLink("Catatan"), "resolve_link", { title: "Catatan" }],
  ["searchItems", () => api.searchItems("teks", true, 10), "search_items", { text: "teks", pagesOnly: true, limit: 10 }],
  ["openLink", () => api.openLink("https://example.com"), "open_link", { url: "https://example.com" }],
  ["assistantDecide", () => api.assistantDecide("proposal", false), "assistant_decide", { id: "proposal", approve: false }],
  ["setAiRole", () => api.setAiRole("email", "ollama", "qwen3"), "set_ai_role", { role: "email", provider: "ollama", model: "qwen3" }],
  ["voiceImport", () => api.voiceImport("/home/kamu/voice.onnx"), "voice_import", { onnxPath: "/home/kamu/voice.onnx" }],
  ["setVoice", () => api.setVoice("id_ID-news_tts-medium"), "set_voice", { id: "id_ID-news_tts-medium", params: undefined }],
  ["setVoice", () => api.setVoice("id_ID-news_tts-medium", { lengthScale: 1, noiseScale: 0.5, noiseW: 0.8 }), "set_voice", { id: "id_ID-news_tts-medium", params: { lengthScale: 1, noiseScale: 0.5, noiseW: 0.8 } }],
  ["voiceSpeak", () => api.voiceSpeak("Halo"), "voice_speak", { text: "Halo" }],
  ["syncStatus", () => api.syncStatus(), "sync_status"],
  ["syncSignIn", () => api.syncSignIn("google"), "sync_sign_in", { provider: "google" }],
  ["syncCancelSignIn", () => api.syncCancelSignIn(), "sync_cancel_sign_in"],
  ["syncCreateKey", () => api.syncCreateKey("frasa sandi panjang"), "sync_create_key", { passphrase: "frasa sandi panjang" }],
  ["syncUnlockKey", () => api.syncUnlockKey("frasa"), "sync_unlock_key", { passphraseOrRecovery: "frasa" }],
  ["syncChangePassphrase", () => api.syncChangePassphrase("lama", "baru"), "sync_change_passphrase", { old: "lama", new: "baru" }],
  ["syncNow", () => api.syncNow(), "sync_now"],
  ["syncSignOut", () => api.syncSignOut(true), "sync_sign_out", { deleteCloud: true }],
  ["setPin", () => api.setPin(undefined, "1234"), "set_pin", { old: null, new: "1234" }],
];

describe("API IPC contract", () => {
  it.each(cases.map(([name, call, command, args]) => [name, call, command, args] as const))("%s passes command arguments and returns the backend result", async (_name, call, command, args) => {
    const result = { marker: "backend result" };
    const spy = spyOn(core, "invoke").mockResolvedValue(result);
    try {
      expect(await call()).toBe(result);
      expect(spy).toHaveBeenCalledTimes(1);
      if (args === undefined) expect(spy).toHaveBeenCalledWith(command);
      else expect(spy).toHaveBeenCalledWith(command, args);
    } finally { spy.mockRestore(); }
  });

  it("accounts for every wrapper, including the existing email and security suites", () => {
    const separatelyTested: (keyof typeof api)[] = ["emailStatus", "emailConnect", "emailDisconnect", "emailSync", "emailList", "emailOpen", "emailSetFlag", "emailArchive", "emailSend", "securityStatus", "unlock", "disablePin", "assistantSend", "voiceInstall", "pickVoiceModel"];
    expect<string[]>([...new Set([...cases.map(([name]) => name), ...separatelyTested])].sort()).toEqual(Object.keys(api).sort());
  });

  it("preserves structured AppError rejections", async () => {
    const error = { code: "locked", message: "Anchoa terkunci" };
    const spy = spyOn(core, "invoke").mockRejectedValue(error);
    try { await expect(api.saveAccount({ name: "BCA", kind: "bank", openingBalance: 1 })).rejects.toBe(error); }
    finally { spy.mockRestore(); }
  });

  it("passes stream channels with the supplied event handlers", async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", { configurable: true, value: { __TAURI_INTERNALS__: { transformCallback: () => 1 } } });
    const spy = spyOn(core, "invoke").mockResolvedValue(undefined);
    try {
      const assistantEvent = mock((_event: AssistantEvent) => {});
      await api.assistantSend("Halo", assistantEvent);
      const channel = (spy.mock.calls[0][1] as Record<string, unknown>).onEvent as core.Channel<AssistantEvent>;
      expect(spy).toHaveBeenLastCalledWith("assistant_send", { text: "Halo", onEvent: expect.any(core.Channel) });
      const delta: AssistantEvent = { type: "delta", data: "Jawaban" };
      channel.onmessage(delta);
      expect(assistantEvent).toHaveBeenCalledWith(delta);
      const progress = mock((_event: VoiceInstallProgress) => {});
      await api.voiceInstall("whisper-model", progress);
      expect(spy).toHaveBeenLastCalledWith("voice_install", { component: "whisper-model", onEvent: expect.any(core.Channel) });
      const event: VoiceInstallProgress = { component: "whisper-model", file: "model.bin", doneBytes: 1, totalBytes: 2, stage: "downloading" };
      ((spy.mock.calls[1][1] as Record<string, unknown>).onEvent as core.Channel<VoiceInstallProgress>).onmessage(event);
      expect(progress).toHaveBeenCalledWith(event);
      await api.voiceInstall("piper");
      expect(() => ((spy.mock.calls[2][1] as Record<string, unknown>).onEvent as core.Channel<VoiceInstallProgress>).onmessage(event)).not.toThrow();
    } finally {
      spy.mockRestore();
      if (previous) Object.defineProperty(globalThis, "window", previous);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("subscribes to sync-changed and calls the handler without the event payload", async () => {
    const unlisten = () => {};
    const spy = spyOn(events, "listen").mockResolvedValue(unlisten);
    try {
      const handler = mock(() => {});
      expect(await onSyncChanged(handler)).toBe(unlisten);
      expect(spy.mock.calls[0][0]).toBe("sync-changed");
      (spy.mock.calls[0][1] as (event: unknown) => void)({ payload: null });
      expect(handler).toHaveBeenCalledWith();
    } finally { spy.mockRestore(); }
  });

  it("uses a single ONNX file picker and handles cancellation", async () => {
    const spy = spyOn(dialog, "open").mockResolvedValueOnce("/voice.onnx").mockResolvedValueOnce(null).mockResolvedValueOnce(["/voice.onnx"]);
    try {
      expect(await api.pickVoiceModel()).toBe("/voice.onnx");
      expect(spy).toHaveBeenCalledWith({ multiple: false, directory: false, filters: [{ name: "Suara Piper", extensions: ["onnx"] }] });
      expect(await api.pickVoiceModel()).toBeNull();
      expect(await api.pickVoiceModel()).toBeNull();
    } finally { spy.mockRestore(); }
  });

  it("formats all error shapes and escapes asset paths in static rendering", () => {
    for (const [value, expected] of [[null, "null"], [undefined, "undefined"], [42, "42"], [{ message: 7 }, "7"], [{}, "[object Object]"]] as const) {
      expect(errorMessage(value)).toBe(expected);
    }
    expect(assetUrl("/home/kamu/a #é.png")).toBe("asset://localhost/%2Fhome%2Fkamu%2Fa%20%23%C3%A9.png");
  });
});
