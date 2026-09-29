import { AiColumn } from "./shell/AiColumn";
import { Sidebar } from "./shell/Sidebar";

export function App() {
  return (
    <div className="flex h-full">
      <Sidebar current="dashboard" onSelect={() => {}} />
      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        <h1 className="text-xl font-bold">Dashboard</h1>
      </main>
      <AiColumn />
    </div>
  );
}
