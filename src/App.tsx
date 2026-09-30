import { useCallback, useEffect, useRef, useState } from "react";
import { api, type DbStatus } from "./api";
import { AssistantMini } from "./assistant/AssistantMini";
import { Dashboard } from "./dashboard/Dashboard";
import { useDashboard } from "./dashboard/useDashboard";
import { FinancePage } from "./finance/FinancePage";
import { Inbox } from "./inbox/Inbox";
import { ItemPage } from "./item/ItemPage";
import { NotifPanel } from "./notifications/NotifPanel";
import { reminderCount } from "./notifications/reminders";
import { CommandPalette } from "./palette/CommandPalette";
import { Settings } from "./settings/Settings";
import { Aside } from "./shell/Aside";
import { ComingSoon } from "./shell/ComingSoon";
import { ErrorScreen } from "./shell/ErrorScreen";
import { assistantHint, pageInfo, type PageId } from "./shell/nav";
import { Sidebar } from "./shell/Sidebar";
import { TopBar } from "./shell/TopBar";
import { useToast } from "./shell/toast";

/** A new `intent` number remounts Keuangan with the transaction form open (palette "Catat transaksi"). */
type Page = { name: PageId; intent?: number } | { name: "item"; id: string };
/** Only one overlay is open at a time. */
type Overlay = "palette" | "notifications" | null;

export function App() {
  const toast = useToast();
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [stack, setStack] = useState<Page[]>([{ name: "dashboard" }]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [captures, setCaptures] = useState(0);
  const [contributionsVersion, setContributionsVersion] = useState(0);
  const intents = useRef(0);
  const onGithubChanged = useCallback(() => setContributionsVersion((v) => v + 1), []);
  const dashboard = useDashboard();
  const { reload } = dashboard;
  const page = stack[stack.length - 1];
  const ready = status !== null && status.error === null;

  useEffect(() => {
    api.dbStatus().then((s) => {
      setStatus(s);
      if (s.backupError) toast(`Backup harian gagal: ${s.backupError}`, "error");
    });
  }, [toast]);

  // The bell, the panel, the palette and the dashboard show data that other pages change: refresh on every page change.
  useEffect(() => {
    if (ready) reload();
  }, [ready, stack, reload]);

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

  if (!status) return null;
  if (status.error) return <ErrorScreen path={status.path} message={status.error} />;

  const go = (name: PageId) => setStack([{ name }]);
  const openItem = (id: string) => setStack((s) => [...s, { name: "item", id }]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const newTransaction = () => setStack([{ name: "keuangan", intent: ++intents.current }]);
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
        inboxDot={(data?.inboxCount ?? 0) > 0}
        reminders={reminderCount(data?.today ?? [])}
        notificationsOpen={overlay === "notifications"}
        onToggleNotifications={() => setOverlay((o) => (o === "notifications" ? null : "notifications"))}
      />
      <main className="flex min-w-0 flex-1 flex-col gap-[18px] overflow-y-auto px-7 py-6">
        <TopBar onOpenPalette={() => setOverlay("palette")} />
        {page.name === "dashboard" && <Dashboard data={data} onToggle={dashboard.toggle} onOpen={openItem} onSelect={go} />}
        {page.name === "inbox" && <Inbox key={captures} onOpen={openItem} />}
        {page.name === "keuangan" && (
          <FinancePage key={page.intent ?? 0} newTransaction={page.intent !== undefined} onChanged={reload} />
        )}
        {page.name === "item" && <ItemPage key={page.id} id={page.id} onBack={back} />}
        {page.name === "settings" && <Settings onGithubChanged={onGithubChanged} />}
        {info?.about && <ComingSoon page={info} onOpenSettings={() => go("settings")} />}
      </main>
      {page.name === "dashboard" ? (
        <Aside contributionsVersion={contributionsVersion} onOpenSettings={() => go("settings")} />
      ) : (
        <AssistantMini key={page.name === "item" ? page.id : page.name} hint={assistantHint(info)} onOpenFull={() => go("dashboard")} />
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
        <NotifPanel today={data?.today ?? []} onClose={() => setOverlay(null)} onOpenItem={openItem} />
      )}
    </div>
  );
}
