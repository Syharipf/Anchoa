import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage, type DbStatus, type NotifyPrefs, type SecurityStatus } from "./api";
import { AssistantMini } from "./assistant/AssistantMini";
import { LockScreen } from "./security/LockScreen";
import { Dashboard } from "./dashboard/Dashboard";
import { useDashboard } from "./dashboard/useDashboard";
import { FilesPage, type FileClipboard } from "./files/FilesPage";
import { DownloadsPage } from "./downloads/DownloadsPage";
import { EmailPage } from "./email/EmailPage";
import { FinancePage } from "./finance/FinancePage";
import { HabitsPage } from "./habits/HabitsPage";
import { JournalPage } from "./journal/JournalPage";
import { NotesPage } from "./notes/NotesPage";
import { ItemPage } from "./item/ItemPage";
import { ProfilePage } from "./profile/ProfilePage";
import { ProjectsPage } from "./projects/ProjectsPage";
import { SchedulePage } from "./schedule/SchedulePage";
import { NotifPanel } from "./notifications/NotifPanel";
import { reminderCount } from "./notifications/reminders";
import { CommandPalette } from "./palette/CommandPalette";
import { Settings } from "./settings/Settings";
import type { SettingsSection } from "./settings/view";
import { Aside } from "./shell/Aside";
import { ComingSoon } from "./shell/ComingSoon";
import { ErrorScreen } from "./shell/ErrorScreen";
import { assistantHint, pageInfo, type PageId } from "./shell/nav";
import { Sidebar } from "./shell/Sidebar";
import { TopBar } from "./shell/TopBar";
import { useToast } from "./shell/toast";

/** `intent` remounts Catatan on navigation or opens Keuangan's transaction form. */
type Page =
  | { name: PageId; intent?: number; path?: string; id?: string; section?: SettingsSection }
  | { name: "item"; id: string };
/** Only one overlay is open at a time. */
type Overlay = "palette" | "notifications" | null;

