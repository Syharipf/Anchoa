import { QuickCapture } from "./QuickCapture";

/** Widgets arrive in PR #4; for now the dashboard is quick capture only. */
export function Dashboard({ focusCapture }: { focusCapture: number }) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <QuickCapture onSaved={() => {}} focusSignal={focusCapture} />
    </div>
  );
}
