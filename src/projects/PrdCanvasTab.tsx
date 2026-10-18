import { FlowCanvas } from "./FlowCanvas";
import { PrdEditor } from "./PrdEditor";

export function PrdCanvasTab({
  projectId,
  prdContent,
  flowJson,
  onPrdSaved,
  onFlowSaved,
}: Readonly<{
  projectId: string;
  prdContent: string | null;
  flowJson: string | null;
  onPrdSaved?: (content: string) => void;
  onFlowSaved?: (flowJson: string) => void;
}>) {
  return (
    <div className="grid flex-1 min-h-0 grid-cols-1 gap-3.5 md:grid-cols-[400px_minmax(0,1fr)]">
      <PrdEditor
        projectId={projectId}
        initialContent={prdContent}
        onSaved={onPrdSaved}
      />
      <FlowCanvas
        projectId={projectId}
        initialFlowJson={flowJson}
        onSaved={onFlowSaved}
      />
    </div>
  );
}
