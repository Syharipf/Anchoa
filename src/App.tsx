import { useCallback, useEffect, useState } from "react";
import { api, type DbStatus } from "./api";
import { Dashboard } from "./dashboard/Dashboard";
import { Inbox } from "./inbox/Inbox";
import { ItemPage } from "./item/ItemPage";
import { Settings } from "./settings/Settings";
import { AssistantMini } from "./assistant/AssistantMini";
import { Aside } from "./shell/Aside";
import { ComingSoon } from "./shell/ComingSoon";
import { ErrorScreen } from "./shell/ErrorScreen";
import { assistantHint, pageInfo, type PageId } from "./shell/nav";
import { Sidebar } from "./shell/Sidebar";
import { useToast } from "./shell/toast";

type Page = { name: PageId } | { name: "item"; id: string };

export function App() {
  const toast = useToast();
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [stack, setStack] = useState<Page[]>([{ name: "dashboard" }]);
  const [focusCapture, setFocusCapture] = useState(0);
  const [inboxCount, setInboxCount] = useState(0);
  const onInboxCount = useCallback((count: number) => setInboxCount(count), []);
  const [contributionsVersion, setContributionsVersion] = useState(0);
  const onGithubChanged = useCallback(() => setContributionsVersion((v) => v + 1), []);
  const page = stack[stack.length - 1];

  useEffect(() => {
    api.dbStatus().then((s) => {
      setStatus(s);
      if (s.backupError) toast(`Backup harian gagal: ${s.backupError}`, "error");
    });
  }, [toast]);

  // Ctrl+K (Ctrl+N as an alias): jump to the dashboard and focus the command bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (key === "k" || key === "n")) {
        e.preventDefault();
        setStack([{ name: "dashboard" }]);
        setFocusCapture((n) => n + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!status) return null;
  if (status.error) return <ErrorScreen path={status.path} message={status.error} />;

  const openItem = (id: string) => setStack((s) => [...s, { name: "item", id }]);
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  const info = page.name === "item" ? null : pageInfo(page.name);
  const openSettings = () => setStack([{ name: "settings" }]);

  return (
    <div className="flex h-full bg-canvas">
      <Sidebar current={page.name} onSelect={(name) => setStack([{ name }])} inboxDot={inboxCount > 0} />
      <main className="flex min-w-0 flex-1 flex-col gap-[18px] overflow-y-auto px-7 py-6">
        {page.name === "dashboard" && (
          <Dashboard onOpen={openItem} onInboxCount={onInboxCount} focusCapture={focusCapture} />
        )}
        {page.name === "inbox" && <Inbox onOpen={openItem} onCount={onInboxCount} />}
        {page.name === "item" && <ItemPage key={page.id} id={page.id} onBack={back} />}
        {page.name === "settings" && <Settings onGithubChanged={onGithubChanged} />}
        {info?.about && <ComingSoon page={info} onOpenSettings={openSettings} />}
      </main>
      {page.name === "dashboard" ? (
        <Aside contributionsVersion={contributionsVersion} onOpenSettings={openSettings} />
      ) : (
        <AssistantMini key={page.name} hint={assistantHint(info)} onOpenFull={() => setStack([{ name: "dashboard" }])} />
      )}
    </div>
  );
}