export function App() {
  const toast = useToast();
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [stack, setStack] = useState<Page[]>([{ name: "dashboard" }]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [captures, setCaptures] = useState(0);
  const [fileClipboard, setFileClipboard] = useState<FileClipboard | null>(null);
  const [contributionsVersion, setContributionsVersion] = useState(0);
  const [notifyPrefs, setNotifyPrefs] = useState<NotifyPrefs | undefined>(undefined);
  const [assistantDataVersion, setAssistantDataVersion] = useState(0);
  const [security, setSecurity] = useState<SecurityStatus | null>(null);
  const intents = useRef(0);
  const onGithubChanged = useCallback(() => setContributionsVersion((v) => v + 1), []);
  const onSectionChange = useCallback((section: SettingsSection) => {
    setStack((s) => {
      const current = s[s.length - 1];
      if (current.name !== "settings" || current.section === section) return s;
      return [...s.slice(0, -1), { ...current, section }];
    });
  }, []);
  const onReveal = useCallback((path: string) => setStack([{ name: "berkas", path }]), []);
  const reloadPrefs = useCallback(() => {
    api.getNotifyPrefs().then(setNotifyPrefs).catch(() => {});
  }, []);
  const dashboard = useDashboard();
  const { reload } = dashboard;
  const onAssistantChanged = useCallback(() => {
    reload();
    setAssistantDataVersion((version) => version + 1);
  }, [reload]);
  const page = stack[stack.length - 1];
  const locked = security?.locked ?? true;
  const ready = status !== null && status.error === null && !locked;

  useEffect(() => {
    api.dbStatus().then((s) => {
      setStatus(s);
      if (s.backupError) toast(`Backup harian gagal: ${s.backupError}`, "error");
    });
    api.securityStatus().then(setSecurity).catch(() => {
      setSecurity({ pinEnabled: true, locked: true });
    });
  }, [toast]);

  useEffect(() => {
    if (ready) reloadPrefs();
  }, [ready, reloadPrefs]);

  // The bell, the panel, the palette and the dashboard show data that other pages change: refresh on every page change.
  useEffect(() => {
    if (ready) reload();
  }, [ready, stack, reload]);

  // The Unduhan card shows live progress: refresh every second while it lists downloads.
  const downloading = page.name === "dashboard" && (dashboard.data?.downloads.items.length ?? 0) > 0;
  useEffect(() => {
    if (!downloading) return;
    const timer = setInterval(reload, 1000);
    return () => clearInterval(timer);
  }, [downloading, reload]);

  // Ctrl+K (Ctrl+N as an alias) opens the command palette over the current page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (key === "k" || key === "n")) {
        e.preventDefault();
        setOverlay("palette");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (name: PageId, section?: SettingsSection) =>
    setStack([{ name, section, intent: name === "catatan" ? ++intents.current : undefined }]);
  const openSettings = (section?: SettingsSection) => setStack([{ name: "settings", section }]);
  const openItem = useCallback(
    (id: string) => {
      api.openItem(id).then(
        (item) => {
          if (item.type === "page") {
            const intent = ++intents.current;
            setStack((s) => [...s, { name: "catatan", id, intent }]);
          } else {
            setStack((s) => [...s, { name: "item", id }]);
          }
        },
        (e) => toast(errorMessage(e), "error"),
      );
    },
    [toast],
  );
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const newTransaction = () => setStack([{ name: "keuangan", intent: ++intents.current }]);

  if (!status) return null;
  if (status.error) return <ErrorScreen path={status.path} message={status.error} />;
  if (security === null) return null;
  if (security.locked) {
    return (
      <LockScreen
        onUnlocked={() => {
          setSecurity((prev) =>
            prev ? { ...prev, locked: false } : { pinEnabled: true, locked: false },
          );
        }}
      />
    );
  }
  const info = page.name === "item" ? null : pageInfo(page.name);
  const data = dashboard.data;

  return (
    <div className="flex h-full bg-canvas">
      <Sidebar
        current={page.name}
        onSelect={(name) => {
          setOverlay(null);
          go(name);
        }}
        reminders={reminderCount(
          data?.today ?? [],
          data?.finance ?? null,
          data?.habitReminders ?? [],
          notifyPrefs,
        )}
        notificationsOpen={overlay === "notifications"}
        onToggleNotifications={() => setOverlay((o) => (o === "notifications" ? null : "notifications"))}
      />
      <main className="flex min-w-0 flex-1 flex-col gap-[18px] overflow-y-auto px-7 py-6">
        <TopBar onOpenPalette={() => setOverlay("palette")} />
        {page.name === "dashboard" && <Dashboard data={data} onToggle={dashboard.toggle} onOpen={openItem} onSelect={go} />}
        {page.name === "jurnal" && <JournalPage key={`${captures}:${assistantDataVersion}`} onOpenItem={openItem} onChanged={reload} />}
        {page.name === "catatan" && (
          <NotesPage
            key={`${page.intent ?? 0}:${assistantDataVersion}`}
            initialId={page.id}
            onOpenItem={openItem}
            onReveal={onReveal}
            onChanged={reload}
          />
        )}
        {page.name === "habit" && <HabitsPage key={assistantDataVersion} onChanged={reload} />}
        {page.name === "keuangan" && (
          <FinancePage key={`${page.intent ?? 0}:${assistantDataVersion}`} newTransaction={page.intent !== undefined} onChanged={reload} />
        )}
        {page.name === "proyek" && (
          <ProjectsPage key={assistantDataVersion} onOpenItem={openItem} onChanged={reload} />
        )}
        {page.name === "jadwal" && (
          <SchedulePage
            key={assistantDataVersion}
            onOpenItem={openItem}
            onOpenFinance={() => go("keuangan")}
            onChanged={reload}
          />
        )}
        {page.name === "berkas" && (
          <FilesPage
            key={`${page.path ?? ""}:${assistantDataVersion}`}
            initialPath={page.path}
            clipboard={fileClipboard}
            onSetClipboard={setFileClipboard}
          />
        )}
        {page.name === "unduhan" && (
          <DownloadsPage key={assistantDataVersion} onReveal={onReveal} />
        )}
        {page.name === "email" && <EmailPage onChanged={reload} />}
        {page.name === "item" && <ItemPage key={`${page.id}:${assistantDataVersion}`} id={page.id} onBack={back} onOpenItem={openItem} />}
        {page.name === "profil" && (
          <ProfilePage
            key={assistantDataVersion}
            prefs={notifyPrefs}
            onPrefsChanged={() => {
              reloadPrefs();
              reload();
            }}
            onOpenSettings={openSettings}
          />
        )}
        {page.name === "settings" && (
          <Settings
            key={assistantDataVersion}
            initialSection={page.section}
            onSectionChange={onSectionChange}
            onGithubChanged={onGithubChanged}
          />
        )}
        {info?.about && <ComingSoon page={info} onOpenSettings={openSettings} />}
      </main>
      {page.name === "dashboard" ? (
        <Aside
          contributionsVersion={contributionsVersion}
          onOpenSettings={() => openSettings("integrations")}
          onOpenAiSettings={() => openSettings("ai")}
          onOpenVoiceSettings={() => openSettings("suara")}
          onChanged={onAssistantChanged}
        />
      ) : (
        <AssistantMini
          key={page.name === "item" ? page.id : page.name}
          hint={assistantHint(info)}
          onOpenFull={() => go("dashboard")}
          onOpenAiSettings={() => openSettings("ai")}
          onOpenVoiceSettings={() => openSettings("suara")}
          onChanged={onAssistantChanged}
        />
      )}
      {overlay === "palette" && (
        <CommandPalette
          recent={data?.recent ?? []}
          onClose={() => setOverlay(null)}
          onNavigate={go}
          onOpenItem={openItem}
          onCaptured={() => {
            setCaptures((n) => n + 1);
            reload();
          }}
          onNewTransaction={newTransaction}
        />
      )}
      {overlay === "notifications" && (
        <NotifPanel
          today={data?.today ?? []}
          finance={data?.finance ?? null}
          habitReminders={data?.habitReminders ?? []}
          prefs={notifyPrefs}
          onClose={() => setOverlay(null)}
          onOpenItem={openItem}
          onOpenFinance={() => go("keuangan")}
          onOpenHabits={() => go("habit")}
        />
      )}
    </div>
  );
}
