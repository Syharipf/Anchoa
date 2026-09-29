import { useEffect, useState } from "react";
import { api, type DbStatus } from "./api";
import { Dashboard } from "./dashboard/Dashboard";
import { Inbox } from "./inbox/Inbox";
import { ItemPage } from "./item/ItemPage";
import { Settings } from "./settings/Settings";
import { AiColumn } from "./shell/AiColumn";
import { ErrorScreen } from "./shell/ErrorScreen";
import { Sidebar, type TopPage } from "./shell/Sidebar";
import { useToast } from "./shell/toast";

type Page = { name: TopPage } | { name: "item"; id: string };

export function App() {
  const toast = useToast();
  const [status, setStatus] = useState<DbStatus | null>(null);
  const [stack, setStack] = useState<Page[]>([{ name: "dashboard" }]);
  const [focusCapture, setFocusCapture] = useState(0);
  const page = stack[stack.length - 1];

  useEffect(() => {
    api.dbStatus().then((s) => {
      setStatus(s);
      if (s.backupError) toast(`Backup harian gagal: ${s.backupError}`, "error");
    });
  }, [toast]);

  // Ctrl+N: jump to the dashboard and focus quick capture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
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

  return (
    <div className="flex h-full">
      <Sidebar current={page.name} onSelect={(name) => setStack([{ name }])} />
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {page.name === "dashboard" && <Dashboard onOpen={openItem} focusCapture={focusCapture} />}
        {page.name === "inbox" && <Inbox onOpen={openItem} />}
        {page.name === "item" && <ItemPage key={page.id} id={page.id} onBack={back} />}
        {page.name === "settings" && <Settings />}
      </main>
      <AiColumn />
    </div>
  );
}
