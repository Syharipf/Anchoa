import { useMemo, useState } from "react";
import { api, errorMessage } from "../api";
import { useToast } from "../shell/toast";
import { SECONDARY } from "../shell/ui";

export interface FlowNode {
  id: string;
  label: string;
  type?: "start" | "process" | "action" | "error";
  desc?: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  condition?: string;
}

export interface FlowData {
  version?: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface PositionedNode extends FlowNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionedEdge extends FlowEdge {
  path: string;
}

export interface FlowLayout {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  width: number;
  height: number;
}

export function calculateFlowLayout(data: FlowData): FlowLayout {
  const nodeMap: Record<string, PositionedNode> = {};
  const nodeWidth = 165;
  const nodeHeight = 54;
  const startX = 35;
  const spacingX = 225;
  let mainX = startX;

  for (const node of data.nodes) {
    const isError = node.type === "error";
    const x = isError ? Math.max(startX, mainX - spacingX) : mainX;
    const y = isError ? 150 : 50;
    if (!isError) {
      mainX += spacingX;
    }
    nodeMap[node.id] = {
      ...node,
      x,
      y,
      width: nodeWidth,
      height: nodeHeight,
    };
  }

  const positionedEdges: PositionedEdge[] = [];
  for (const edge of data.edges) {
    const fromNode = nodeMap[edge.from];
    const toNode = nodeMap[edge.to];
    if (!fromNode || !toNode) continue;

    let path = "";
    if (toNode.y === fromNode.y) {
      const startEdgeX = fromNode.x + fromNode.width;
      const endEdgeX = toNode.x;
      const y = fromNode.y + fromNode.height / 2;
      path = `M ${startEdgeX} ${y} L ${endEdgeX} ${y}`;
    } else {
      const startEdgeX = fromNode.x + fromNode.width / 2;
      const startEdgeY = fromNode.y + fromNode.height;
      const endEdgeY = toNode.y + toNode.height / 2;
      const endEdgeX = toNode.x;
      path = `M ${startEdgeX} ${startEdgeY} L ${startEdgeX} ${endEdgeY} L ${endEdgeX} ${endEdgeY}`;
    }
    positionedEdges.push({ ...edge, path });
  }

  return {
    nodes: Object.values(nodeMap),
    edges: positionedEdges,
    width: Math.max(720, mainX + 50),
    height: 250,
  };
}

export function FlowCanvas({
  projectId,
  initialFlowJson,
  onSaved,
}: Readonly<{
  projectId: string;
  initialFlowJson: string | null;
  onSaved?: (flowJson: string) => void;
}>) {
  const toast = useToast();
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const flowData: FlowData = useMemo(() => {
    if (!initialFlowJson) return { nodes: [], edges: [] };
    try {
      const parsed = JSON.parse(initialFlowJson) as FlowData;
      return {
        nodes: Array.isArray(parsed?.nodes) ? parsed.nodes : [],
        edges: Array.isArray(parsed?.edges) ? parsed.edges : [],
      };
    } catch {
      return { nodes: [], edges: [] };
    }
  }, [initialFlowJson]);

  const layout = useMemo(() => calculateFlowLayout(flowData), [flowData]);

  async function handleAddStep() {
    const newId = `step_${flowData.nodes.length + 1}`;
    const newNodes = [
      ...flowData.nodes,
      {
        id: newId,
        label: `Step ${flowData.nodes.length + 1}`,
        type: "process" as const,
        desc: "New process",
      },
    ];
    const newEdges = [...flowData.edges];
    if (flowData.nodes.length > 0) {
      newEdges.push({
        from: flowData.nodes[flowData.nodes.length - 1].id,
        to: newId,
      });
    }
    const updated = { version: 1, nodes: newNodes, edges: newEdges };
    const jsonStr = JSON.stringify(updated, null, 2);
    try {
      await api.projectSaveFlow(projectId, jsonStr);
      toast("New step added to flow diagram");
      onSaved?.(jsonStr);
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  }
  return (
    <div className="flex min-h-[540px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <div className="flex items-center justify-between border-b border-line bg-surface-2 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="font-display text-xs font-semibold text-ink">
            Business Process Flow Canvas
          </span>
          <span className="font-mono text-[11px] text-muted">(.anchoa/flow.json)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAddStep}
            className={`${SECONDARY} py-1 text-xs`}
          >
            + Step
          </button>
        </div>
      </div>

      <div className="relative flex-1 overflow-auto bg-[radial-gradient(#18262B_1px,transparent_1px)] [background-size:16px_16px] p-4">
        {layout.nodes.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted">
            <p className="text-xs">No business process flow (.anchoa/flow.json) yet.</p>
            <p className="mt-1 text-[11px]">
              Click "+ Step" or ask the AI to design an automated flow.
            </p>
          </div>
        ) : (
          <svg
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            style={{ width: `${layout.width}px`, height: `${layout.height}px` }}
            className="block"
          >
            {/* Edges */}
            {layout.edges.map((edge) => (
              <path
                key={`${edge.from}-${edge.to}`}
                d={edge.path}
                stroke={edge.condition === "fail" ? "#FF8A7A" : "#4E6A26"}
                strokeWidth={edge.condition === "fail" ? 1.5 : 2}
                strokeDasharray={edge.condition === "fail" ? "4 3" : undefined}
                fill="none"
              />
            ))}

            {/* Nodes */}
            {layout.nodes.map((node) => {
              const isSelected = selectedNode === node.id;
              const isError = node.type === "error";
              const isStart = node.type === "start";

              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x}, ${node.y})`}
                  className="cursor-pointer"
                  onClick={() => setSelectedNode(node.id)}
                >
                  <rect
                    width={node.width}
                    height={node.height}
                    rx="8"
                    fill={isError ? "#221A1C" : isSelected ? "#18262B" : "#121D21"}
                    stroke={
                      isSelected
                        ? "#C6F36B"
                        : isError
                        ? "#FF8A7A"
                        : isStart
                        ? "#C6F36B"
                        : "#4E6A26"
                    }
                    strokeWidth={isSelected ? 2 : 1.5}
                  />
                  <text
                    x="14"
                    y="25"
                    fill={isError ? "#FF8A7A" : isSelected ? "#C6F36B" : "#E6EEF0"}
                    fontFamily="sans-serif"
                    fontSize="12.5"
                    fontWeight="600"
                  >
                    {node.label}
                  </text>
                  <text
                    x="14"
                    y="41"
                    fill="#94A8AE"
                    fontFamily="monospace"
                    fontSize="10.5"
                  >
                    {node.desc || node.type || "process"}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
